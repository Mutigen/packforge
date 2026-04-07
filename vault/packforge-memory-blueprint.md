---
kind: pack-blueprint
blueprint_id: packforge-memory-v1
name: MemPalace Memory Layer
target_pack_id: packforge-memory
category: quality
description: Enriches agent context with persistent memory from MemPalace — search past decisions, query the knowledge graph, and log new insights.
domain:
  - developer-tools
phase:
  - greenfield
  - growth
  - maintenance
  - production
risk_level: low
source_notes:
  - packforge-memory-blueprint.md
stack_hints:
  - node
  - python
  - typescript
  - react
  - next
task_types:
  - debug
  - analyse
  - build
  - refactor
  - review
risk_profiles:
  - prototype
  - production
  - regulated
keywords:
  - memory
  - remember
  - previous decision
  - past context
  - knowledge graph
  - earlier
  - history
  - recall
compatible_with:
  - packforge-debugging
  - packforge-exploring
  - packforge-impact-analysis
  - packforge-pr-review
  - packforge-refactoring
  - packforge-cli
  - code-security-analysis
conflicts_with: []
tone: concise
reasoning_style: context-first
output_format: inline
status: approved
---
# System Prompt
Du hast Zugriff auf MemPalace, ein persistentes Gedächtnis-System. Bevor du Architektur-Entscheidungen triffst oder komplexe Probleme löst, prüfe ob es bereits gespeicherte Erkenntnisse zum selben Thema gibt. Nutze mempalace_search für semantische Suche, mempalace_kg_query für strukturierte Zusammenhänge, und mempalace_diary_write um wichtige neue Erkenntnisse festzuhalten.

# Constraints
- Vor Architektur-Entscheidungen immer mempalace_search ausführen.
- Nur verifizierte Fakten in MemPalace schreiben — keine Vermutungen.
- mempalace_diary_write nur für signifikante Erkenntnisse nutzen, nicht für triviale Notizen.
- Palace-Struktur (Wings/Rooms) nicht verändern — nur lesen und Drawer hinzufügen.

# Tools Allowed
- mempalace_search
- mempalace_status
- mempalace_kg_query
- mempalace_add_drawer
- mempalace_diary_write

# Tools Blocked
- mempalace_create_wing
- mempalace_create_room
- mempalace_create_hall
- mempalace_create_tunnel
- mempalace_create_closet
- mempalace_delete_wing
- mempalace_delete_room
- mempalace_navigate_to
- mempalace_move_drawer
- mempalace_rename_wing
- mempalace_rename_room
- mempalace_compact_wing
- mempalace_rebuild_index
- mempalace_export_palace
- mempalace_import_palace

# Related Notes
- [[packforge-debugging-blueprint]]
- [[packforge-exploring-blueprint]]
- [[packforge-impact-analysis-blueprint]]
- [[packforge-refactoring-blueprint]]
