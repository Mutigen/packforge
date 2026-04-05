# TODO

## Kritische Vorbedingungen

- [ ] Lizenzklaerung mit Akon Labs (GitNexus)
  - Aufgabe: Akon Labs kontaktieren und Nutzungsbedingungen fuer dein konkretes Vorhaben schriftlich klaeren.
  - Kontakt: https://akonlabs.com
  - Erwartetes Ergebnis: Eindeutige Aussage zu Noncommercial vs. Commercial Nutzung, Self-hosted/Produktintegration und erlaubter Betriebsform.

- [ ] Fallback-Logik fuer context-analyzer ohne GitNexus Index
  - Aufgabe: Definieren und implementieren, wie der context-analyzer arbeitet, wenn kein GitNexus Index vorhanden ist.
  - Mindestverhalten:
    - Repo-Dateien direkt scannen (package.json, pyproject.toml, Dockerfile, README, .github/workflows)
    - Basis-Taxonomie-Signale daraus extrahieren
    - Empfehlungsliste mit reduziertem Confidence-Level erzeugen
    - Im UI klar markieren: "GitNexus unavailable/no index -> fallback mode"

## Naechste logische Workflow-Reihenfolge

1. Vorbedingungen abschliessen
   - Lizenzstatus klaeren
   - Fallback-Spezifikation finalisieren

2. Contract-First festziehen
   - Taxonomie-Enums und ProjectContext-Typen fixieren
   - Instruction-Pack Schema (Zod + YAML) finalisieren

3. V1 Orchestrator ohne externe Abhaengigkeit lauffaehig machen
   - Regelbasiertes Matching implementieren
   - 5-10 Fixture-Tests aufsetzen

4. Fallback first, dann GitNexus-Symbiose
   - context-analyzer fallback mode implementieren
   - danach GitNexus-MCP Adapter als optionale Signalquelle integrieren

5. V1 UI und manuelle Aktivierung
   - Empfehlungsliste anzeigen
   - Aktivieren/Deaktivieren per Klick
   - Risk-Hinweise und Approval-Dialog (high-risk)

6. Audit/Observability als Pflicht
   - Jede Empfehlung + Aktivierung mit trace_id speichern
   - Konfidenz, Quelle (fallback vs. gitnexus), und User-Entscheidung loggen

7. Erst danach Auto-Aktivierung (V2)
   - nur fuer low-risk + hohe Konfidenz
   - Human-Confirm fuer medium/high bleibt Pflicht

## Decision Gate (vor Implementierung)

- [x] Gate A: Lizenz schriftlich geklaert
- [ ] Gate B: Fallback-Modus spezifiziert und getestet → Spec: FALLBACK-SPEC.md (Tests CA-01 bis CA-10 gruen)
- [ ] Gate C: Mindestens 5 reproduzierbare Taxonomie-Fixtures gruen
