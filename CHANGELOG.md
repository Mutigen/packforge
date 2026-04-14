# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Staged Activation** — packs requiring unavailable tools (GitNexus, MemPalace) are held as `pendingPacks` with reason and required tool; `reload_activation` MCP tool promotes them once tools become available
- **Tool Onboarding** — `missingTools` array in handoff contract surfaces install guides, benefits, and impacted packs for GitNexus, MemPalace, and Obsidian
- **Decline Memory** — `decline_tool_suggestion` MCP tool + `declinedTools` persistence in memory-service; declined tools are permanently hidden from future suggestions
- **GitNexus Subprocess Graph Access** — `runGitNexusCypher()` subprocess helper for real-time graph queries (clusters, processes, symbol count) with meta.json fallback
- **Obsidian Auto-Discovery** — `discoverObsidianVaults()` reads macOS/Linux Obsidian config (`obsidian.json`) + project `.obsidian/` directory; adds `hasObsidianVault` and `obsidianVaults` to ProjectContext
- `reload_activation` MCP tool (re-evaluates context, promotes pending packs)
- `decline_tool_suggestion` MCP tool (permanently dismisses tool suggestions)
- `PendingPackSchema` and `MissingToolSchema` in shared-types
- `gitNexusProcessLabels` field in ProjectContextSchema
- `updateActivationHandoff()`, `declineToolSuggestion()`, `getDeclinedTools()` in memory-service

### Changed

- `buildHandoffContract` now splits packs into active vs pending based on tool availability
- `activatePackSet` and `startProjectFromSpec` pass `declinedTools` from memory-service
- `readGitNexusGraphSummary` uses subprocess-first strategy with meta.json fallback
- MCP Gateway now exposes 10 tools (was 8)

---

## 0.1.0 — Initial Release

### Added

- Initial monorepo setup with Turborepo
- Context analyzer for project stack/domain/phase inference
- Orchestrator with GitNexus-aware pack matching and scoring
- MCP gateway with 8 tools (stdio transport)
- 18 instruction packs across 5 categories
- 2-tool UX flow: `start_project_from_spec` → `confirm_activation`
- GitNexus integration for code intelligence enrichment
- MemPalace integration as persistent memory layer (Option D — Hybrid)
  - `readMemPalaceSummary()` detection in context-analyzer
  - `packforge-memory` pack with 5 curated / 14 blocked MemPalace tools
  - +15 scoring boost for packs using `mempalace_*` tools
  - `mempalace status` bootstrap step (`if_mempalace_available`)
  - Cross-pack memory constraints on 7 compatible packs
- Pack validation and registry export scripts
- ESLint, Prettier, Husky, and lint-staged tooling
- CI workflow with GitHub Actions
- Project documentation (README, CONTRIBUTING, SECURITY, CHANGELOG)

### Changed

- Renamed 6 GitNexus packs from `gitnexus-*` to `packforge-*` (125+ reference updates)
- Added `hasMemPalace`, `mempalaceIdentity`, `mempalaceWingCount` to ProjectContextSchema
- Added `if_mempalace_available` to BootstrapStepSchema condition enum

[Unreleased]: https://github.com/mutigen/packforge/commits/main
