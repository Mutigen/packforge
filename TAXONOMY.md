# Instruction Hub – Taxonomie & Orchestrator-Matching

Dieses Dokument beschreibt, wie die Taxonomie-Achsen definiert, gepflegt und
fuer das regelbasierte Matching im Orchestrator genutzt werden.

---

## 1. Wozu die Taxonomie?

Der Orchestrator muss aus einem Projektkontext zuverlaessig ableiten, welche
Instruction Packs aktiviert werden sollen. Die Taxonomie-Achsen sind das
gemeinsame Vokabular zwischen Pack-Autoren und Matching-Logik.

Schlechte Taxonomie = unzuverlaessige Empfehlungen.
Gute Taxonomie = hohe Konfidenz ohne LLM-Overhead in V1.

---

## 2. Die 6 Taxonomie-Achsen

### 2.1 Domain

Branche oder Produkttyp des Projekts.

```typescript
// packages/shared-types/src/taxonomy.ts
export const Domain = [
  'saas',
  'marketplace',
  'developer-tools',
  'fintech',
  'health',
  'internal-tool',
  'content',
  'ecommerce',
  'open-source',
] as const
export type Domain = (typeof Domain)[number]
```

### 2.2 Phase

Entwicklungsphase des Projekts zum Zeitpunkt der Analyse.

```typescript
export const Phase = [
  'discovery',      // Ideenfindung, Konzept
  'architecture',   // System- und Datenmodelldesign
  'mvp',            // Erste lauffaehige Version
  'production',     // Live-System, aktive Nutzer
  'scaling',        // Performance, Multi-Tenant, Kosten
  'maintenance',    // Bugfixes, Tech-Debt, Refactoring
] as const
export type Phase = (typeof Phase)[number]
```

### 2.3 TaskType

Was soll gerade konkret erledigt werden?

```typescript
export const TaskType = [
  'build',        // Neues Feature oder Modul entwickeln
  'review',       // Code- oder Architekturreview
  'analyse',      // Impact, Risk, Coverage analysieren
  'deploy',       // Release, CI/CD, Infrastruktur
  'document',     // Docs, Changelog, API-Referenz
  'debug',        // Fehlersuche, Root-Cause-Analyse
  'refactor',     // Strukturverbesserung ohne Funktionsaenderung
] as const
export type TaskType = (typeof TaskType)[number]
```

### 2.4 RiskProfile

Betriebliches Risikoprofil des Projekts.

```typescript
export const RiskProfile = [
  'prototype',    // Exploration, kein echter Produktionseinsatz
  'production',   // Live, echte Nutzer, Ausfaelle haben Impact
  'regulated',    // Compliance-Pflichten (DSGVO, PCI, HIPAA, etc.)
] as const
export type RiskProfile = (typeof RiskProfile)[number]
```

### 2.5 StackSignals

Erkannte Technologien aus Repo-Dateien (package.json, Dockerfile, etc.).

```typescript
export const StackSignal = [
  'node', 'python', 'go', 'rust',
  'react', 'nextjs', 'vue', 'svelte',
  'fastify', 'express', 'nestjs', 'hono',
  'postgres', 'mysql', 'sqlite', 'mongodb',
  'prisma', 'drizzle', 'typeorm',
  'docker', 'kubernetes', 'terraform',
  'openai', 'anthropic', 'langchain',
] as const
export type StackSignal = (typeof StackSignal)[number]
```

### 2.6 WorkMode

Wie arbeitet das Team?

```typescript
export const WorkMode = [
  'solo',
  'team',
  'agency',
  'open-source',
] as const
export type WorkMode = (typeof WorkMode)[number]
```

---

## 3. Pack-seitige Signal-Deklaration

Jedes Instruction Pack deklariert seine Aktivierungssignale im YAML.
Der Orchestrator gleicht diese gegen den Projektkontext ab.

```yaml
activation_signals:
  keywords:     [api design, database schema, microservices, event-driven, scaling]
  stack_hints:  [node, postgres, fastify, prisma, drizzle]
  task_types:   [architecture, build, database]
  domains:      [saas, fintech, developer-tools]
  phases:       [architecture, mvp]
  risk_profiles: [production, regulated]
```

**Regeln fuer Pack-Autoren:**

- `stack_hints` hat das hoechste Matching-Gewicht – nur echte Stack-Signale eintragen.
- `keywords` sind Freitext-Matches gegen die Projektbeschreibung – sparsam nutzen.
- `domains` breit halten wenn das Pack domainagnostisch nutzbar ist.
- `phases` eng halten wenn das Pack wirklich phasenspezifisch ist.
- `conflicts_with` immer befuellen wenn sich zwei Packs widersprechen wuerden.
- `compatible_with` hilft der UI, sinnvolle Pack-Kombinationen vorzuschlagen.

---

## 4. Scoring-Logik (V1 – regelbasiert)

Datei: `apps/orchestrator/src/matcher.ts`

```typescript
import type { InstructionPack, ProjectContext } from '@hub/shared-types'

export function scorePack(pack: InstructionPack, ctx: ProjectContext): number {
  let score = 0
  const s = pack.activation_signals

  // Stack-Overlap: haertestes Signal, hoechstes Gewicht
  const stackMatches = ctx.stack.filter(t => s.stack_hints.includes(t)).length
  score += stackMatches * 20

  // Phase-Match
  if (s.phases.includes(ctx.phase)) score += 25

  // Domain-Match
  if (s.domains.includes(ctx.domain)) score += 20

  // Task-Type-Match
  if (s.task_types.includes(ctx.taskType)) score += 20

  // Risk-Profile-Match
  if (s.risk_profiles?.includes(ctx.riskProfile)) score += 10

  // Keyword-Overlap in Projektbeschreibung (schwachstes Signal)
  const desc = ctx.description.toLowerCase()
  const kwMatches = s.keywords.filter(k => desc.includes(k)).length
  score += kwMatches * 5

  return Math.min(score, 100)
}
```

### 4.1 Konfidenz-Schwellwerte

| Konfidenz | Empfehlungs-Label | Verhalten in V1 |
|---|---|---|
| >= 80% | Empfohlen (hohe Konfidenz) | Prominent anzeigen, Klick aktiviert sofort |
| 60–79% | Empfohlen | Standard-Listenposition, Klick aktiviert |
| 40–59% | Optional | Ausgeklappt unter "Weitere Optionen" |
| < 40% | Nicht angezeigt | Gefiltert, nur in Debug-Modus sichtbar |

---

## 5. Kontext-Eingabe des Orchestrators

### 5.1 Vollstaendiges Kontext-Objekt

```typescript
// packages/shared-types/src/context.ts
export type ProjectContext = {
  projectId: string
  description: string           // Freitext-Beschreibung des Vorhabens
  stack: StackSignal[]          // Erkannte Technologien
  phase: Phase                  // Aktuelle Entwicklungsphase
  domain: Domain                // Branche / Produkttyp
  taskType: TaskType            // Was wird gerade gemacht
  riskProfile: RiskProfile      // Betriebliches Risikoprofil
  workMode?: WorkMode           // Optional: wie arbeitet das Team
  customKeywords?: string[]     // Optionale zusaetzliche Signale vom User
}
```

### 5.2 Kontext-Quellen (context-analyzer)

| Quelle | Erkannte Signale |
|---|---|
| `package.json` | Node, Framework, ORM, AI-SDKs |
| `requirements.txt` / `pyproject.toml` | Python-Stack |
| `Dockerfile` | Runtime, Ports, Infra-Hinweise |
| `docker-compose.yml` | DB, Cache, Services |
| `.github/workflows/` | CI-Tools, Deploy-Targets |
| Repo-Beschreibung / README | Domain, Phase, Keywords |
| Manuelles Formular (Fallback) | Alle Felder direkt vom User |

---

## 6. Fixtures und Regressionstests

### 6.1 Fixture-Format

Datei: `apps/orchestrator/tests/fixtures/<name>.fixture.json`

```json
{
  "name": "fintech-api-mvp",
  "description": "REST API fuer Zahlungsabwicklung mit Stripe-Integration",
  "stack": ["node", "fastify", "postgres", "drizzle"],
  "phase": "mvp",
  "domain": "fintech",
  "taskType": "build",
  "riskProfile": "production",
  "expectedPacks": {
    "required": ["backend-architect", "security-reviewer"],
    "optional": ["api-contract-writer", "test-strategist"]
  },
  "notExpected": ["ux-writer", "growth-analyst", "devops-specialist"]
}
```

### 6.2 Test-Logik

```typescript
// apps/orchestrator/tests/matcher.test.ts
import { describe, it, expect } from 'vitest'
import { scorePack } from '../src/matcher'
import { loadAllPacks } from '../src/registry'
import fixtures from './fixtures'

describe('Orchestrator Matching', () => {
  for (const fixture of fixtures) {
    it(`empfiehlt korrekte Packs fuer: ${fixture.name}`, () => {
      const packs = loadAllPacks()
      const results = packs
        .map(p => ({ id: p.id, score: scorePack(p, fixture) }))
        .filter(r => r.score >= 60)
        .map(r => r.id)

      for (const expected of fixture.expectedPacks.required) {
        expect(results).toContain(expected)
      }
      for (const notExpected of fixture.notExpected) {
        expect(results).not.toContain(notExpected)
      }
    })
  }
})
```

### 6.3 Starter-Fixtures (Mindestmenge fuer MVP)

| Fixture-Name | Domain | Phase | Stack |
|---|---|---|---|
| `fintech-api-mvp` | fintech | mvp | node, fastify, postgres |
| `saas-frontend-discovery` | saas | discovery | react, nextjs |
| `devtool-fullstack-production` | developer-tools | production | node, react, postgres |
| `internal-tool-refactor` | internal-tool | maintenance | python, postgres |
| `regulated-health-backend` | health | production | node, postgres |

---

## 7. Iterative Kalibrierung (nach MVP-Launch)

### 7.1 Feedback-Loop

Speichere bei jeder Session:
- Empfohlene Packs + jeweilige Konfidenz
- Tatsaechlich aktivierte Packs (User-Klick)
- Uebersprungene empfohlene Packs
- Manuell aktivierte Packs ohne Empfehlung

### 7.2 Auswertung nach 20 Sessions

1. Packs mit hoher Empfehlungs- aber niedriger Aktivierungsrate → Signal-Gewichte reduzieren.
2. Packs, die oft manuell ohne Empfehlung aktiviert werden → `activation_signals` in YAML erweitern.
3. Packs, die oft zusammen aktiviert werden → `compatible_with` ergaenzen.
4. Packs, die nie zusammen funktionieren → `conflicts_with` ergaenzen.

### 7.3 Gewichtungs-Tabelle versionieren

```typescript
// apps/orchestrator/src/weights.ts
export const SCORING_WEIGHTS = {
  stackMatch: 20,   // pro Stack-Overlap
  phaseMatch: 25,   // exakter Phase-Match
  domainMatch: 20,  // exakter Domain-Match
  taskTypeMatch: 20, // exakter TaskType-Match
  riskMatch: 10,    // exakter RiskProfile-Match
  keywordMatch: 5,  // pro Keyword-Match in Description
} as const
```

Diese Datei ist versioniert und bei Aenderungen mit Commit-Message
`chore(taxonomy): adjust scoring weights – reason: <warum>` zu committen.

---

## 8. Goldene Regeln fuer Taxonomie-Pflege

| Regel | Begruendung |
|---|---|
| Lieber zu wenig Packs als zu viele | Jedes Pack muss in der Praxis nuetzlich sein |
| Pack ohne Fixture = kein Merge | Jedes neue Pack braucht mindestens 1 Fixture |
| Stack-Signale sind haerter als Keywords | Dateien luegen nicht, Beschreibungen schon |
| Konflikte explizit deklarieren | Verhindert widerspruchliche aktive Pack-Kombinationen |
| Taxonomie-Achsen spaerlich erweitern | Neue Enum-Werte hoechstens quartalsweise hinzufuegen |
| Alle Achsen ausser `id`, `version`, `risk_level` sind optional | Robustheit vor Vollstaendigkeit |

---

## 9. Versionierung der Taxonomie

Die Taxonomie-Datei `packages/shared-types/src/taxonomy.ts` bekommt eine eigene
Semantic-Version-Notiz im Header:

```typescript
/**
 * Taxonomy Version: 1.0.0
 * Last reviewed: 2026-04-05
 * Changes: Initial definition of 6 axes
 */
```

Bei Breaking Changes (Enum-Werte entfernen oder umbenennen) muss eine
Migration-Note in `docs/taxonomy/CHANGELOG.md` ergaenzt werden,
da bestehende Pack-YAMLs sonst gegen ein veraeltetes Schema validieren.
