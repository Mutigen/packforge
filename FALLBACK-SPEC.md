# context-analyzer – Fallback-Modus Spezifikation

## 1. Ziel

Der context-analyzer MUSS ohne GitNexus-Index funktionieren.
GitNexus ist eine optionale Signalquelle, keine Pflichtabhaengigkeit.

Wenn kein GitNexus-Index existiert (oder der MCP-Server nicht erreichbar ist),
produziert der context-analyzer einen validen ProjectContext mit reduziertem
Confidence-Level und klar markierter Signalquelle.

---

## 2. Betriebsmodi

```typescript
export type AnalyzerMode =
  | 'full'       // GitNexus-Index vorhanden + MCP erreichbar → alle Signale
  | 'fallback'   // kein GitNexus-Index oder MCP-Fehler → nur Datei-Scan
  | 'manual'     // kein Repo, User fuellt Formular aus
```

Das aktive `mode` wird im erzeugten `ProjectContext` mitgefuehrt
und ist Pflichtfeld in jedem Orchestrator-Request.

---

## 3. Signalquellen pro Modus

| Signal | full | fallback | manual |
|---|---|---|---|
| GitNexus: Cluster-Namen | yes | no | no |
| GitNexus: risk_level (detect_changes) | yes | no | no |
| GitNexus: Abhaengigkeitsdichte | yes | no | no |
| package.json / pyproject.toml | yes | yes | no |
| Dockerfile / docker-compose.yml | yes | yes | no |
| .github/workflows | yes | yes | no |
| README.md (Keyword-Scan) | yes | yes | no |
| Dateibaum-Heuristik | yes | yes | no |
| User-Formular | no | no | yes |

---

## 4. Dateiquellen und extrahierte Signale (fallback)

### 4.1 package.json

```typescript
// Erkannte Stack-Signale:
const PACKAGE_SIGNALS: Record<string, StackSignal[]> = {
  fastify: ['fastify', 'node'],
  express: ['express', 'node'],
  nestjs: ['nestjs', 'node'],
  'next': ['nextjs', 'react', 'node'],
  react: ['react'],
  vue: ['vue'],
  svelte: ['svelte'],
  prisma: ['prisma'],
  drizzle: ['drizzle'],
  typeorm: ['typeorm'],
  pg: ['postgres'],
  mysql2: ['mysql'],
  mongoose: ['mongodb'],
  openai: ['openai'],
  '@anthropic-ai/sdk': ['anthropic'],
  '@temporalio/client': ['temporal'],
  '@modelcontextprotocol/sdk': ['mcp'],
  vitest: ['node'],
  jest: ['node'],
}
```

### 4.2 Dockerfile / docker-compose.yml

| Pattern | Signal |
|---|---|
| `FROM node:` | node |
| `FROM python:` | python |
| `FROM golang:` | go |
| `image: postgres` | postgres |
| `image: mysql` | mysql |
| `image: redis` | redis |
| `image: mongo` | mongodb |

### 4.3 .github/workflows YAML-Scan

| Pattern | Signal |
|---|---|
| `npm run build` / `turbo` | node |
| `pip install` / `poetry` | python |
| `docker push` / AWS ECR | deploy, docker |
| `terraform apply` | terraform |

### 4.4 README.md Keyword-Scan (schwachstes Signal)

Einfacher Lowercase-Match gegen Taxonomie-Keywords.
Maximal 5 Keywords, kein Freitext-NLP.

### 4.5 Dateibaum-Heuristik

```typescript
// Phase-Inference aus Dateibaum
const PHASE_SIGNALS: Record<string, Phase> = {
  'CHANGELOG.md':        'production',   // existiert → etabliertes Projekt
  'terraform/':          'production',   // Infra-Code → produktionsnah
  '.github/workflows/':  'mvp',          // CI vorhanden → MVP+
  'docs/':               'architecture', // Docs-Ordner → strukturierte Phase
  // kein obiges Signal  → 'discovery'
}
```

---

## 5. Confidence-Korrekturfaktor

```typescript
export const MODE_CONFIDENCE_FACTOR: Record<AnalyzerMode, number> = {
  full:     1.0,   // voller Score, keine Korrektur
  fallback: 0.75,  // 25% Abzug auf alle Pack-Scores
  manual:   0.65,  // 35% Abzug, User-Input ohne Verifikation
}

// Anwendung im Orchestrator:
const adjustedScore = rawScore * MODE_CONFIDENCE_FACTOR[ctx.analyzerMode]
```

---

## 6. UI-Markierungspflicht

Wenn `analyzerMode !== 'full'`, MUSS die Empfehlungsliste einen deutlichen Hinweis anzeigen:

```
⚠ Fallback-Modus: Kein GitNexus-Index gefunden.
  Empfehlungen basieren auf Datei-Scan (package.json, Dockerfile, README).
  Konfidenz reduziert. GitNexus indexieren für präzisere Empfehlungen:
  → npx gitnexus analyze
```

Fuer `manual`:

```
ℹ Manueller Modus: Signale basieren auf deinen Eingaben.
  Kein Repo analysiert.
```

---

## 7. Fehlerklassen und Verhalten

| Fehlerfall | Verhalten |
|---|---|
| GitNexus MCP nicht erreichbar (ECONNREFUSED) | Stille Fallback-Aktivierung, kein hard fail |
| GitNexus MCP antwortet mit Timeout > 3s | Fallback-Aktivierung, Timeout in Trace loggen |
| GitNexus-Index veraltet (stale > 7 Tage) | Weiter als `full` laufen, aber Staleness-Flag setzen |
| package.json nicht vorhanden | Nur README + Dateibaum-Heuristik |
| Kein Repo vorhanden | Automatisch `manual`-Modus |
| Alle Signale ergeben leeres context.stack | Empfehlungsliste leer, Meldung: "Bitte Projekt beschreiben" |

---

## 8. ProjectContext-Ausgabe mit Modus-Pflichtfeldern

```typescript
export type ProjectContext = {
  projectId: string
  description: string
  stack: StackSignal[]
  phase: Phase
  domain: Domain
  taskType: TaskType
  riskProfile: RiskProfile
  workMode?: WorkMode
  customKeywords?: string[]
  // neu: Pflichtfelder fuer Fallback-Transparenz
  analyzerMode: AnalyzerMode
  analyzerSources: AnalyzerSource[]   // welche Quellen wurden ausgewertet
  gitNexusStaleDays?: number          // gesetzt wenn Index vorhanden aber veraltet
  confidenceFactor: number            // 0.65 | 0.75 | 1.0
}

export type AnalyzerSource =
  | 'gitnexus-mcp'
  | 'package-json'
  | 'dockerfile'
  | 'github-workflows'
  | 'readme-keywords'
  | 'filetree-heuristic'
  | 'user-form'
```

---

## 9. Implementierungsstruktur

```
apps/context-analyzer/src/
  index.ts              # Einstiegspunkt: bestimmt Modus, delegiert
  modes/
    full.ts             # GitNexus-MCP-Calls, dann Datei-Scan
    fallback.ts         # Nur Datei-Scan ohne GitNexus
    manual.ts           # Nur User-Formular-Input
  scanners/
    package-json.ts
    dockerfile.ts
    github-workflows.ts
    readme.ts
    filetree.ts
  gitnexus/
    client.ts           # MCP-Client-Wrapper fuer GitNexus
    availability.ts     # prueft ob Index vorhanden + nicht veraltet
  types.ts              # re-export aus shared-types
```

---

## 10. Testmatrix (Gate B Kriterien)

Alle Tests laufen in `apps/context-analyzer/tests/`.

| Test-ID | Szenario | Erwartetes Ergebnis |
|---|---|---|
| CA-01 | GitNexus verfuegbar, Index fresh | analyzerMode = full, confidenceFactor = 1.0 |
| CA-02 | GitNexus nicht erreichbar | analyzerMode = fallback, kein Fehler geworfen |
| CA-03 | GitNexus Timeout | analyzerMode = fallback, Timeout in Trace |
| CA-04 | Index veraltet (10 Tage) | analyzerMode = full, gitNexusStaleDays = 10 |
| CA-05 | Kein Repo, nur User-Input | analyzerMode = manual, confidenceFactor = 0.65 |
| CA-06 | package.json mit nextjs, prisma | stack enthaelt nextjs, react, node, prisma |
| CA-07 | Dockerfile mit postgres-image | stack enthaelt postgres |
| CA-08 | Kein package.json, kein Dockerfile | stack = [], Meldung "Bitte Projekt beschreiben" |
| CA-09 | CHANGELOG.md vorhanden | phase = production (ohne weitere Signale) |
| CA-10 | Kein Signal fuer Domain | domain = undefined, orchestrator zeigt leere Liste |

**Gate B gilt als geschlossen wenn CA-01 bis CA-10 alle gruen.**

---

## 11. Open Questions (vor Implementierung klaeren)

- [ ] GitNexus-MCP-Client: eigener minimaler MCP-Client oder SDK-Nutzung von `@modelcontextprotocol/sdk`?
- [ ] Staleness-Schwellwert: 7 Tage als Default ok, oder konfigurierbar per ENV?
- [ ] Formular-Schema fuer manual-Modus: eigenes UI-Formular oder CLI-Prompt?
