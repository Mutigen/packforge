# Design-Essenzen aus 10 Open-Source-Repos → PackForge

> Extrahiert aus Quellcode-Analyse. Jedes Pattern wird mit konkretem
> Anwendungsort in PackForge verknüpft.

---

## 1. google/zx — API-Design · Developer-UX · Async-Chains

**Quellcode**: `src/core.ts` (~1110 Zeilen)

### 1.1 Tagged Template Literal API

zx's `$` Funktion akzeptiert Template-Strings direkt: `` $`ls -la` ``.
Intern wird eine `ProcessPromise` zurückgegeben — ein Custom Promise mit
`.pipe()`, `.kill()`, `.run()`.

**PackForge-Anwendung → MCP Gateway / Hub API**

```typescript
// Statt verschachtelter Konfigurationsobjekte:
const result = await gateway.activate`fullstack-builder for ${projectId}`;

// Oder als Builder-Pattern (bevorzugt):
const handoff = await gateway
  .forProject(projectId)
  .withPacks('fullstack-builder', 'code-security-analysis')
  .execute();
```

### 1.2 AsyncLocalStorage Context Propagation

zx nutzt `AsyncLocalStorage` und `getStore()`/`within()` um Execution-Kontext
(cwd, env, shell) unsichtbar durch async Chains zu propagieren.

**PackForge-Anwendung → Orchestrator + Context Analyzer**

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

interface ActivationContext {
  projectId: string;
  traceId: string;
  contextSnapshot: ProjectContext;
  policyDecisions: PolicyDecision[];
}

const activationStore = new AsyncLocalStorage<ActivationContext>();

// Jeder Activation-Flow läuft in seinem eigenen Kontext
export function runActivation<T>(ctx: ActivationContext, fn: () => Promise<T>): Promise<T> {
  return activationStore.run(ctx, fn);
}

// Überall im Flow zugreifbar ohne Parameter-Drilling
export function getActivationContext(): ActivationContext {
  const ctx = activationStore.getStore();
  if (!ctx) throw new Error('Not inside an activation flow');
  return ctx;
}
```

**Warum wichtig**: Der Orchestrator durchläuft Context-Analyse → Scoring → Policy → Activation → Handoff.
Alle Schritte brauchen Zugriff auf `traceId`, `projectContext`, `policyDecisions`.
Statt jedes als Parameter durchzureichen, propagiert `AsyncLocalStorage` den kompletten
Activation-Kontext implizit — wie zx's Shell-Kontext.

### 1.3 Snapshot-Pattern

`getSnapshot()` friert den Execution-Kontext beim Aufrufzeitpunkt ein.
Das verhindert Race-Conditions wenn parallel mehrere Aktivierungen laufen.

**PackForge-Anwendung → Context Analyzer**

```typescript
// Beim Start der Analyse den aktuellen Zustand einfrieren
const snapshot = contextAnalyzer.snapshot(projectId);
// Nachfolgende Git-Commits ändern nichts am laufenden Scoring
const scores = await scorer.scoreAll(snapshot, packs);
```

### 1.4 Builder-Pattern `$({opts})`

zx erlaubt `$({shell: '/bin/zsh', cwd: '/tmp'})` und gibt eine konfigurierte
Shell-Funktion zurück. Chainable für Presets.

**PackForge-Anwendung → Pack-Selektion**

```typescript
// Vorkonfigurierter Selector für bestimmte Domäne
const selectFintech = orchestrator.selector({ domain: 'fintech', riskProfile: 'regulated' });
const packs = await selectFintech(projectContext);
```

---

## 2. vercel/turborepo — Task-Pipelines · Caching · DAG-Traversal

**Quellcode**: `crates/turborepo-lib/src/run/mod.rs` (~1044 Zeilen)

### 2.1 Run-Struct als zentraler Orchestrator

Turborepo's `Run` hält zusammen: `pkg_dep_graph`, `engine` (DAG), `run_cache`,
`signal_handler`. Alles wird in `run()` orchestriert.

**PackForge-Anwendung → Orchestrator**

```typescript
interface OrchestratorRun {
  contextSnapshot: ProjectContext;
  packRegistry: PackRegistry;
  scorer: PackScorer;
  policyEngine: PolicyEngine;
  cache: ActivationCache;
  signalHandler: AbortController;
}

// Einzelne run()-Methode statt verteilter Aufrufe
async function orchestrate(input: AnalyzeProjectInput): Promise<RuntimeHandoffContract> {
  const run = createOrchestratorRun(input);
  const context = await run.analyzeContext();
  const scores = await run.scorePacksWithCache(context);
  const plan = await run.applyPolicies(scores);
  return run.buildHandoff(plan);
}
```

### 2.2 Paralleles Hashing mit rayon::scope

Turborepo hasht Dateien, interne Deps und globale Inputs parallel via `rayon::scope`.

**PackForge-Anwendung → Context Analyzer**

```typescript
// Parallele Signalextraktion aus verschiedenen Quellen
const [
  packageJsonSignals,
  gitNexusSignals,
  fileTreeSignals,
  dockerSignals,
  workflowSignals,
] = await Promise.all([
  analyzePackageJson(repoPath),
  analyzeGitNexus(repoPath),
  analyzeFileTree(repoPath),
  analyzeDockerfiles(repoPath),
  analyzeGitHubWorkflows(repoPath),
]);
```

### 2.3 GlobalHashableInputs für Cache-Keys

Turborepo berechnet einen `globalHash` aus env-Variablen, Datei-Hashes, Framework-Inference
und nutzt diesen als Cache-Schlüssel.

**PackForge-Anwendung → Activation Cache**

```typescript
interface ContextHash {
  stackFingerprint: string;   // Sortierte Stack-Signale gehasht
  taxonomyHash: string;       // domain + phase + taskType + riskProfile
  gitNexusVersion: string;    // Cluster-Signatur
  packRegistryHash: string;   // Registry-content-hash
}

// Wenn sich weder Projekt noch Packs geändert haben → Cache-Hit
function computeActivationCacheKey(ctx: ProjectContext, registry: PackRegistry): string {
  return hash({ ...buildContextHash(ctx), registryHash: registry.contentHash });
}
```

### 2.4 Visitor-Pattern: new → visit → finish

Turborepo nutzt `Visitor::new()`, dann `visitor.visit(engine)`, dann `visitor.finish()`.
Klar getrennte Lifecycle-Phasen.

**PackForge-Anwendung → Pack-Scoring-Pipeline**

```typescript
interface ScoringVisitor {
  init(context: ProjectContext): void;
  visit(pack: InstructionPack): ScoringResult;
  finish(): RankedPackList;
}

class WeightedScorer implements ScoringVisitor {
  private results: ScoringResult[] = [];

  init(context: ProjectContext) { /* Gewichte aus Kontext ableiten */ }

  visit(pack: InstructionPack): ScoringResult {
    const score = this.computeScore(pack);
    this.results.push(score);
    return score;
  }

  finish(): RankedPackList {
    return this.results.sort((a, b) => b.score - a.score);
  }
}
```

---

## 3. biomejs/biome — Registry-Pattern · Plugin-Metadaten · Diagnostics

**Quellcode**: `crates/biome_diagnostics`, `crates/biome_configuration`

### 3.1 Diagnostics mit Severity + Tags

Biome's Diagnostic-System hat `Severity` (Error, Warning, Information, Hint)
und `DiagnosticTags` (Unnecessary, Deprecated, Both) plus `Applicability`
(Always, MaybeIncorrect).

**PackForge-Anwendung → Pack-Validierung + Policy Engine**

```typescript
type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

type DiagnosticTag =
  | 'conflict'          // Pack-Konflikt
  | 'deprecated'        // Pack-Version veraltet
  | 'policy-violation'  // Policy-Regel verletzt
  | 'low-confidence';   // Kontext-Erkennung unsicher

interface PackDiagnostic {
  severity: DiagnosticSeverity;
  tag: DiagnosticTag;
  packId: string;
  message: string;
  suggestion?: string;  // Wie Biome's "Applicability"
}

// Policy Engine gibt strukturierte Diagnostics statt booleans zurück
function evaluatePolicy(plan: ActivationPlan): PackDiagnostic[] {
  const diagnostics: PackDiagnostic[] = [];
  // Prüfe Konflikte, Risk-Level, Approval-State etc.
  return diagnostics;
}
```

### 3.2 Prelude-Pattern für Trait-Re-exports

Biome nutzt `pub mod prelude` mit anonymen Trait-Re-Exports.

**PackForge-Anwendung → shared-types**

```typescript
// packages/shared-types/src/prelude.ts
// Re-exportiert die häufigst genutzten Types + Guards als Convenience
export type { InstructionPack, ProjectContext, RuntimeHandoffContract } from './index.js';
export { InstructionPackSchema, ProjectContextSchema } from './index.js';
export { isValidPack, isValidContext } from './guards.js';
```

### 3.3 Modulare Crate-Architektur mit generierten Configs

Biome hat pro Sprache (CSS, JS, JSON, GraphQL, HTML, Markdown) separate
generierte Konfigurationsstrukturen.

**PackForge-Anwendung → Pack-Kategorien**

Jede Pack-Kategorie (`engineering`, `quality`, `product`, `documentation`, `ops`)
könnte eigene Default-Configs und Validierungsregeln haben, die aus der Taxonomie
generiert werden — ähnlich wie Biome Configs aus Sprachregeln generiert.

---

## 4. changesets/changesets — Dependency-Graphen · Lifecycle-Hooks

**Quellcode**: `packages/assemble-release-plan/src/index.ts` (414 Zeilen),
`packages/get-dependents-graph/src/index.ts` (54 Zeilen)

### 4.1 getDependentsGraph: Abhängigkeits-Inversion

changesets baut eine Map `<name, {pkg, dependents}>` — nicht die übliche
Dependencies-Map, sondern eine *Dependents*-Map. Das ermöglicht effizientes
"Was ist betroffen wenn sich X ändert?".

**PackForge-Anwendung → Pack-Konflikterkennung + compatible_with**

```typescript
interface PackDependentsGraph {
  // Für jedes Pack: Welche anderen Packs sind davon abhängig/kompatibel?
  graph: Map<string, {
    pack: InstructionPack;
    dependents: string[];     // Packs die auf dieses referenzieren
    conflicts: string[];       // Packs die konfligieren
    compatibles: string[];     // Packs die kompatibel sind
  }>;
}

// Wenn ein Pack geändert/entfernt wird → sofort sichtbar wer betroffen ist
function getAffectedPacks(packId: string, graph: PackDependentsGraph): string[] {
  const entry = graph.graph.get(packId);
  return [...(entry?.dependents ?? []), ...(entry?.conflicts ?? [])];
}
```

### 4.2 Iterative Convergence Loop

`assembleReleasePlan` läuft in einer Schleife: `determineDependents` →
`matchFixedConstraint` → `applyLinks` — wiederholt bis stabil.

**PackForge-Anwendung → Orchestrator Matching**

```typescript
// Pack-Selektion mit iterativer Stabilisierung
function assembleActivationPlan(
  context: ProjectContext,
  candidates: ScoringResult[],
): ActivationPlan {
  let plan = initialPlan(candidates);
  let stable = false;

  while (!stable) {
    const conflicts = resolveConflicts(plan);        // Wie determineDependents
    const policyChecks = applyPolicies(plan);         // Wie matchFixedConstraint
    const compatLinks = resolveCompatibles(plan);     // Wie applyLinks

    const newPlan = mergePlanUpdates(plan, conflicts, policyChecks, compatLinks);
    stable = deepEqual(plan, newPlan);
    plan = newPlan;
  }

  return plan;
}
```

**Warum wichtig**: Einfaches Top-N-Scoring reicht nicht — Konflikte und kompatible Packs
können die Auswahl kaskadierend verändern. Die Convergence-Loop garantiert ein stabiles Ergebnis.

### 4.3 Pre-Release State Machine

changesets hat eine `PreInfo` mit `preVersions` Map und Snapshot-Versioning.

**PackForge-Anwendung → Pack-Maturity-Lifecycle**

```typescript
// Pack durchläuft: draft → experimental → stable
// Wie changesets Pre-Releases: experimentelle Packs bekommen Score-Malus
function maturityScoreModifier(maturity: PackMaturityLevel): number {
  switch (maturity) {
    case 'draft': return 0.5;
    case 'experimental': return 0.75;  // Snapshot-äquivalent
    case 'stable': return 1.0;
  }
}
```

---

## 5. oclif/core — Plugin-Loading · Command-Lifecycle · Config-DI

**Quellcode**: `src/config/config.ts` (886 Zeilen), `src/command.ts` (444 Zeilen)

### 5.1 Plugin-Loader: loadRoot → loadChildren → loadCommands → loadTopics

oclif's Plugin-System hat eine klare Hierarchie: Root-Plugin wird geladen,
dann Children, dann Commands, dann Topics.

**PackForge-Anwendung → Pack-Registry-Loading**

```typescript
class PackRegistryLoader {
  async loadRoot(packsDir: string): Promise<PackRegistry> {
    const categories = await this.loadCategories(packsDir);     // Wie loadChildren
    const packs = await this.loadPacks(categories);              // Wie loadCommands
    const taxonomy = await this.loadTaxonomy(packs);             // Wie loadTopics
    return { categories, packs, taxonomy };
  }

  // Schrittweise, damit Fehler früh sichtbar sind
  private async loadCategories(dir: string): Promise<PackCategory[]> { /* ... */ }
  private async loadPacks(cats: PackCategory[]): Promise<InstructionPack[]> { /* ... */ }
  private async loadTaxonomy(packs: InstructionPack[]): Promise<TaxonomyIndex> { /* ... */ }
}
```

### 5.2 Hook-System: prerun / postrun / preparse / command_not_found

oclif hat ein typsicheres Hook-System mit vordefinierten Events und Timeouts.

**PackForge-Anwendung → Orchestrator Lifecycle-Hooks**

```typescript
type OrchestratorHooks = {
  'context:analyzed':   (ctx: ProjectContext) => Promise<void>;
  'scoring:complete':   (results: ScoringResult[]) => Promise<void>;
  'policy:evaluated':   (diagnostics: PackDiagnostic[]) => Promise<void>;
  'activation:before':  (plan: ActivationPlan) => Promise<void>;
  'activation:after':   (handoff: RuntimeHandoffContract) => Promise<void>;
  'activation:error':   (error: Error) => Promise<void>;
  'pack:not_found':     (packId: string) => Promise<void>;
};

class OrchestratorHookRunner {
  private hooks = new Map<keyof OrchestratorHooks, Function[]>();

  on<K extends keyof OrchestratorHooks>(event: K, fn: OrchestratorHooks[K]): void {
    const list = this.hooks.get(event) ?? [];
    list.push(fn);
    this.hooks.set(event, list);
  }

  async emit<K extends keyof OrchestratorHooks>(
    event: K,
    ...args: Parameters<OrchestratorHooks[K]>
  ): Promise<void> {
    for (const fn of this.hooks.get(event) ?? []) {
      await fn(...args);
    }
  }
}
```

### 5.3 Config als DI-Container

oclif's `Config` Klasse ist der zentrale DI-Container: `scopedEnvVar`, `findCommand`,
`runCommand`, `runHook`. Alles wird über Config injiziert.

**PackForge-Anwendung → Shared-Config als zentraler DI-Container**

```typescript
// packages/shared-config/src/app-config.ts
interface AppConfig {
  packsDir: string;
  registryPath: string;
  cacheDir: string;
  policyRulesPath: string;
  features: FeatureFlags;

  // Wie oclif: Config kennt die Services
  getPackRegistry(): PackRegistry;
  getContextAnalyzer(): ContextAnalyzer;
  getPolicyEngine(): PolicyEngine;
  getScorer(): PackScorer;
}
```

### 5.4 Command-Lifecycle: init → run → catch → finally

oclif Commands haben ein klares Lifecycle-Pattern mit Error-Recovery.

**PackForge-Anwendung → Activation-Lifecycle**

```typescript
abstract class ActivationCommand {
  abstract init(): Promise<void>;
  abstract run(): Promise<RuntimeHandoffContract>;

  async catch(error: Error): Promise<void> {
    // Default: Log + emit error hook
    await this.hooks.emit('activation:error', error);
  }

  async finally(): Promise<void> {
    // Audit-Log schreiben, Cache updaten, Traces flushen
    await this.auditLogger.flush();
  }

  // Wrapper wie oclif's _run()
  async execute(): Promise<RuntimeHandoffContract> {
    try {
      await this.init();
      const result = await this.run();
      return result;
    } catch (error) {
      await this.catch(error as Error);
      throw error;
    } finally {
      await this.finally();
    }
  }
}
```

### 5.5 Cache.getInstance() Singleton

oclif nutzt `Cache.getInstance()` für globale Konfiguration.

**PackForge-Anwendung → Pack-Registry Cache**

```typescript
class PackRegistryCache {
  private static instance: PackRegistryCache | null = null;
  private registry: PackRegistry | null = null;
  private contentHash: string | null = null;

  static getInstance(): PackRegistryCache {
    if (!this.instance) this.instance = new PackRegistryCache();
    return this.instance;
  }

  async get(packsDir: string): Promise<PackRegistry> {
    const currentHash = await computeDirHash(packsDir);
    if (this.registry && this.contentHash === currentHash) return this.registry;
    this.registry = await loadPackRegistry(packsDir);
    this.contentHash = currentHash;
    return this.registry;
  }
}
```

---

## 6. antfu/ni — Radikale Simplizität · Agent-Detection

**Quellcode**: `src/detect.ts` (78 Zeilen), `src/runner.ts` (233 Zeilen)

### 6.1 Ultra-minimale detect() Funktion

ni's `detect()` ist extrem simpel: suche `deno.json`, dann nutze `package-manager-detector`,
dann auto-install-Prompt. Keine Over-Engineering.

**PackForge-Anwendung → Context Analyzer Fallback-Mode**

```typescript
// Statt komplexem Analysis-System: Ein einfacher Fallback der "gut genug" ist
async function detectContextFallback(repoPath: string): Promise<ProjectContext> {
  // 1. Schnellcheck: Gibt es package.json?
  const pkg = await readPackageJsonSafe(repoPath);
  if (!pkg) return defaultContext(repoPath);

  // 2. Stack aus dependencies ableiten
  const stack = inferStackFromDeps(pkg);

  // 3. Domain aus README-Keywords (wenn vorhanden)
  const domain = await inferDomainFromReadme(repoPath);

  // 4. Fertig — kein GitNexus nötig
  return buildContext({ stack, domain, mode: 'fallback', confidence: 0.75 });
}
```

**Kern-Lektion**: Der Fallback-Pfad muss extrem einfach sein. ni beweist dass
Detection in <100 Zeilen zuverlässig funktioniert.

### 6.2 Runner-Type als Function-Signature

`Runner = (agent, args, ctx?) => ResolvedCommand | undefined`.
Nicht eine Klasse, nicht ein Interface mit 20 Methoden — eine einzige Funktion.

**PackForge-Anwendung → Scorer-Funktion**

```typescript
// Statt einer komplexen ScorerKlasse:
type PackScorer = (
  pack: InstructionPack,
  context: ProjectContext,
) => number;  // 0-100

// Verschiedene Scorer als einfache Funktionen
const keywordScorer: PackScorer = (pack, ctx) => {
  const matches = pack.activation_signals.keywords
    .filter(k => ctx.customKeywords.includes(k));
  return (matches.length / pack.activation_signals.keywords.length) * 100;
};

const stackScorer: PackScorer = (pack, ctx) => {
  const matches = pack.activation_signals.stack_hints
    .filter(s => ctx.stack.includes(s));
  return (matches.length / pack.activation_signals.stack_hints.length) * 100;
};

// Kombinierter Scorer
const compositeScorer: PackScorer = (pack, ctx) =>
  keywordScorer(pack, ctx) * 0.3 +
  stackScorer(pack, ctx) * 0.5 +
  domainScorer(pack, ctx) * 0.2;
```

### 6.3 CLI-Composition: runCli → run → getCliCommand

Drei Schichten, jede extrem dünn. `runCli` parsed CLI-Args, `run` löst den Agent,
`getCliCommand` baut den finalen Befehl.

**PackForge-Anwendung → MCP Gateway Layer**

```typescript
// Drei Schichten, jede maximal 30 Zeilen:

// 1. MCP Protocol Handler (wie runCli)
async function handleMcpRequest(request: McpRequest): Promise<McpResponse> {
  const input = parseMcpInput(request);
  return executeActivation(input);
}

// 2. Orchestration (wie run)
async function executeActivation(input: AnalyzeProjectInput): Promise<RuntimeHandoffContract> {
  const context = await analyzeContext(input);
  const plan = await buildActivationPlan(context);
  return buildHandoff(plan);
}

// 3. Handoff Builder (wie getCliCommand)
function buildHandoff(plan: ActivationPlan): RuntimeHandoffContract {
  return { contractVersion: '1.0.0', ...mapPlanToContract(plan) };
}
```

---

## 7. sindresorhus/execa — Process-Management · Stream-Typen

**Quellcode**: `lib/methods/main-async.js` (194 Zeilen), `lib/return/result.js` (186 Zeilen),
`types/return/result.d.ts` (205 Zeilen)

### 7.1 CommonResult als exhaustive Ergebnis-Typ

execa's Ergebnis hat: `stdout`, `stderr`, `all`, `stdio`, `ipcOutput`, `pipedFrom`,
`command`, `escapedCommand`, `cwd`, `durationMs`, `failed`, `timedOut`, `isCanceled`,
`isGracefullyCanceled`, `isMaxBuffer`, `isTerminated`, `isForcefullyTerminated`,
`exitCode`, `signal`, `signalDescription`.

**PackForge-Anwendung → ActivationResult**

```typescript
interface ActivationResult {
  // Kern-Ergebnis
  handoff: RuntimeHandoffContract;
  activatedPacks: string[];
  blockedPacks: Array<{ packId: string; reason: string }>;

  // Diagnose-Flags (wie execa's boolean Flags)
  failed: boolean;
  timedOut: boolean;
  isCanceled: boolean;
  isPolicyBlocked: boolean;
  isLowConfidence: boolean;

  // Metriken
  durationMs: number;
  scoringDurationMs: number;
  policyDurationMs: number;

  // Trace
  traceId: string;
  contextSnapshotId: string;
  analyzerMode: AnalyzerMode;

  // Diagnostics
  diagnostics: PackDiagnostic[];
}
```

**Kern-Lektion**: Ein exhaustives Ergebnis-Objekt mit boolean Flags ist besser
als verschachtelte Error-Hierarchien. Der Aufrufer kann `result.failed` prüfen
statt try/catch.

### 7.2 makeSuccessResult / makeError Dualität

execa hat separate Factory-Funktionen für Erfolg und Fehler, die denselben
Basis-Typ teilen.

**PackForge-Anwendung → Result-Factories**

```typescript
function makeActivationSuccess(params: SuccessParams): ActivationResult {
  return {
    ...buildBaseResult(params),
    failed: false,
    timedOut: false,
    isCanceled: false,
    isPolicyBlocked: false,
  };
}

function makeActivationError(params: ErrorParams): ActivationResult {
  return {
    ...buildBaseResult(params),
    failed: true,
    timedOut: params.reason === 'timeout',
    isCanceled: params.reason === 'cancel',
    isPolicyBlocked: params.reason === 'policy',
    diagnostics: params.diagnostics,
  };
}
```

### 7.3 Pipe-Architektur mit Source/Destination Normalisierung

execa's `normalizePipeArguments` akzeptiert drei Syntaxen für Piping
(Template, String, Subprocess). Alles wird auf `{sourceStream, destinationStream}` normalisiert.

**PackForge-Anwendung → Pack-Pipeline-Chaining**

```typescript
// Verschiedene Wege, Packs zu verketten:
// 1. Explizit
orchestrator.chain('context-analysis', 'scoring', 'policy-check');

// 2. Als Pipeline-Objekt
const pipeline = Pipeline.from(analyzeContext)
  .pipe(scorePacks)
  .pipe(applyPolicies)
  .pipe(buildHandoff);

// Intern: Alle normalisiert auf { input: PipelineStage, output: PipelineStage }
```

---

## 8. unjs/consola — Reporter-Pattern · Logging-Abstraktionen

**Quellcode**: `src/consola.ts` (509 Zeilen), `src/types.ts` (192 Zeilen),
`src/reporters/fancy.ts` (156 Zeilen)

### 8.1 ConsolaReporter Interface

```typescript
interface ConsolaReporter {
  log: (logObj: LogObject, ctx: { options: ConsolaOptions }) => void;
}
```

Ein einzelnes `log()` mit strukturiertem `LogObject`. Reporter entscheiden
selbst über Formatierung. `FancyReporter extends BasicReporter`.

**PackForge-Anwendung → Activation-Reporter / Audit-System**

```typescript
interface ActivationReporter {
  report(event: ActivationEvent, ctx: ReporterContext): void;
}

type ActivationEvent =
  | { type: 'context:analyzed'; context: ProjectContext }
  | { type: 'scoring:complete'; results: ScoringResult[] }
  | { type: 'policy:evaluated'; diagnostics: PackDiagnostic[] }
  | { type: 'activation:complete'; handoff: RuntimeHandoffContract }
  | { type: 'activation:error'; error: Error };

// Konsolen-Reporter (Entwicklung)
class ConsoleActivationReporter implements ActivationReporter {
  report(event: ActivationEvent): void {
    console.log(`[${event.type}]`, event);
  }
}

// Audit-Reporter (Produktion)
class AuditActivationReporter implements ActivationReporter {
  report(event: ActivationEvent, ctx: ReporterContext): void {
    this.auditLog.append({ ...event, traceId: ctx.traceId, timestamp: new Date() });
  }
}

// JSON-Reporter (MCP-Antwort)
class JsonActivationReporter implements ActivationReporter {
  report(event: ActivationEvent): void {
    if (event.type === 'activation:complete') {
      process.stdout.write(JSON.stringify(event.handoff));
    }
  }
}
```

### 8.2 Pause/Resume Queue

consola kann Logging pausieren und queuen, dann alle gequeuten Logs auf einmal flushen.

**PackForge-Anwendung → Batch-Activation**

```typescript
class ActivationQueue {
  private paused = false;
  private queue: ActivationRequest[] = [];

  pause(): void { this.paused = true; }

  resume(): void {
    this.paused = false;
    const batch = this.queue.splice(0);
    for (const request of batch) {
      this.process(request);
    }
  }

  submit(request: ActivationRequest): void {
    if (this.paused) {
      this.queue.push(request);
      return;
    }
    this.process(request);
  }
}
```

### 8.3 withTag() / withDefaults() — Kontextuelles Logging

consola erlaubt `consola.withTag('orchestrator')` — erzeugt eine neue Instanz
mit vorkonfiguriertem Tag.

**PackForge-Anwendung → Service-spezifische Logger**

```typescript
const logger = createLogger();
const orchestratorLog = logger.withTag('orchestrator');
const policyLog = logger.withTag('policy');
const scorerLog = logger.withTag('scorer');

// In jedem Service:
orchestratorLog.info('Activation started', { projectId });
policyLog.warn('High risk pack detected', { packId });
scorerLog.debug('Score computed', { packId, score });
```

### 8.4 Throttle + Deduplizierung

consola dedupliziert identische Log-Messages innerhalb `throttle` ms
und zeigt stattdessen `(x3)`.

**PackForge-Anwendung → Event-Throttling**

Wenn der Context Analyzer bei File-Watcher-Mode dieselben Signale
wiederholt emittiert, sollte das System identische Events throttlen.

---

## 9. moonrepo/moon — Schema-Design · Action-Pipelines

**Quellcode**: `crates/action-pipeline/src/action_pipeline.rs` (526 Zeilen),
`crates/action-pipeline/src/job_dispatcher.rs` (142 Zeilen),
`crates/config/src/workspace_config.rs` (199 Zeilen)

### 9.1 ActionPipeline mit Event-Subscriber-Architektur

moon's Pipeline hat `setup_subscribers()` die verschiedene Subscriber registriert:
`ConsoleSubscriber`, `RemoteSubscriber`, `ReportsSubscriber`, `WebhooksSubscriber`,
`NotificationsSubscriber`, `TelemetrySubscriber`, `CleanupSubscriber`.

**PackForge-Anwendung → Orchestrator Event-System**

```typescript
class ActivationPipeline {
  private emitter = new EventEmitter();

  async setupSubscribers(config: AppConfig): Promise<void> {
    // Immer: Audit-Log
    this.emitter.subscribe(new AuditSubscriber(config.auditLog));

    // Immer: Metrics
    this.emitter.subscribe(new MetricsSubscriber());

    // Konditional: Console-Output (nur wenn nicht quiet)
    if (!config.quiet) {
      this.emitter.subscribe(new ConsoleSubscriber());
    }

    // Konditional: Webhook (wenn konfiguriert)
    if (config.webhookUrl) {
      this.emitter.subscribe(new WebhookSubscriber(config.webhookUrl));
    }

    // Konditional: Cache-Cleanup
    if (config.autoCleanCache) {
      this.emitter.subscribe(new CacheCleanupSubscriber(config.cacheLifetime));
    }
  }
}
```

**Kern-Lektion**: Subscriber sind konditional basierend auf Config. Nicht alle
Subscriber sind immer aktiv — das hält den Code modular und testbar.

### 9.2 JobDispatcher mit Priority Groups und Topologischer Sortierung

moon's `JobDispatcher` arbeitet mit `BTreeMap<u8, Vec<NodeIndex>>` — Priority Groups
die topologisch sortiert abgearbeitet werden. Deferred Dispatch wenn ein ähnlicher
Job bereits läuft.

**PackForge-Anwendung → Pack-Evaluation-Reihenfolge**

```typescript
interface PriorityGroup {
  priority: number;  // 0 = kritisch, 255 = niedrig
  packIds: string[];
}

class PackEvaluationDispatcher {
  private groups: Map<number, string[]>;

  // Packs nach Priorität evaluieren:
  // - required Packs zuerst (Prio 0)
  // - high-confidence Matches (Prio 1)
  // - conditional Packs (Prio 2)
  async* dispatch(context: ProjectContext): AsyncGenerator<EvaluationResult> {
    for (const [priority, packIds] of this.groups) {
      for (const packId of packIds) {
        yield await this.evaluate(packId, context);
      }
    }
  }
}
```

### 9.3 CancellationToken + Abort-Pattern

moon nutzt `CancellationToken` mit `abort_token` und `cancel_token` —
Unterscheidung zwischen "Abbruch wegen Fehler" und "Abbruch wegen Signal".

**PackForge-Anwendung → Activation-Abort**

```typescript
interface ActivationTokens {
  abort: AbortController;   // Fehler → alles sofort stoppen
  cancel: AbortController;  // User-Signal → graceful shutdown
}

function createActivationTokens(): ActivationTokens {
  return {
    abort: new AbortController(),
    cancel: new AbortController(),
  };
}

// Im Orchestrator:
if (policyResult.severity === 'error') {
  tokens.abort.abort();  // Sofort-Abbruch
}

process.on('SIGINT', () => {
  tokens.cancel.abort();  // Graceful
});
```

### 9.4 WorkspaceConfig mit `config_struct!` Makros + Verschachtelte Enums

moon nutzt Rust-Makros um Config-Strukturen deklarativ zu definieren.
`WorkspaceProjects` ist ein Enum mit drei Varianten: `Both`, `Globs`, `Sources`.

**PackForge-Anwendung → Flexible Config-Formate**

```typescript
// Flexible Workspace-Konfiguration wie moon:
type PackForgeProjects =
  | string[]                              // Nur Globs: ["apps/*"]
  | Record<string, string>                // Name → Path: { "hub": "apps/hub-api" }
  | { globs: string[]; sources: Record<string, string> }; // Beides

// Zod-Schema mit discriminated union:
const PackForgeProjectsSchema = z.union([
  z.array(z.string()),
  z.record(z.string(), z.string()),
  z.object({ globs: z.array(z.string()), sources: z.record(z.string(), z.string()) }),
]);
```

---

## 10. unjs/unbuild — Convention-over-Config · Build-Pipelines

**Quellcode**: `src/build.ts` (415 Zeilen), `src/types.ts` (212 Zeilen),
`src/auto.ts` (176 Zeilen)

### 10.1 Auto-Preset: Entries aus package.json inferieren

unbuild's `autoPreset` liest `package.json` exports/bin/main/module/types und
inferiert automatisch Build-Entries. Kein manuelles Konfigurieren nötig.

**PackForge-Anwendung → Pack-Registry Auto-Discovery**

```typescript
// Statt manuelle Registry-Pflege: Auto-Discovery aus Dateisystem
async function autoDiscoverPacks(packsDir: string): Promise<InstructionPack[]> {
  const yamlFiles = await glob('**/*.yaml', { cwd: packsDir });

  // Wie unbuild: Entries automatisch aus Dateistruktur ableiten
  const packs = await Promise.all(
    yamlFiles.map(async (file) => {
      const raw = await readYaml(path.join(packsDir, file));
      const category = inferCategoryFromPath(file);  // packs/engineering/*.yaml → engineering
      return { ...raw, category, filePath: file };
    })
  );

  return packs;
}

// Wie unbuild's inferEntries: Category aus Directory-Struktur
function inferCategoryFromPath(filePath: string): PackCategory {
  const dir = path.dirname(filePath).split('/')[0];
  if (PackCategory.includes(dir as any)) return dir as PackCategory;
  return 'engineering';  // Default
}
```

### 10.2 BuildContext als zentrales State-Objekt

unbuild's `BuildContext` hält: `options`, `pkg`, `jiti`, `buildEntries`, `usedImports`,
`warnings`, `hooks`. Ein einzelnes Objekt das durch den gesamten Build fließt.

**PackForge-Anwendung → ActivationContext als zentrales State-Objekt**

```typescript
interface ActivationContext {
  options: ActivationOptions;
  projectContext: ProjectContext;
  packRegistry: PackRegistry;
  scores: ScoringResult[];
  diagnostics: PackDiagnostic[];
  warnings: Set<string>;
  hooks: Hookable<ActivationHooks>;
  timings: Map<string, number>;
}

// Wird einmal erstellt und durch die gesamte Pipeline gereicht
function createActivationContext(input: AnalyzeProjectInput): ActivationContext {
  return {
    options: resolveOptions(input),
    projectContext: null!, // Wird in analyze-Phase gefüllt
    packRegistry: PackRegistryCache.getInstance().get(),
    scores: [],
    diagnostics: [],
    warnings: new Set(),
    hooks: createHooks<ActivationHooks>(),
    timings: new Map(),
  };
}
```

### 10.3 BuildHooks Lifecycle

unbuild hat: `build:prepare` → `build:before` → `build:done`.
Zusammen mit modulspezifischen Hooks (CopyHooks, UntypedHooks, MkdistHooks, RollupHooks).

**PackForge-Anwendung → Activation-Hooks**

```typescript
interface ActivationHooks {
  'activation:prepare': (ctx: ActivationContext) => void | Promise<void>;
  'activation:before':  (ctx: ActivationContext) => void | Promise<void>;
  'activation:done':    (ctx: ActivationContext) => void | Promise<void>;

  // Modul-spezifische Hooks:
  'context:analyzed':   (ctx: ActivationContext) => void | Promise<void>;
  'scoring:complete':   (ctx: ActivationContext) => void | Promise<void>;
  'policy:evaluated':   (ctx: ActivationContext) => void | Promise<void>;
  'handoff:built':      (ctx: ActivationContext) => void | Promise<void>;
}
```

### 10.4 defineBuildConfig / definePreset Helper

unbuild bietet `defineBuildConfig()` und `definePreset()` als typsichere
Konfigurations-Helper.

**PackForge-Anwendung → Type-safe Pack-Config Helper**

```typescript
// Für Pack-Autoren: Typsichere Helper-Funktionen
export function defineInstructionPack(config: InstructionPackInput): InstructionPack {
  return InstructionPackSchema.parse(config);
}

export function defineActivationPreset(preset: ActivationPreset): ActivationPreset {
  return preset;
}

// Nutzung in YAML-alternativem TS-Format:
export default defineInstructionPack({
  id: 'fullstack-builder',
  version: '1.0.0',
  category: 'engineering',
  // ... TypeScript autocomplete + Validierung
});
```

### 10.5 failOnWarn Pattern

unbuild kann den Build abbrechen wenn Warnings existieren.

**PackForge-Anwendung → Strict-Mode für Activation**

```typescript
if (ctx.warnings.size > 0 && ctx.options.failOnWarn) {
  throw new ActivationError(
    `Activation aborted: ${ctx.warnings.size} warnings detected.\n` +
    [...ctx.warnings].map(w => `  - ${w}`).join('\n')
  );
}
```

---

## Synthese: Pattern-Map → PackForge Module

| Pattern | Quelle | PackForge-Modul | Priorität |
|---------|--------|-----------------|-----------|
| AsyncLocalStorage Context | zx | Orchestrator | HOCH |
| Snapshot-Pattern | zx | Context Analyzer | HOCH |
| Paralleles Hashing | turborepo | Context Analyzer | MITTEL |
| Cache-Key aus GlobalInputs | turborepo | Activation Cache | HOCH |
| Visitor: init→visit→finish | turborepo | Pack Scorer | HOCH |
| Diagnostics mit Severity/Tags | biome | Policy Engine | HOCH |
| Dependents-Graph | changesets | Pack-Konflikterkennung | MITTEL |
| Convergence Loop | changesets | Orchestrator Matching | HOCH |
| Plugin-Loader-Hierarchie | oclif | Pack Registry | MITTEL |
| Hook-System | oclif | Orchestrator Lifecycle | HOCH |
| Config als DI | oclif | Shared-Config | MITTEL |
| Command-Lifecycle | oclif | Activation Command | MITTEL |
| Minimale detect() | ni | Context Analyzer Fallback | HOCH |
| Runner als Function-Type | ni | Pack Scorer | HOCH |
| CLI-Composition (3 Schichten) | ni | MCP Gateway | MITTEL |
| Exhaustive Result-Type | execa | ActivationResult | HOCH |
| Success/Error Factories | execa | Result Builders | MITTEL |
| Pipe-Normalisierung | execa | Pack Pipeline | NIEDRIG |
| Reporter-Interface | consola | Audit-System | HOCH |
| withTag() Logger | consola | Service-Logger | MITTEL |
| Pause/Resume Queue | consola | Batch-Activation | NIEDRIG |
| Event-Subscriber | moon | Orchestrator Events | HOCH |
| JobDispatcher Priority Groups | moon | Pack-Evaluation-Order | MITTEL |
| CancellationToken | moon | Activation Abort | HOCH |
| Flexible Config Enums | moon | PackForge Config | MITTEL |
| Auto-Discovery Preset | unbuild | Pack Registry Loading | HOCH |
| BuildContext State-Object | unbuild | ActivationContext | HOCH |
| Build-Hooks Lifecycle | unbuild | Activation Hooks | HOCH |
| defineConfig Helper | unbuild | Pack-Authoring DX | MITTEL |
| failOnWarn | unbuild | Strict-Mode | NIEDRIG |

---

## Implementierungsreihenfolge (Empfehlung)

### Phase 1 — Foundation (diese Patterns zuerst)
1. **ActivationContext** als zentrales State-Objekt (unbuild)
2. **AsyncLocalStorage** für Kontext-Propagation (zx)
3. **PackScorer als Function-Type** (ni)
4. **PackDiagnostic** mit Severity/Tags (biome)
5. **ActivationResult** exhaustiver Ergebnis-Typ (execa)

### Phase 2 — Orchestration
6. **Hook-System** mit typisierten Events (oclif + unbuild)
7. **Convergence Loop** für stabile Pack-Selektion (changesets)
8. **Event-Subscriber** Architektur (moon)
9. **CancellationToken** abort vs cancel (moon)
10. **Visitor-Pattern** für Scoring-Pipeline (turborepo)

### Phase 3 — DX & Performance
11. **Auto-Discovery** für Pack-Registry (unbuild)
12. **Cache-Key** aus Context-Hash (turborepo)
13. **Reporter-Interface** für Audit (consola)
14. **withTag() Logger** (consola)
15. **defineInstructionPack()** Helper (unbuild)

### Phase 4 — Polish
16. **Dependents-Graph** für Konflikte (changesets)
17. **Plugin-Loader-Hierarchie** (oclif)
18. **Snapshot-Pattern** (zx)
19. **Config als DI** (oclif)
20. **Flexible Config Enums** (moon)
