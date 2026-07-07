# Reliability Backlog — ranked

Ranked P0/P1/P2 reliability issues derived from the 2026-07-05 baseline
(`docs/RELIABILITY_BASELINE.md`). Each item links to exact code paths and the
test gap that lets it survive. Ranking criteria: patient-facing safety impact
first, then silent-failure potential, then developer friction.

Status legend: **tracked** = an open GitHub issue exists; **new** = surfaced
by this handoff review.

---

## P0 — fix before relying on anything else

### P0-1. `deploy-api.yml` silently strips production env/secrets on every merge — RESOLVED (PR #51)

- **What:** `.github/workflows/deploy-api.yml:81-102` deployed `suchi-api` with a stale config.
- **Resolution:** Removed the GitHub Actions deploy step entirely. `deploy-api.yml` now only verifies the API builds and runs `scripts/check_deploy_config_parity.py`, leaving `cloudbuild.yaml` as the sole deployment authority.
- **Impact:** Eliminates silent configuration drops on merge.

### P0-2. Nightly Tier1 canary red for 12+ nights; status measures email, not eval — RESOLVED (PR #49)

- **What:** every scheduled "Eval Tier1 - Retrieval Quality" run since
  2026-06-24 is red only because the "Send email notification" step fails with
  SMTP `535-5.7.8 BadCredentials` (verified runs 28731647092, 28424590294,
  28079102548). The eval itself passes its steps; the true result (21 cases,
  20 pass) is buried in the artifact.
- **Resolution:** Separated eval outcome from notification delivery. Evaluation outcomes now compile to `eval-result.json` which Gates the CI check status, and email delivery runs with `continue-on-error` (emitting a warning warning instead of failing the build).
- **Impact:** CI status reflects evaluation results, not notification infrastructure success.

---

## P1 — high value, do next

### P1-1. Standing citation failure `RQ-LUNG-02` + no citation-integrity verifier — RESOLVED (PR #52)

- **What:** `RQ-LUNG-02` failed checks due to lack of citation-integrity verification.
- **Resolution:** Added a dedicated citation integrity verifier, per-case records, failure clustering, and a case disappearance guard to the eval framework.
- **Impact:** Prevents ungrounded medical claims and citation coverage issues.

### P1-2. Safety-critical pipeline behaviors are untested (new; gaps enumerated in `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md`)

- **What:** the properties that make Suchi safe are asserted by code order in
  `apps/api/src/modules/chat/chat.service.ts` but not pinned by tests:
  emergency fast path (FR-CHAT-003, `evaluateEmergencyFastPath()`), safety
  gate ordering before RAG (FR-CHAT-005), evidence-gate thresholds
  (FR-CHAT-008/-009, `evaluateEvidenceGate()`), citation repair (FR-CHAT-012),
  voice citation stripping (FR-CHAT-014, `stripForVoice()`), SafetyEvent
  persistence (FR-SAFETY-002/-003/-007).
- **Impact:** a refactor could reorder safety after retrieval, or weaken the
  gate, with 821 tests still green.
- **Fix shape:** pipeline-order contract tests in
  `apps/api/src/modules/chat/` (mock services, assert call order and
  short-circuits), plus threshold-boundary tests in
  `apps/api/src/modules/evidence/`.

### P1-3. DB-unavailable path does not degrade to abstention (partial per NFR-AVAIL-002)

- **What:** `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md` marks NFR-AVAIL-002
  ("DB unavailable → abstention") as partial/untested. `chat.service.ts` has
  `prismaRetry()` for pool exhaustion, but there is no test that a hard DB
  outage yields a safe abstention rather than a 500.
- **Impact:** during a Cloud SQL blip, patients could get raw errors instead
  of safe guidance; `GET /v1/health` will correctly go red
  (`health.service.ts`) but chat behavior is unspecified.
- **Test gap:** no spec simulates Prisma throwing on the persistence/retrieval
  steps end-to-end.

### P1-4. No CI runs the API unit suite; migrations can't block a bad deploy (new)

- **What:** none of the five workflows runs `cd apps/api && npx jest`
  (`.github/workflows/` — only web tests and the eval exist). Additionally
  `deploy-api.yml:48` runs `prisma migrate deploy` with
  `continue-on-error: true`, so a failed migration still deploys new code
  against an old schema.
- **Impact:** the 821-test suite protects nothing on the merge path; schema/
  code mismatch reaches prod with a green workflow.
- **Fix shape:** add an `api-tests.yml` (jest + `npm run build` on PRs
  touching `apps/api/**`); make the migration step blocking or gate deploy on
  it, mirroring `cloudbuild.gated.yaml`'s ordering.

### P1-5. Zero-spec modules on trust boundaries (new)

- **What:** 10 modules have no spec files at all (verified by `find`):
  `analytics`, `copilot`, `email`, `embeddings`, `feedback`, `health`,
  `observability`, `prisma`, `sessions`, `youtube`. The riskiest are
  `sessions` (public endpoint, geolocation parsing), `embeddings` (RAG input —
  a dimension/model drift breaks retrieval silently), and `email` (every
  approval/report flow depends on it).
- **Fix shape:** start with `sessions.controller/service` specs and an
  `embeddings.service` contract test (768-dim, model name pinned to
  `EMBEDDING_MODEL`).

### P1-6. WhatsApp PII retention job missing (FR-WA-015, partial) — RESOLVED

- **What:** `WhatsAppContact` stores phone→session mappings
  (`apps/api/prisma/migrations/20260622000000_add_whatsapp_contact`,
  `schema.prisma`), but the retention/deletion job required by FR-WA-015 was
  marked missing/untested in `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md`;
  housekeeping endpoints exist (`POST /v1/admin/housekeeping/run-retention`)
  but didn't cover WhatsApp contacts.
- **Resolution:** Implemented purging of WhatsApp contact mappings in `retention.service.ts` (deleting contacts where `lastActiveAt` or `sessionId` is older than 90 days) and verified with automated test suite in `retention.service.spec.ts`.
- **Impact:** privacy commitment in `docs/PRIVACY_RETENTION.md` fully met.

---

## P2 — track and schedule

### P2-1. Gated pipeline hardcodings (tracked in `docs/cloudbuild-gated-issues.md`)

`MIG` env var pinned to `20260606000000_phase2_user_role_review_kb_metadata`
and column checks in `migrate-with-repair.sh` pinned to old columns — every
new migration silently invalidates the repair path. Fix by deriving `MIG` from
`ls prisma/migrations | tail -1` at build time.

### P2-2. Eval judge-provider ambiguity (new)

CI defaults the judge to `deepseek` (`.github/workflows/eval-tier1.yml:69`)
while the eval config defaults to `vertex_ai` (`eval/config/loader.ts:57`,
`eval/config/default.json`) and production policy is Gemini-only. Nightly
scores may come from a judge nobody intends to fund or maintain. Pin one
provider explicitly in the workflow.

### P2-3. Duplicate/legacy build surfaces (new)

`apps/api/cloudbuild.ingest.yaml` + `apps/api/Dockerfile.ingest` duplicate the
root `cloudbuild.kb-ingest.yaml` + `Dockerfile.kb-ingest`; top-level `evals/`
duplicates `eval/` conceptually. Confirm unused, then delete or mark
deprecated — agents keep rediscovering them.

### P2-4. GitHub Actions Node-20 deprecation (new)

Tier1 runs annotate: checkout@v4, setup-node@v4, upload-artifact@v4,
dawidd6/action-send-mail@v3 target deprecated Node 20 runners (visible on run
28731647092). Bump action majors when touching workflows.

### P2-5. Known TODOs in the chat pipeline (new)

`apps/api/src/modules/chat/chat.service.ts`: `district: null // TODO` and
`budgetConcern: false // TODO` — patient-state fields the clinical-reasoning
layer expects but that are never populated. Either implement or remove from
the contract. Also placeholder generators in
`eval/autoresearch/eval-optimizer.ts` (`[TODO: write user message...]`) mean
`eval-optimize` can emit unusable cases.

### P2-6. LinkedIn token expiry (tracked: issue #27)

`LINKEDIN_ACCESS_TOKEN` (60-day OAuth token,
`apps/api/src/modules/admin/social-post.service.ts`) expires ~2026-07-20;
LinkedIn posting is intentionally disabled until an org page exists. Decide:
rotate or remove the code path.

### P2-7. Instagram social card placeholder (tracked: issue #28)

`SUCHI_SOCIAL_CARD_URL` points at a placeholder object in
`gs://suchi-public-assets` (`cloudbuild.yaml` env list). IG publishing will
post the placeholder until the real card is uploaded and the env updated in
**both** cloudbuild files (and `deploy-api.yml` per P0-1).

---

## Human decisions required (cannot be resolved by an agent)

1. P0-1: keep `deploy-api.yml` as a deploy path (and reconcile it) or demote
   it to build+test only? Who owns keeping three env lists in sync?
2. P0-2: rotate the Gmail SMTP app password (credential owner action) —
   agents must not touch credentials.
3. P1-1/issue #48: any change to retrieval sources or citation rules for
   RQ-LUNG-02 needs SCCF medical review before merge.
4. P2-6: LinkedIn — rotate token or drop the integration.
