# Reliability Baseline — 2026-07-05

Verified state of the repository at handoff (issue #46). Facts below were
established by running the stated commands on 2026-07-05; anything not
directly verified is listed under "Unverified assumptions".

## 1. Commit baseline

- **HEAD:** `e31dfc4d5549e36c5eb3a7041061295543379e25` on `main`
  (`git rev-parse HEAD`), merge of PR #45
  ("fix(whatsapp-navigator): drop doubled v1 route prefix").
- Recent history: PR #45 and #44 fixed doubled `/v1` route prefixes
  (commits `e902ae1`, `a029286`); PR #43 added the distribution approval API;
  PR #39 added the git-safety preflight.
- Toolchain: Node v20.20.0 locally; NestJS `^10.4.0`, Prisma client `^5.20.0`
  (`apps/api/package.json`).

## 2. Test suite status (verified locally)

Command: `cd apps/api && npx jest` at commit `e31dfc4` (WSL2, Node v20.20.0,
2026-07-05):

```
Test Suites: 41 passed, 41 total
Tests:       821 passed, 821 total
Time:        48.809 s
```

- **No failing tests.** Unit tests run without DB or network (Prisma/LLM
  mocked). Noisy-but-passing suites log intentional errors
  (`whatsapp.service.spec.ts` "boom" scenarios).
- Coverage is uneven: 10 of 24 module directories have **zero** spec files —
  `analytics`, `copilot`, `email`, `embeddings`, `feedback`, `health`,
  `observability`, `prisma`, `sessions`, `youtube` (counted via
  `find src/modules/<m> -name "*.spec.ts"`). Best-covered: `chat` (16),
  `admin` (5), `safety` (5).
- Web (Vitest/Playwright) and eval suites were **not** executed for this
  baseline (see §7).

## 3. Database migrations

`apps/api/prisma/migrations/` contains 9 migrations plus
`add_pgvector_extension.sql` (manual bootstrap) and `migration_lock.toml`:

1. `20250101000000_add_greeting_context_to_session`
2. `20260120163141_add_fts_to_kbchunk`
3. `20260125000000_add_current_greeting_step`
4. `20260130000000_add_geolocation_to_session`
5. `20260131000000_add_is_eval_to_session`
6. `20260217000000_add_voice_interaction`
7. `20260218000000_fts_simple_config`
8. `20260606000000_phase2_user_role_review_kb_metadata`
9. `20260622000000_add_whatsapp_contact`

Note: the gated pipeline's repair variables are hardcoded to migration #8
(`cloudbuild.gated.yaml`, `MIG=20260606000000_...`); adding migration #10
requires updating it (`docs/cloudbuild-gated-issues.md`, issue 2).

## 4. CI status (verified via `gh` on 2026-07-05)

`gh workflow list` — 5 active workflows: Deploy API to Cloud Run, Deploy
Landing Site, Deploy Web to Cloud Run, Web Tests, Eval Tier1 - Retrieval
Quality.

`gh run list --limit 15`:

- **Eval Tier1 nightly: red for 12+ consecutive nights (2026-06-24 →
  2026-07-05; red on every listed run back through 2026-06-23).**
  Verified on runs `28731647092`, `28424590294`, `28079102548`: every eval
  step succeeded; only the final "Send email notification" step failed with
  `535-5.7.8 Username and Password not accepted` (Gmail SMTP BadCredentials).
  The workflow status therefore reflects notification delivery, not eval
  outcome. Tracked as issue #47.
- Last three "Deploy API to Cloud Run" runs (2026-06-28, for PRs #43/#44/#45
  merges): **success** — runs `28331131428`, `28332667342`, `28333372955`.
  See §6 for why this is concerning despite the green status.
- Annotation on Tier1 runs: several actions (checkout@v4, setup-node@v4,
  upload-artifact@v4, action-send-mail@v3) target deprecated Node 20 runners.

## 5. Latest real eval result (artifact `tier1-eval-report-184`, run 28731647092, 2026-07-05)

From `tier1-report.json` (downloaded via `gh run download`):

| Metric | Value |
|---|---|
| Total cases | 21 |
| Passed | 20 |
| Failed | 1 (`RQ-LUNG-02`) |
| Average score | 98.5% |
| Top-3 trusted-source presence | 95.2% |
| Citation coverage | 95.2% |
| Abstention rate | 0% |

`RQ-LUNG-02` failure detail: deterministic checks `citations_present` and
`citation_confidence_acceptable` failed; per-case `citationCoverage: 0` and
`top3TrustedPresence: false` (score 0.694). This is the standing P0 retrieval/
citation failure referenced by issue #48.

## 6. Critical workflows and known risks at baseline

1. **`deploy-api.yml` env/secret drift (highest risk).**
   `.github/workflows/deploy-api.yml:81-102` deploys `suchi-api` with only 14
   env vars and 6 secrets (`database-url`, `deepseek-api-key`,
   `embedding-api-key`, `admin-basic-user`, `admin-basic-pass`, `SMTP_PASS`),
   while `cloudbuild.yaml:90-93` sets ~20 env vars and 15 secrets (adds
   `GEMINI_API_KEY`, `langfuse-public-key`/`langfuse-secret-key`,
   `NAVIGATOR_APPROVAL_SECRET`, `CONTENT_APPROVAL_SECRET`,
   `DISTRIBUTION_APPROVAL_SECRET`, `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`,
   `META_IG_USER_ID`, plus `LANGFUSE_*`, `QUEUE_GCS_BUCKET`, `SUCHI_SITE_URL`,
   `SUCHI_SOCIAL_CARD_URL`; `LLM_TIMEOUT_MS` 25000 vs 45000). Because
   `--set-env-vars`/`--set-secrets` replace the whole config, and this
   workflow auto-runs on any `main` push touching `apps/api/**` or `kb/**`
   (and DID run, successfully, on 2026-06-28 after PRs #43/#44/#45), the
   currently serving revision was **likely deployed with the reduced set** —
   which would silently disable Meta/Instagram posting, Langfuse, distribution/
   content/navigator approval links, and the GCS queue. This exact failure
   mode occurred before (Meta secrets silently dropped, fixed on revision
   suchi-api-00394+). P0-1 in `docs/RELIABILITY_BACKLOG.md`; verification
   command in §7.
2. **Tier1 nightly canary is blind** until issue #47 is fixed: a genuine
   retrieval regression and an SMTP failure both show as the same red X.
3. **Migration ordering:** `deploy-api.yml` runs migrations with
   `continue-on-error: true` (line 48) — a failed migration does not stop the
   code deploy, allowing schema/code mismatch.
4. **`cloudbuild.yaml` vs `cloudbuild.gated.yaml`:** env/secret lists verified
   identical at this commit (they must be kept that way — replace semantics).
5. **Safety-critical test gaps** (from
   `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md`): emergency fast path
   (FR-CHAT-003), safety-gate-before-RAG ordering (FR-CHAT-005), evidence gate
   thresholds (FR-CHAT-008/009), citation repair (FR-CHAT-012), voice citation
   stripping (FR-CHAT-014), safety events (FR-SAFETY-002/003/007), DB-down →
   abstention (NFR-AVAIL-002) are implemented but untested.

## 7. Unverified assumptions

Recorded honestly; each has a verification command.

1. **Live Cloud Run env config.** Could not run `gcloud run services describe
   suchi-api` from this environment (gcloud auth token expired,
   non-interactive). Therefore the claim in §6.1 that production is currently
   running with the reduced env/secret set is an **inference** from workflow
   history, not observed state. Verify with:
   `gcloud run services describe suchi-api --region us-central1 --project gen-lang-client-0202543132 --format json`
   and inspect `spec.template.spec.containers[0].env` (names only).
2. **Production health.** `GET /v1/health` on the live service was not called
   during this baseline. Verify: `curl -s https://suchi-api-lxiveognla-uc.a.run.app/v1/health`.
3. **Which judge provider the nightly eval actually uses.** The workflow
   defaults `EVAL_LLM_PROVIDER` to `deepseek` unless a repo secret overrides it
   (`.github/workflows/eval-tier1.yml:69`); the secret's value cannot be read.
   The eval config default is `vertex_ai` (`eval/config/loader.ts:57`,
   `eval/config/default.json`).
4. **Web/E2E/eval suites' pass state.** `apps/web` Vitest/Playwright and the
   full `eval/` suites were not run for this baseline (Playwright needs
   browsers; eval hits the live API and spends LLM tokens). Last "Web Tests"
   CI conclusions can be checked with `gh run list --workflow e2e-tests.yml`.
5. **Cloud SQL / Secret Manager state** (secret presence, DB reachability)
   was not re-verified; secret names cited here come from pipeline files, not
   from listing Secret Manager.
6. **`evals/` (top-level) and `apps/api/cloudbuild.ingest.yaml` /
   `apps/api/Dockerfile.ingest`** appear to be legacy/duplicate surfaces; no
   runtime evidence either way. Confirm before deleting.

## 8. How to regenerate this baseline

```bash
git rev-parse HEAD
cd apps/api && npx jest 2>&1 | tail -5
ls apps/api/prisma/migrations
gh workflow list && gh run list --limit 15
gh run list --workflow eval-tier1.yml --limit 10
gh run download <latest-tier1-run-id> -n tier1-eval-report-<n>
```
