<p align="center">
  <strong>packforge</strong>
</p>

<p align="center">
  AI Agent Instruction Hub — orchestrates context-aware instruction packs for Cursor, Claude Code, Codex, and other MCP-compatible agents.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/packforge"><img src="https://img.shields.io/npm/v/packforge?color=cb3837&label=npm" alt="npm"></a>
  <a href="https://github.com/mutigen/packforge/actions/workflows/ci.yml"><img src="https://github.com/mutigen/packforge/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/mutigen/packforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node"></a>
  <a href="https://github.com/mutigen/packforge"><img src="https://img.shields.io/badge/MCP-compatible-purple" alt="MCP"></a>
</p>

---

## What is packforge?

**packforge** analyzes your project context (stack, domain, phase, risk) and recommends the right instruction packs for your AI coding agent. It works as a **Model Context Protocol (MCP)** server — just point your editor at it, describe your project, and get back curated system prompts, tool permissions, and bootstrap steps.

## Highlights

### Zero-Config Project Analysis
Point PackForge at any project and it auto-detects the stack, domain, project phase, and risk profile — no config files needed. It reads `package.json`, file trees, CI workflows, and existing tooling to build a full picture in seconds.

### Context-Aware Pack Activation
Based on the analysis, PackForge selects the right instruction packs (system prompts, constraints, tool permissions) from a registry of **18 packs across 5 categories**. Six composable scorers (stack, taxonomy, keyword, tool-awareness, feedback, work-mode) are combined via `createCompositeScorer()` — swap or weight individual scorers without touching the pipeline. Packs that don't match your context are filtered out; every decision emits structured diagnostics with severity, tags, and actionable suggestions.

### Smart Tool Onboarding
PackForge detects whether GitNexus, MemPalace, and Obsidian are installed — both globally and per-project. Missing tools surface with install guides, concrete benefits, and a list of packs waiting for them. Users can permanently decline suggestions they don't want.

### Per-Project Setup Detection
It's not enough to have a tool installed globally. PackForge checks whether the current project is actually indexed — e.g., does GitNexus have a `.gitnexus/` index for this repo? Does MemPalace have a wing for this folder? If not, it emits a bootstrap step: *"Run this command to set it up."*

### Self-Improving Memory
Every AI agent working with PackForge is **required** to log non-trivial fixes to MemPalace via `mempalace_diary_write`. Each entry captures the problem, root cause, solution, and affected files. Future sessions read these entries first — the system learns from every bug it solves and never repeats the same mistake.

### Staged Activation with Pending Packs
Packs that require unavailable tools (e.g., GitNexus not yet indexed) aren't discarded — they're held as "pending". Once the tool is set up, `reload_activation` promotes them to active without re-running the full analysis.

### GitNexus Deep Integration
When a project has a GitNexus code intelligence graph, PackForge queries it for symbol counts, clusters, and execution flows. Six dedicated packs cover exploring, debugging, impact analysis, refactoring, PR review, and CLI — each with pre-configured MCP tool permissions and a **+25 scoring boost**.

### MemPalace as Persistent Agent Memory
MemPalace gives AI agents memory that survives across conversations. PackForge writes project snapshots after every analysis, reads past decisions before recommending changes, and uses the diary system to accumulate operational knowledge over time.

### 2-Tool UX
The core workflow is two commands: `start_project_from_spec` → `confirm_activation`. Everything else is optional.

### Key Features

- **Context-Aware Recommendations** — analyzes `package.json`, file tree, GitNexus graph, and MemPalace memory to understand your project
- **Composable Scoring** — six individual `PackScorer` functions combined via `createCompositeScorer()`; swap, weight, or extend scorers without touching the pipeline
- **Structured Diagnostics** — every policy check and conflict resolution emits `PackDiagnostic` with severity, tags, and actionable suggestions; `mergeDiagnostic()` + `dedupeDiagnostics()` keep accumulation clean
- **Interrupt / Resume** — activations can be paused with a pending state and resumed later via `resumeActivation(id, decision)`, inspired by LangGraph's human-in-the-loop pattern
- **Activation Lineage** — every activation tracks its `sourceAction` (`auto-score | user-override | reactivation`) and optional `parentActivationId` for full audit trails
- **Typed Stream Parts** — discriminated `StreamPart` union with `stage` and `traceId` enables structured streaming of pipeline progress to the client
- **Lifecycle Hooks** — typed `HookRunner` emits events at each pipeline stage (`context:analyzed`, `scoring:complete`, `policy:evaluated`, `activation:before/after/error`)
- **Event Subscribers** — decoupled `ActivationSubscriber` pattern for telemetry, logging, or external integrations
- **Content-Hash Cache** — pack registry invalidates only when YAML files actually change (SHA-256 hash of directory contents), replacing TTL-based expiration
- **Convergence-Based Conflict Resolution** — iterative conflict loop that stabilizes the kept set instead of single-pass filtering
- **Cancellation Tokens** — `abort` (hard error) + `cancel` (graceful shutdown) propagated through `ActivationContext`
- **18 Instruction Packs** — covering engineering, quality, ops, product, and documentation workflows
- **2-Tool UX** — `start_project_from_spec` → `confirm_activation`. That's it.
- **Staged Activation** — packs requiring unavailable tools (GitNexus, MemPalace) are held as pending; `reload_activation` promotes them once tools are set up
- **Tool Onboarding** — missing tools surface install guides and benefits; users can permanently decline suggestions via `decline_tool_suggestion`
- **GitNexus Integration** — leverages code intelligence graph for deeper context enrichment; subprocess-based graph queries with meta.json fallback
- **MemPalace Integration** — enriches agent context with persistent memory, past decisions, and knowledge graph
- **Obsidian Auto-Discovery** — detects Obsidian vaults from system config and project `.obsidian/` directory
- **Published on npm** — `npx packforge` just works, self-contained bundle via tsup with zero workspace dependencies
- **Turborepo Monorepo** — 7 apps, 6 shared packages, fully typed with Zod schemas

## Architecture

```
                    ┌──────────────────┐
                    │   AI Assistant    │
                    │ (Claude, Cursor)  │
                    └────────┬─────────┘
                             │ stdio
┌────────────────────────────▼──────────────────────────────┐
│                     MCP Gateway                           │
│              (stdio MCP server, 11 tools)                 │
│              + diagnostics in every response               │
└──┬──────────┬──────────┬──────────┬───────────────────────┘
   │          │          │          │
┌──▼───────┐ ┌▼────────┐ ┌▼────────┐ ┌▼──────────────┐
│ Context  │ │Orchestr.│ │ Policy  │ │   Memory      │
│ Analyzer │ │ hooks + │ │ Service │ │   Service     │
│          │ │ events +│ │ struct. │ │(JSON persist.)│
│          │ │ converg.│ │ diags.  │ │               │
└──┬───┬───┘ └────┬────┘ └─────────┘ └───────────────┘
   │   │          │
┌──▼┐ ┌▼────┐  ┌──▼─────────────────────────────────┐
│GN │ │ MP  │  │       Pack Registry (YAML)          │
│   │ │     │  │  18 packs · content-hash cache       │
└───┘ └─────┘  └─────────────────────────────────────┘

GN = GitNexus (code graph)    MP = MemPalace (persistent memory)
```

## Install

### Option A: npx (recommended)

No clone needed — run directly from npm:

```bash
npx packforge --help
```

### Option B: Global install

```bash
npm install -g packforge
packforge --help
```

### Option C: From source

```bash
git clone https://github.com/mutigen/packforge.git
cd packforge
npm install
npx turbo build
npm test
```

### CLI Options

```
packforge [options]

  --packs <dir>      Path to packs directory (or env PACKFORGE_PACKS_DIR)
  --memory <file>    Path to memory JSON file (or env PACKFORGE_MEMORY_FILE)
  --version          Show version
  --help             Show help
```

## MCP Configuration

### Via npx (zero setup)

<details>
<summary><strong>Claude Desktop</strong></summary>

```json
{
  "mcpServers": {
    "packforge": {
      "command": "npx",
      "args": ["-y", "packforge"]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

```json
{
  "mcpServers": {
    "packforge": {
      "command": "npx",
      "args": ["-y", "packforge"]
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code</strong></summary>

Edit `~/Library/Application Support/Code/User/mcp.json` (macOS) or `~/.config/Code/User/mcp.json` (Linux):

```json
{
  "servers": {
    "packforge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "packforge"]
    }
  }
}
```

</details>

### Via source checkout

<details>
<summary><strong>VS Code / Claude Desktop / Cursor</strong></summary>

> **Prerequisite:** Run `npx turbo build` first.

```json
{
  "mcpServers": {
    "packforge": {
      "command": "node",
      "args": ["/absolute/path/to/packforge/apps/mcp-gateway/dist/index.js"],
      "cwd": "/absolute/path/to/packforge",
      "transportType": "stdio"
    }
  }
}
```

</details>

After adding the config, **reload your editor** (VS Code: `Cmd+Shift+P` → "Reload Window"). You should see 11 packforge tools available.

## Usage

Once connected via MCP, use two tools:

1. **`start_project_from_spec`** — describe your project to get pack recommendations
2. **`confirm_activation`** — activate recommended packs and receive system prompts + bootstrap steps

After activation, if external tools become available:

3. **`reload_activation`** — re-evaluate context and promote pending packs to active
4. **`decline_tool_suggestion`** — permanently dismiss a tool suggestion (e.g. GitNexus, MemPalace)

## Pack Categories

| Category | Count | Packs |
|----------|-------|-------|
| Engineering | 5 | backend-architect, frontend-specialist, fullstack-builder, packforge-exploring, packforge-refactoring |
| Quality | 7 | code-security-analysis, packforge-debugging, packforge-impact-analysis, packforge-memory, packforge-pr-review, security-reviewer, test-strategist |
| Ops | 2 | packforge-cli, project-excellence |
| Documentation | 3 | agent-customization, creating-skills, init-project |
| Product | 1 | ux-designer |

## Integrations

### GitNexus

packforge has deep [GitNexus](https://github.com/nicobailon/gitnexus) integration. When a project has a `.gitnexus/` index, the context analyzer reads the knowledge graph (symbol count, clusters, processes) for richer pack matching. Six dedicated GitNexus packs cover exploring, debugging, impact analysis, refactoring, PR review, and CLI operations — each with the correct MCP tool permissions pre-configured. Packs that use `mcp_gitnexus_*` tools get a **+25 scoring boost** when a GitNexus index is detected.

### MemPalace

packforge integrates [MemPalace](https://github.com/milla-jovovich/mempalace) as a persistent memory layer. The context analyzer detects `~/.mempalace/palace/` and reads the palace identity and wing count. The dedicated `packforge-memory` pack provides 5 curated MemPalace tools (`mempalace_search`, `mempalace_status`, `mempalace_kg_query`, `mempalace_add_drawer`, `mempalace_diary_write`) while blocking 14 structural modification tools. All compatible packs include a constraint to check MemPalace for past decisions before making architecture choices. Packs using `mempalace_*` tools get a **+15 scoring boost**.

### Obsidian

packforge detects Obsidian vaults automatically — both from the system-level Obsidian config (`obsidian.json`) and from a project-local `.obsidian/` directory. The detected vault path is included in the project context for richer pack matching.

Instruction packs can also be authored as Obsidian vault blueprints in `vault/`. Each blueprint is a Markdown file with structured sections (personality, constraints, tools, signals) that compiles to a validated YAML pack.

## Project Structure

```
apps/
  context-analyzer/   # Analyzes project stack, domain, phase, GitNexus + MemPalace
  hub-api/            # REST API gateway (alternative to MCP)
  knowledge-compiler/ # Compiles Obsidian vault blueprints to YAML packs
  mcp-gateway/        # MCP stdio server + CLI entrypoint (npx packforge), 11 tools
  memory-service/     # Activation state persistence, interrupt/resume, lineage tracking
  orchestrator/       # Composable scoring, lifecycle hooks, convergence loop, content-hash cache
  policy-service/     # Governance, approval, risk evaluation, structured diagnostics
packages/
  pack-validator/     # YAML pack validation and registry builder
  shared-auth/        # JWT / JWKS auth primitives
  shared-config/      # Centralized config schemas
  shared-otel/        # OpenTelemetry instrumentation
  shared-policy/      # Policy domain models
  shared-types/       # Canonical Zod schemas, ActivationContext, StreamPart, HookRunner, diagnostics reducers
packs/                # 18 YAML instruction packs across 5 categories
vault/                # Obsidian blueprints for pack authoring
scripts/              # Validation and export utilities
```

## Development

```bash
npm run dev           # Start all apps in watch mode
npm run build         # Build all packages
npm test              # Run all tests
npm run type-check    # TypeScript type checking
npm run validate:packs  # Validate all YAML packs against schema
npm run ci            # Full CI pipeline (lint + type-check + test + validate)
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for noncommercial use.

Copyright Levan-Lomidze (Mamiko) by MUT-i-GEN.
