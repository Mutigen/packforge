<p align="center">
  <strong>packforge</strong>
</p>

<p align="center">
  AI Agent Instruction Hub — orchestrates context-aware instruction packs for Cursor, Claude Code, Codex, and other MCP-compatible agents.
</p>

<p align="center">
  <a href="https://github.com/mutigen/packforge/actions/workflows/ci.yml"><img src="https://github.com/mutigen/packforge/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/mutigen/packforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node"></a>
  <a href="https://github.com/mutigen/packforge"><img src="https://img.shields.io/badge/MCP-compatible-purple" alt="MCP"></a>
</p>

---

## What is packforge?

**packforge** analyzes your project context (stack, domain, phase, risk) and recommends the right instruction packs for your AI coding agent. It works as a **Model Context Protocol (MCP)** server — just point your editor at it, describe your project, and get back curated system prompts, tool permissions, and bootstrap steps.

### Key Features

- **Context-Aware Recommendations** — analyzes `package.json`, file tree, GitNexus graph, and MemPalace memory to understand your project
- **18 Instruction Packs** — covering engineering, quality, ops, product, and documentation workflows
- **2-Tool UX** — `start_project_from_spec` → `confirm_activation`. That's it.
- **GitNexus Integration** — leverages code intelligence graph for deeper context enrichment
- **MemPalace Integration** — enriches agent context with persistent memory, past decisions, and knowledge graph
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
│              (stdio MCP server, 8 tools)                  │
└──┬──────────┬──────────┬──────────┬───────────────────────┘
   │          │          │          │
┌──▼───────┐ ┌▼────────┐ ┌▼────────┐ ┌▼──────────────┐
│ Context  │ │Orchestr.│ │ Policy  │ │   Memory      │
│ Analyzer │ │(match + │ │ Service │ │   Service     │
│          │ │ score)  │ │(govern.)│ │(JSON persist.)│
└──┬───┬───┘ └────┬────┘ └─────────┘ └───────────────┘
   │   │          │
┌──▼┐ ┌▼────┐  ┌──▼─────────────────────────────────┐
│GN │ │ MP  │  │       Pack Registry (YAML)          │
│   │ │     │  │    18 packs across 5 categories      │
└───┘ └─────┘  └─────────────────────────────────────┘

GN = GitNexus (code graph)    MP = MemPalace (persistent memory)
```

## Quick Start

```bash
# Clone
git clone https://github.com/mutigen/packforge.git
cd packforge

# Install
npm install

# Build
npx turbo build

# Validate packs
npm run validate:packs

# Run tests
npm test
```

### MCP Configuration

> **Prerequisite:** Run `npx turbo build` first — the gateway serves from `apps/mcp-gateway/dist/index.js`.

The gateway defaults its packs directory to `<cwd>/packs`, so `cwd` **must** point to the monorepo root.

<details>
<summary><strong>VS Code (global — all workspaces)</strong></summary>

Edit `~/.config/Code/User/mcp.json` (Linux) or `~/Library/Application Support/Code/User/mcp.json` (macOS):

```json
{
  "servers": {
    "packforge": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/packforge/apps/mcp-gateway/dist/index.js"],
      "cwd": "/absolute/path/to/packforge"
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code (per-project)</strong></summary>

Create `.vscode/mcp.json` in any project:

```json
{
  "servers": {
    "packforge": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/packforge/apps/mcp-gateway/dist/index.js"],
      "cwd": "/absolute/path/to/packforge"
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop / Cursor</strong></summary>

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

After adding the config, **reload your editor** (VS Code: `Cmd+Shift+P` → "Reload Window"). You should see 8 packforge tools available.

## Usage

Once connected via MCP, use two tools:

1. **`start_project_from_spec`** — describe your project to get pack recommendations
2. **`confirm_activation`** — activate recommended packs and receive system prompts + bootstrap steps

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

### Obsidian (Pack Authoring)

Instruction packs can be authored as Obsidian vault blueprints in `vault/`. Each blueprint is a Markdown file with structured sections (personality, constraints, tools, signals) that compiles to a validated YAML pack. This lets you design packs visually in Obsidian and compile them into the pack registry.

## Project Structure

```
apps/
  context-analyzer/   # Analyzes project stack, domain, phase, GitNexus + MemPalace
  hub-api/            # REST API gateway (alternative to MCP)
  knowledge-compiler/ # Compiles Obsidian vault blueprints to YAML packs
  mcp-gateway/        # MCP stdio server (primary entry point, 8 tools)
  memory-service/     # Activation state persistence (JSON file storage)
  orchestrator/       # Matches and scores packs against context
  policy-service/     # Governance, approval, and risk evaluation
packages/
  pack-validator/     # YAML pack validation and registry builder
  shared-auth/        # JWT / JWKS auth primitives
  shared-config/      # Centralized config schemas
  shared-otel/        # OpenTelemetry instrumentation
  shared-policy/      # Policy domain models
  shared-types/       # Canonical Zod schemas (context, packs, activation)
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
