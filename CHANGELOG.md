# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
