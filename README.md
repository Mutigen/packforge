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

- **Context-Aware Recommendations** — analyzes `package.json`, file tree, and GitNexus graph to understand your project
- **17+ Instruction Packs** — covering engineering, quality, ops, product, and documentation workflows
- **2-Tool UX** — `start_project_from_spec` → `confirm_activation`. That's it.
- **GitNexus Integration** — leverages code intelligence graph for deeper context enrichment
- **Turborepo Monorepo** — modular architecture with shared types, context analyzer, orchestrator, and MCP gateway

## Architecture

```
┌─────────────────────────────────────────────┐
│                MCP Gateway                   │
│         (stdio MCP server, 8 tools)          │
└──────────────┬──────────────────┬────────────┘
               │                  │
    ┌──────────▼──────┐  ┌───────▼─────────┐
    │ Context Analyzer │  │   Orchestrator   │
    │  (stack/domain)  │  │ (match + score)  │
    └──────────┬──────┘  └───────┬─────────┘
               │                  │
    ┌──────────▼──────────────────▼─────────┐
    │           Pack Registry (YAML)         │
    │   17 packs across 5 categories         │
    └───────────────────────────────────────┘
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

Add to your editor's MCP config (e.g. `.cursor/mcp.json` or Claude Desktop):

```json
{
  "mcpServers": {
    "packforge": {
      "command": "node",
      "args": ["apps/mcp-gateway/dist/index.js"],
      "transportType": "stdio"
    }
  }
}
```

## Usage

Once connected via MCP, use two tools:

1. **`start_project_from_spec`** — describe your project to get pack recommendations
2. **`confirm_activation`** — activate recommended packs and receive system prompts + bootstrap steps

## Pack Categories

| Category | Packs | Examples |
|----------|-------|---------|
| Engineering | 7 | GitNexus Explorer, Refactoring Specialist, Full-Stack Dev |
| Quality | 4 | GitNexus Debugger, Impact Analyst, PR Reviewer, QA Engineer |
| Ops | 2 | GitNexus CLI Operator, DevOps Pipeline |
| Product | 2 | Product Strategist, Growth Analyst |
| Documentation | 2 | Technical Writer, API Documenter |

## Project Structure

```
apps/
  context-analyzer/   # Analyzes project stack, domain, phase
  orchestrator/       # Matches and scores packs against context
  mcp-gateway/        # MCP stdio server (primary entry point)
packages/
  shared-types/       # Zod schemas shared across apps
packs/                # 17 YAML instruction packs
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
