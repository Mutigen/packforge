# packforge

AI Agent Instruction Hub — orchestrates context-aware instruction packs for Cursor, Claude Code, Codex, and other MCP-compatible agents.

[![CI](https://github.com/mutigen/packforge/actions/workflows/ci.yml/badge.svg)](https://github.com/mutigen/packforge/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](https://github.com/mutigen/packforge/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://github.com/mutigen/packforge)

## Quick Start

```bash
npx packforge
```

That's it. PackForge starts as an MCP server over stdio.

## Configure Your Editor

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "packforge": {
      "command": "npx",
      "args": ["packforge"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "packforge": {
      "command": "npx",
      "args": ["packforge"]
    }
  }
}
```

### VS Code (Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "packforge": {
      "command": "npx",
      "args": ["packforge"]
    }
  }
}
```

## What It Does

PackForge analyzes your project context (stack, domain, phase, risk profile) and selects the right instruction packs for your AI coding agent. The core workflow is two MCP tools:

1. **`start_project_from_spec`** — Point at a spec file or describe your project. PackForge auto-detects the stack, analyzes context, scores 18 instruction packs, resolves conflicts, runs policy checks, and returns a curated handoff contract.

2. **`confirm_activation`** — Approve the activation. Your agent receives tailored system prompts, tool permissions, constraints, and bootstrap steps.

### What's in a Handoff Contract

- **System prompts** — Curated instructions per active pack
- **Tool permissions** — Which MCP tools each pack can use
- **Constraints** — Guardrails and anti-patterns to avoid
- **Bootstrap steps** — Shell commands to set up missing tools
- **Missing tool guides** — Install instructions for GitNexus, MemPalace, Obsidian
- **Policy decisions** — Risk-based approval gates

## CLI Options

```
packforge [options]

Options:
  --packs, --packs-dir <path>    Path to instruction packs directory
  --memory, --memory-file <path> Path to memory JSON file
  -h, --help                     Show this help message
  -v, --version                  Show version

Environment variables:
  PACKFORGE_PACKS_DIR            Path to instruction packs directory
  PACKFORGE_MEMORY_FILE          Path to memory JSON file
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `analyze_project_context` | Analyze a project and return its normalized context |
| `recommend_packs` | Recommend instruction packs for a given context |
| `activate_pack_set` | Create an activation from context and store the result |
| `start_project_from_spec` | Full pipeline from spec file to activation |
| `confirm_activation` | Approve a pending activation |
| `get_activation_status` | Check status of an activation |
| `get_active_instructions` | Get the handoff contract for an activation |
| `reload_activation` | Re-check and promote pending packs |
| `decline_tool_suggestion` | Permanently hide a tool suggestion |
| `record_pack_feedback` | Rate a pack as helpful/unhelpful |
| `list_registry_packs` | List all available instruction packs |
| `export_for_harness` | Export activation for Cursor, Claude Code, Codex, or Markdown |

## Links

- [GitHub](https://github.com/mutigen/packforge)
- [Architecture](https://github.com/mutigen/packforge/tree/main/docs/architecture)
- [License](https://github.com/mutigen/packforge/blob/main/LICENSE) — PolyForm Noncommercial 1.0.0

---

Built by [MUT-i-GEN](https://github.com/mutigen)
