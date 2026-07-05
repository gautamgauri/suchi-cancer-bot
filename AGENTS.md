# AGENTS.md — Rules for Coding Agents Working in This Repository

This repository powers **Suchi**, a cancer-information assistant operated by the
Suchitra Cancer Care Foundation (SCCF). Real patients and caregivers in Bihar,
India talk to this bot about cancer. Mistakes here are not cosmetic — they can
produce unsafe medical guidance. Read this file before making any change.

Companion documents:

- `CLAUDE.md` — project map, key commands, git-safety preflight (mandatory).
- `docs/ARCHITECTURE.md` — modules, data flows, deployment surfaces.
- `docs/OPERATIONS_RUNBOOK.md` — setup, tests, CI, health checks, rollback.
- `docs/RELIABILITY_BASELINE.md` — verified state of the repo at handoff.
- `docs/RELIABILITY_BACKLOG.md` — ranked known issues.
- `docs/SUCHI_SAFETY_CONTRACT.md` and `docs/SUCHI_ANSWER_POLICY.md` — the
  clinical safety rules the runtime must uphold.

## 1. Safety boundaries (non-negotiable)

1. **Never bypass or weaken the safety module** (`apps/api/src/modules/safety/`).
   The chat pipeline runs safety checks *before* retrieval and generation;
   emergency/red-flag queries must keep their fast escalation path. Do not
   reorder, short-circuit, or add feature flags around it.
2. **Never return medical advice without KB backing.** Responses are grounded
   in the knowledge base (`kb/`) via the RAG module
   (`apps/api/src/modules/rag/`). If evidence is insufficient, the correct
   behavior is abstention (`apps/api/src/modules/abstention/`), not a fluent
   guess.
3. **Do not edit medical content, prompts, or clinical policy on your own
   authority.** Changes to `kb/**`, system prompts under
   `apps/api/src/modules/llm/` or `chat/`, safety keyword lists, escalation
   wording, or `docs/SUCHI_ANSWER_POLICY.md` require SCCF human/medical review.
   Propose them in a separate, clearly-labeled PR (see issue #48 boundaries for
   the precedent).
4. **No secrets in code, docs, logs, or fixtures.** Secrets live in GCP Secret
   Manager (project `gen-lang-client-0202543132`) and are referenced by *name
   only* (e.g. `database-url`, `DISTRIBUTION_APPROVAL_SECRET`). Never paste
   values, tokens, or connection strings anywhere in the repo.
5. **No patient data.** Never copy raw chat transcripts, phone numbers
   (WhatsApp contacts), or any personal data into fixtures, tests, docs, or
   commit messages. See `docs/PRIVACY_RETENTION.md`.
6. **Do not deploy or push to `main`.** Work on a branch, open a PR. Deploys go
   through Cloud Build (`cloudbuild.yaml`) and are a human decision.

## 2. Git safety (mandatory preflight)

Before ANY destructive git command (`reset --hard`, `clean -f/-fd`,
`checkout`/`restore` that discards changes, `branch -D`, `stash drop`,
force-push):

1. Run `git status --short`.
2. If anything is uncommitted/untracked, preserve it first (WIP branch, stash,
   or `git diff > patch`).
3. Only then run the destructive command.

This rule exists because real work was lost to an unguarded `git reset --hard`.
It is restated in `CLAUDE.md`; both copies are binding.

## 3. Repository conventions

- **Layout:** NestJS API in `apps/api` (the main codebase), React+Vite UI in
  `apps/web`, eval framework in `eval/`, knowledge base in `kb/`, docs in
  `docs/`, Python ingestion in `scripts/`. Pipeline data/tools live in
  `content/`, `distribution/`, `navigator/`, `evals/`, `repairable/`.
- **NestJS module pattern:** every feature is `src/modules/<name>/` with
  `*.module.ts`, `*.service.ts`, `*.controller.ts`. Follow it for new features.
- **Routing:** the global prefix `v1` is set once in `apps/api/src/main.ts`.
  Controllers must use bare paths (`@Controller("chat")`, **not**
  `@Controller("v1/chat")`). Doubling the prefix has caused two production
  bugs already (PRs #44, #45) — links generated for approval emails 404'd.
- **Tests:** Jest, colocated as `*.spec.ts` next to the source file. Unit tests
  mock Prisma/LLM; no live DB or network needed (`npx jest` passes on a clean
  checkout — see `docs/RELIABILITY_BASELINE.md` for the verified count).
- **Env vars:** every new variable must be declared in
  `apps/api/src/config/env.validation.ts` AND added to **both**
  `cloudbuild.yaml` and `cloudbuild.gated.yaml`. Both pipelines use
  `--set-env-vars`/`--set-secrets`, which **replace** (not merge) the Cloud Run
  configuration — a variable missing from the pipeline file is silently dropped
  on the next deploy. This has caused real outages (Meta/Instagram posting was
  silently dead for weeks).
- **Migrations:** Prisma migrations in `apps/api/prisma/migrations/`. Note that
  `prisma migrate dev` fails against the production DB (no shadow-DB
  permissions); the operational pattern is diff + psql + `migrate resolve`
  (see `docs/OPERATIONS_RUNBOOK.md`).
- **Commit style:** conventional-ish (`fix(scope): ...`, `feat: ...`,
  `docs: ...`), imperative mood, small focused PRs.

## 4. Test-first expectations

- **Run the full API suite before and after your change:**
  `cd apps/api && npx jest`. The baseline is green (see
  `docs/RELIABILITY_BASELINE.md`); if you inherit a red suite, say so in the PR
  rather than papering over it.
- **New behavior ships with tests.** A bug fix ships with a regression test
  that fails before the fix. Safety-relevant changes (safety, abstention,
  citations, evidence gating) require tests without exception — several of
  these paths are currently under-tested (see the "test gaps" section of
  `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md`), so do not make that worse.
- **Do not delete or silently skip failing tests** to get green. Quarantine
  with a linked issue if truly necessary, and record it in
  `docs/RELIABILITY_BACKLOG.md`.
- **Eval awareness:** retrieval/citation changes should be checked against the
  Tier1 eval (`cd eval && npm run eval:tier1`, needs API access + judge LLM
  credentials). The nightly Tier1 workflow (`.github/workflows/eval-tier1.yml`)
  is the canary for retrieval quality; its current red status is a
  *notification* failure, not an eval failure — see
  `docs/RELIABILITY_BASELINE.md` before "fixing" it blind.

## 5. Scope discipline for agents

- Implement exactly what the issue/PR asks. Do not refactor unrelated code,
  reformat files you didn't change, or "improve" prompts opportunistically.
- Cite evidence. When you claim something about the system, point at the file,
  test, workflow, or CI run that proves it.
- When you find a real problem outside your task, file/append it to
  `docs/RELIABILITY_BACKLOG.md` or open an issue — don't fix it inline.
- Documentation edits must not contradict the canonical sources: requirements
  live in `docs/REQUIREMENTS.md`, decisions in `docs/OPEN_DECISIONS.md`,
  deployment truth in `cloudbuild.yaml` / `docs/DEPLOYMENT.md`. Cross-reference
  instead of duplicating.
- State what you verified vs. what you assumed. Unverifiable claims belong in
  an "unverified assumptions" note, not asserted as fact.

## 6. Things that look wrong but are intentional

- **Citations are for auditors, not users:** the UI intentionally avoids
  citation clutter and voice responses never mention citations
  (OD-003 in `docs/OPEN_DECISIONS.md`). Do not "fix" this.
- **Gemini is the only active LLM provider** in production. DeepSeek/OpenAI
  code paths in `apps/api/src/modules/llm/` are legacy plumbing kept for
  fallback wiring — do not build new features on them.
- **Two Cloud Build pipelines exist on purpose:** `cloudbuild.yaml` (simple,
  active) and `cloudbuild.gated.yaml` (migration job + health gate, has known
  issues documented in `docs/cloudbuild-gated-issues.md`). Keep their env/secret
  lists byte-identical when touching either.
