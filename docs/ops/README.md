# ops/ — Historical Logs (Not Reference Docs)

This directory contains operational handoff documents and sprint logs from January 2026.

**These are historical records, not canonical documentation.**

They describe decisions made at specific points in time and are preserved for archaeology (understanding why something was built a certain way) — not for day-to-day reference.

## What to use instead

| Topic | Current doc |
|---|---|
| Deployment pipeline | `docs/DEPLOYMENT.md`, `docs/GCP_DEPLOYMENT.md` |
| Cloud Build gated issues | `docs/cloudbuild-gated-issues.md` |
| Safety policy | `docs/SUCHI_SAFETY_CONTRACT.md`, `docs/SUCHI_ANSWER_POLICY.md` |
| KB structure | `docs/KB_FOLDER_STRUCTURE.md`, `docs/KB_GOLD_STACK.md` |
| Chat system design | `docs/CHAT_ARCHITECTURE.md` |

## Structure

- `handoffs/` — Per-sprint handoff logs (Jan 2026 quality sprint)
- `HOW_TO_HANDOFF.md` — Template for writing handoffs
- `ORCHESTRATOR_PROMPT.md` — Prompt used by the autoresearch orchestrator
- Miscellaneous fix and performance notes

## Note on dates

All files here are from the Jan 2026 sprint. Architecture decisions made after that date are reflected in the current source code and the docs listed above, not here.
