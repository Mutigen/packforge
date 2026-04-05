# MCP Instruction Hub – Platform Setup

Dieses Dokument beschreibt Architektur, Scope und Umsetzungsplan fuer eine MCP-native Control Plane
fuer spezialisierte KI-Arbeitsweisen.

## Produkt in einem Satz

Ein Instruction Hub, der spezialisierte KI-Verhaltensprofile (Instruction Packs) zentral verwaltet,
per Projektkontext-Analyse passende Spezialisierungen empfiehlt und diese ueber MCP an verbundene
Modelle wie Claude, Cursor oder andere LLMs ausliefert.

## Was das System NICHT ist

- Kein eigenstaendiger Agent, der selbst Aufgaben ausfuehrt.
- Keine klassische Multi-Agent-Orchestrierung mit internen Agenten-Instanzen.
- Kein Chatbot oder LLM-Wrapper.

Das Modell bleibt beim User (Claude, Cursor, etc.). Der Hub steuert NUR dessen Verhalten und
Persoenlichkeit ueber praezise, versionierte Instruction Packs.

## 1. Zielarchitektur

### 1.1 Kernprinzipien

1. Instruction Contract First: Jedes Instruction Pack hat ein striktes Schema (YAML/JSON), versioniert und testbar.
2. Context Before Activation: Der Orchestrator analysiert Projektkontext, bevor Packs empfohlen werden.
3. Human Confirmation in V1: Empfehlungen werden angezeigt, User aktiviert manuell per Klick.
4. Policy Before Side Effects: Vor Aktivierung von Packs mit erhoehtem Risikoprofil optionaler Approval-Gate.
5. Stateless Models, Stateful Hub: Das LLM ist austauschbar, Zustand und Profile liegen im Hub.
6. Observability by Default: Jede Aktivierung bekommt Trace-ID, Audit-Trail und Herkunftsprotokoll.

### 1.2 Kernkomponenten

1. `hub-api`: REST/MCP-API fuer Pack-Verwaltung, Projektanalyse, Aktivierungsstatus, RBAC.
2. `mcp-gateway`: Auth, Routing, Rate-Limits, Pack-Allowlist, Kostenlimits; MCP-Endpunkt fuer Modelle.
3. `orchestrator`: Liest Projektkontext, fuehrt Taxonomie-Matching durch, gibt Empfehlungsliste aus.
4. `pack-registry`: Versionierter Speicher fuer Instruction Packs (YAML/JSON), inkl. Schema-Validation.
5. `context-analyzer`: Liest Repo-Signale, Projekt-Beschreibung, Stack, Phase und Domaine; erzeugt Kontext-Vektor.
6. `policy-service`: Risk Scoring pro Pack-Kombination, Approval Gates fuer sensible Konfigurationen.
7. `memory-service`: User/Project/Session Memory, Aktivierungshistorie, Retrieval.
8. `postgres`: Persistenz fuer Packs, Aktivierungen, Projekte, Audit, Config, Memory.
9. `object-storage`: Pack-Artefakte, Snapshots, Reports, Exportbundles.
10. `observability`: Traces, Logs, Dashboards, Alerts pro Pack-Aktivierung.

## 2. Instruction Packs – Kernkonzept

### 2.1 Was ist ein Instruction Pack?

Ein Instruction Pack ist eine versionierte, deklarative Konfigurationsdatei (YAML), die einem verbundenen
LLM eine exakte Persoenlichkeit, Arbeitsweise, Priorisierungslogik und Verhaltensregeln fuer eine
spezifische Spezialisierung gibt.

Beispiel: `architect-backend.yaml`, `security-reviewer.yaml`, `ux-writer.yaml`, `growth-analyst.yaml`

### 2.2 Struktur eines Instruction Packs (Minimalschema)

```yaml
id: architect-backend
version: 1.2.0
name: Backend Architect
description: Spezialisierung fuer Systemdesign, API-Contracts, Datenbankmodellierung und Skalierungsplanung.
category: engineering
domain: [saas, developer-tools, fintech]
phase: [architecture, mvp, scaling]
risk_level: low
personality:
  tone: precise
  reasoning_style: trade-off-first
  output_format: structured
instructions:
  system_prompt: |
    Du bist ein erfahrener Backend-Architekt. Du analysierst Anforderungen praesize,
    erkennst Abhaengigkeiten fruehzeitig und lieferst kompakte Trade-off-Analysen
    bevor du implementierst. Du fragst nach, wenn der Kontext unklar ist.
  constraints:
    - Kein Over-Engineering ohne explizite Begruendung.
    - Immer Datenbankschema-Implikationen nennen wenn Entitaeten veraendert werden.
    - Sicherheitsrelevante Entscheidungen explizit marken.
  tools_allowed: [read_file, search, context, impact_analysis]
  tools_blocked: [deploy, merge]
activation_signals:
  keywords: [api design, database schema, microservices, event-driven, scaling]
  stack_hints: [node, postgres, fastify, prisma, drizzle]
  task_types: [architecture, backend, database]
conflicts_with: []
compatible_with: [security-reviewer, api-contract-writer]
```

### 2.3 Pack-Kategorien (Starttaxonomie)

| Kategorie | Beispiel-Packs | Typische Aktivierungsphase |
|---|---|---|
| Engineering | backend-architect, frontend-specialist, fullstack-builder | Architektur, MVP, Skalierung |
| Quality | security-reviewer, test-strategist, code-reviewer | Review, Pre-Deploy |
| Product | ux-writer, growth-analyst, product-strategist | Discovery, Launch |
| Documentation | technical-writer, changelog-assistant, api-documenter | Jede Phase |
| Ops | devops-specialist, incident-analyst, cost-optimizer | Betrieb, Skalierung |

## 3. Orchestrator und Taxonomie

### 3.1 Aufgabe des Orchestrators

Der Orchestrator empfaengt Projektkontext und gibt eine priorisierte Empfehlungsliste zurueck.
Er kuemmert sich NICHT um die Ausfuehrung, sondern nur um die Auswahl der richtigen Packs.

### 3.2 Analyse-Inputs

```
Eingabe 1: Projektbeschreibung (Freitext oder strukturiert)
Eingabe 2: Tech Stack (aus package.json, Pyproject, Dockerfile, etc.)
Eingabe 3: Projektphase (Discovery / Architektur / MVP / Produktion / Skalierung)
Eingabe 4: Domaine (z.B. SaaS, Marketplace, Developer Tool, Health, Fintech)
Eingabe 5: Aktueller Task-Typ (Build, Review, Analyse, Deploy, Dokumentation)
Eingabe 6: Risikoprofil des Projekts (Prototype / Production / Regulated)
```

### 3.3 V1 – Empfehlungsmodus (manuell)

In V1 spricht der Orchestrator Empfehlungen aus. Der User sieht eine UI-Liste und aktiviert per Klick.

```
Orchestrator Output (V1):

Empfohlene Packs fuer "Fintech API Backend, Phase: MVP, Stack: Node/Postgres":

[Aktivieren] backend-architect        Konfidenz: 92%  Grund: Stack-Match + Phase-Match
[Aktivieren] security-reviewer        Konfidenz: 88%  Grund: Domaine Fintech + Risk high
[Aktivieren] api-contract-writer      Konfidenz: 74%  Grund: API-Output erkannt
[Optional]   test-strategist          Konfidenz: 61%  Grund: MVP-Phase, kein Test-Signal im Stack

Nicht empfohlen: ux-writer (keine Frontend-Signale), growth-analyst (zu frueh fuer Phase)
```

### 3.4 V2 – Auto-Aktivierung (mit Policy-Gate)

V2 aktiviert automatisch bei Konfidenz >= 80% wenn risk_level = low.
Alles mit risk_level = medium oder high bleibt immer auf Human-Confirm.

## 4. Empfohlener Tech Stack

### 4.1 Runtime und Frameworks

- Node.js 22 LTS
- TypeScript 5.x
- Fastify (API/Gateway)
- Zod fuer Runtime-Schema-Validation
- js-yaml fuer Pack-Parsing und -Validation
- Pino fuer strukturierte Logs

### 4.2 Daten und Infrastruktur

- PostgreSQL 16+
- pgvector (Embeddings)
- Redis 7+ (Caching, optionale Queue-Features)
- NATS (optional fuer Eventing, wenn noetig)
- S3-kompatibler Storage (MinIO lokal, S3 in Cloud)

### 4.3 Observability

- OpenTelemetry SDK
- OTEL Collector
- Grafana + Loki + Tempo + Prometheus
- Sentry (optional fuer Exception Tracking)

### 4.4 Security und Policy

- JWT + RBAC
- Secret Manager (1Password Connect, Vault, AWS/GCP Secret Manager)
- OPA (Open Policy Agent) oder eigener Rule-Interpreter
- KMS-gestuetzte Verschluesselung fuer sensitive Felder

## 5. Repository Struktur

```text
mcp-instruction-hub/
  apps/
    hub-api/              # REST + MCP Endpunkte, RBAC, Pack-Verwaltung
    mcp-gateway/          # Auth, Routing, Allowlist, MCP-Protokoll
    orchestrator/         # Taxonomie-Matching, Empfehlungslogik
    context-analyzer/     # Repo-Signale lesen, Kontext-Vektor bauen
    policy-service/       # Risk Scoring, Approval Gates
    memory-service/       # Aktivierungshistorie, Retrieval
  packs/
    engineering/
      backend-architect.yaml
      frontend-specialist.yaml
      fullstack-builder.yaml
    quality/
      security-reviewer.yaml
      test-strategist.yaml
      code-reviewer.yaml
    product/
      ux-writer.yaml
      growth-analyst.yaml
      product-strategist.yaml
    documentation/
      technical-writer.yaml
      changelog-assistant.yaml
    ops/
      devops-specialist.yaml
  packages/
    shared-types/         # Pack-Schema, Kontext-Typen, API-Contracts
    shared-config/
    shared-otel/
    shared-auth/
    shared-policy/
    pack-validator/       # Zod-basierte Schema-Validation fuer Packs
  infra/
    docker/
    k8s/
    terraform/
  docs/
    architecture/
    pack-authoring/       # Anleitung: wie schreibt man ein Pack
    taxonomy/             # Taxonomiedokumentation
    runbooks/
  scripts/
    validate-packs.ts     # Validiert alle Packs gegen Schema
    export-registry.ts    # Exportiert Registry als JSON
  .github/workflows/
```

## 6. Mindestabhaengigkeiten pro Service

### 6.1 hub-api

```bash
npm install fastify @fastify/jwt @fastify/cors zod pino pino-pretty
npm install @opentelemetry/api @opentelemetry/sdk-node
npm install drizzle-orm pg js-yaml
npm install -D typescript tsx vitest @types/node
```

### 6.2 mcp-gateway

```bash
npm install fastify undici zod pino
npm install @opentelemetry/api @opentelemetry/sdk-node
npm install jose lru-cache
npm install @modelcontextprotocol/sdk
npm install -D typescript tsx vitest @types/node
```

### 6.3 orchestrator

```bash
npm install zod pino js-yaml
npm install openai @anthropic-ai/sdk   # fuer Kontext-Analyse per LLM (optional in V1)
npm install -D typescript tsx vitest @types/node
```

### 6.4 context-analyzer

```bash
npm install zod pino simple-git globby js-yaml
npm install -D typescript tsx vitest @types/node
```

### 6.5 policy-service

```bash
npm install fastify zod pino
npm install opa-wasm
npm install -D typescript tsx vitest @types/node
```

### 6.6 memory-service

```bash
npm install fastify zod pino pg drizzle-orm
npm install pgvector
npm install -D typescript tsx vitest @types/node
```

### 6.7 pack-validator (shared package)

```bash
npm install zod js-yaml
npm install -D typescript tsx vitest @types/node
```

## 7. Infra Abhaengigkeiten

### 7.1 Lokal (Docker Compose)

- postgres:16 + pgvector Extension
- redis:7
- minio/minio
- grafana/grafana
- grafana/loki
- grafana/tempo
- prom/prometheus
- otel/opentelemetry-collector

Hinweis: Temporal wird in V1 NICHT benoetigt. Die Orchestrierungslogik ist synchron + leichtgewichtig.

### 7.2 Cloud (spaeter)

- Managed Postgres
- Managed Object Storage
- Managed K8s oder ECS/Fargate
- Temporal Cloud (falls Workflow-Orchestrierung spaeter noetig wird)

## 8. Environment Variablen

### 8.1 Global

```env
NODE_ENV=development
LOG_LEVEL=info
PORT=3000
JWT_ISSUER=mcp-instruction-hub
JWT_AUDIENCE=hub-users
JWT_PUBLIC_KEY=...
JWT_PRIVATE_KEY=...
```

### 8.2 Database/Cache

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/instruction_hub
REDIS_URL=redis://localhost:6379
```

### 8.3 Storage

```env
S3_ENDPOINT=http://localhost:9000
S3_REGION=eu-central-1
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio123
S3_BUCKET=hub-artifacts
S3_FORCE_PATH_STYLE=true
```

### 8.4 Observability

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=hub-api
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.2
SENTRY_DSN=
```

### 8.5 Model/Provider (fuer Kontext-Analyse des Orchestrators)

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
ORCHESTRATOR_MODEL=claude-3-7-sonnet
ORCHESTRATOR_MODE=recommendation   # recommendation | auto (V2)
ORCHESTRATOR_CONFIDENCE_THRESHOLD=0.80
```

## 9. RBAC und Zugriffsrollen

### 9.1 Plattformrollen

| Rolle | Kann tun |
|---|---|
| viewer | Packs lesen, Empfehlungen sehen |
| operator | Packs aktivieren/deaktivieren, Projekte anlegen |
| author | Packs erstellen und versionieren |
| admin | Alles inkl. Policy-Konfiguration, User-Management |

### 9.2 MCP-Verbindungsrollen

| Rolle | Zugriff |
|---|---|
| model-readonly | Nur aktivierte Packs lesen |
| model-interactive | Kontext senden, Empfehlungen anfragen |
| model-admin | Packs per MCP-Call aktivieren (nur mit Approval) |

## 10. Policy und Risk Gates

### 10.1 Risk Level pro Pack

Jedes Pack deklariert sein eigenes `risk_level`:
- `low`: Verhaltens- und Persoenlichkeitsaenderungen, keine Seiteneffekte
- `medium`: Zugriff auf Write-Tools, Repo-Aktionen, API-Calls
- `high`: Deploy-Rechte, Security-kritische Konfigurationen, Multi-System-Aktionen

### 10.2 Standard Gates (V1)

1. Risk low: User-Klick genuegt, sofort aktiv.
2. Risk medium: Hinweis im UI, bestaetigen per Klick.
3. Risk high: Separates Approval-Modal mit Begruendungspflicht.
4. Risk critical: Blockiert, Eskalation an Admin noetig.

## 11. Logging, Audit, Compliance

### 11.1 Pro Aktivierung speichern

- Activation-ID, Project-ID, Pack-ID, Pack-Version
- Ausloeser (user-click, auto, api-call)
- Kontext-Vektor-Snapshot (Inputs des Orchestrators)
- Konfidenz-Score des Orchestrators
- Human-Bestaetigung (wer, wann)
- Aktive Dauer, Deaktivierungszeitpunkt

### 11.2 Mindestfelder fuer Audits

- `trace_id`
- `activation_id`
- `project_id`
- `pack_id`
- `pack_version`
- `actor_type` (user/system/api)
- `risk_level`
- `orchestrator_confidence`

## 12. Entwicklungs- und Release-Setup

### 12.1 NPM Scripts

```json
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "test": "turbo run test",
    "type-check": "turbo run type-check",
    "lint": "turbo run lint",
    "validate:packs": "tsx scripts/validate-packs.ts",
    "export:registry": "tsx scripts/export-registry.ts",
    "ci": "npm run lint && npm run type-check && npm run test && npm run validate:packs"
  }
}
```

### 12.2 CI Pipeline

1. Lint
2. Typecheck
3. Unit Tests
4. Pack Schema Validation (alle YAML gegen Zod-Schema)
5. Orchestrator Matching Tests (Kontext-Fixtures gegen erwartete Packs)
6. Security Scan (SAST + dependency audit)
7. Build/Release Artifact

## 13. Skalierungspfad

### 13.1 Was gleich bleibt

- Instruction Pack Schema (YAML/JSON)
- Taxonomie-Achsen und Matching-Logik
- Policy/Gate Logik
- Audit Datenmodell
- MCP-Protokoll-Contracts

### 13.2 Was hochskaliert

- Auto-Aktivierung bei high-confidence (V2)
- Multi-tenant Pack-Isolation
- Pack-Marketplace fuer externe Autoren
- Feingranulares RBAC
- Kostenbudgets pro Projekt/Team/Modell
- Evaluationssuite mit Regression-Gate fuer Orchestrator-Qualitaet

## 14. Setup Reihenfolge (empfohlen)

1. Repo-Skeleton + shared packages + pack-validator.
2. Postgres + pgvector lokal via Docker.
3. Erste 5 Instruction Packs als YAML schreiben und validieren.
4. hub-api Grundgeruest (CRUD fuer Packs, Projekte, Aktivierungen).
5. mcp-gateway mit JWT Auth + Pack-Auslieferung per MCP.
6. context-analyzer: Stack-Erkennung + Taxonomie-Matching (regelbasiert in V1).
7. Orchestrator: Empfehlungslogik + UI-Output.
8. V1 UI: Empfehlungsliste + manueller Aktivierungs-Klick.
9. policy-service + high-risk Approval Gate.
10. Observability + Dashboards.

## 15. Definition of Done fuer MVP

1. Mindestens 10 Instruction Packs sind schema-valide und versioniert.
2. Orchestrator empfiehlt pass Ende zu Kontext-Eingabe korrekte Packs.
3. User kann Packs per Klick aktivieren/deaktivieren.
4. Verbundenes Modell (Claude/Cursor) erhaelt Pack-Inhalt korrekt ueber MCP.
5. Jede Aktivierung ist auditiert und tracebar.
6. High-Risk-Packs koennen ohne Approval nicht aktiviert werden.
7. CI deckt lint/typecheck/tests/pack-validation ab.

## 16. Optionale Erweiterungen (nach MVP)

1. Auto-Aktivierung per Konfidenz-Schwellwert (V2).
2. Pack-Marketplace fuer Community-Beitraege.
3. Evaluationssuite: Orchestrator-Qualitaet per Test-Fixtures messen.
4. Replay-Modus: vergangene Aktivierungen rekonstruieren.
5. Multi-Modell-Routing: je Pack das passende LLM waehlen.
6. Pack-Kompositionslogik: mehrere Packs konfliktfrei zusammenfuehren.
7. Cost-Aware Activation: Aktivierung kostenguenstigerer Pack-Varianten bei Budgetlimit.

## 17. Starter-Checkliste

- [ ] Monorepo und Grundstruktur erstellt
- [ ] Postgres + pgvector laeuft
- [ ] Erste 5 Packs schema-valide als YAML
- [ ] Hub-API mit Pack-CRUD live
- [ ] MCP-Gateway mit JWT Auth live
- [ ] 1 verbundenes Modell (Claude oder Cursor) empfaengt Pack korrekt
- [ ] Orchestrator gibt Empfehlungsliste fuer Test-Projekt aus
- [ ] User kann Pack per Klick aktivieren (V1 UI)
- [ ] High-Risk Gate aktiv und testbar
- [ ] OpenTelemetry Traces sichtbar
- [ ] CI Pipeline gruen

---

Das System startet schlank als manueller Empfehlungs-Hub (V1) und waechst zu einer vollautomatischen
Instruction Control Plane fuer beliebig viele verbundene Modelle.
