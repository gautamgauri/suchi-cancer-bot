# AGENTS.md — Rules for Coding Agents Working in This Repository

This repository powers **Suchi**, a cancer-information assistant operated by the
Suchitra Cancer Care Foundation (SCCF). Real patients and caregivers in Bihar,
India talk to this bot about cancer. Mistakes here are not cosmetic — they can
produce unsafe medical guidance. Read this file before making any change.

Companion documents:

- `CLAUDE.md` — project map, key commands, git-safety preflight (mandatory).
- `docs/ARCHITECTURE.md` — modules, data flows, deployment surfaces.
- `docs/OPERATIONS.md` is the runbook. It covers health checks, outage
  response, deploy, rollback, migrations, secrets, evaluation and scheduled jobs.
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
3. **Medically significant changes need clinical review. Other changes to
   wording need the owner's approval.** SCCF's clinicians are busy. Send them
   only what a clinician must decide. The owner is the repository owner, a
   person, never an agent.

   **Needs SCCF clinical review**, in a separate, clearly labelled PR. The
   medical oncologist decides. The medical social worker may route the question.
   - New or changed clinical content. Examples are how urgent a symptom is,
     which reply or triage level a symptom leads to, any timeframe for seeking
     care, doses, drugs, tests, treatment, side effects, diet, prevention,
     screening, prognosis, what a symptom may mean, and who to call or where
     to go in an emergency.
   - Changes to the clinical meaning of `kb/**`, of system prompts under
     `apps/api/src/modules/llm/` or `chat/`, of `docs/SUCHI_ANSWER_POLICY.md`
     or of `docs/SUCHI_SAFETY_CONTRACT.md`.
   - Removing, narrowing, replacing or reordering anything that triggers a
     safety reply.
   - A new symptom or situation as a trigger for a safety reply, and any
     change that moves a phrase from one reply to another.
   - Thresholds and logic that decide whether Suchi answers, abstains,
     escalates or ends the conversation.

   **Owner approval is enough** (no clinical review):
   - Translating an approved reply into a language Suchi already serves, with
     no change of meaning. A named person who reads the language, other than
     the author of the translation, checks it against the original and is
     named in the PR. Numbers, timeframes and urgency words carry over
     unchanged. A new language follows `docs/LANGUAGE_LAUNCH_GATE.md`.
   - Adding spellings, transliterations and synonyms of a phrase that already
     triggers the same safety reply.
   - Edits to the files above that leave the clinical meaning unchanged, such
     as spelling, grammar, layout and links. The owner makes that judgement
     from the before and after text in the PR.
   - Greetings, notices, button text, error messages, privacy wording and
     other interface copy with no medical content. An approved sentence reused
     word for word counts as interface copy. A new emergency number or
     instruction is clinical.
   - Process matters such as review order, rotas and document layout.

   State in the PR which list applies and why. A change to wording, the
   knowledge base, prompts or safety triggers that fits both lists, or
   neither, is clinical. When a clinician is needed, ask at most two or three
   questions, each answerable in one line, and quote the exact new wording in
   each. If the change will not fit, split it. Record who answered and when.
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
  (see `docs/OPERATIONS.md` section 6).
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
  is the canary for retrieval quality. Its job result reflects the evaluation
  outcome only. An email delivery failure shows as a warning and leaves the
  result unchanged. The workflow has no pull request trigger, because it sends
  real chat requests to production. Read the annotation on a red run before
  acting on it (`docs/OPERATIONS.md` section 8).

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
  active) and `cloudbuild.gated.yaml` (migration job + health gate, currently unused,
  has known issues documented in `docs/cloudbuild-gated-issues.md`). Keep their
  env and secret lists identical when touching either.
  `scripts/check_deploy_config_parity.py` enforces this in CI. The service
  flags (`--max-instances`, `--memory`, `--cpu`, `--timeout`, CPU throttling)
  must match as well. Compare them by hand unless the parity script reports on
  them, and never deploy from the gated file without doing so.
