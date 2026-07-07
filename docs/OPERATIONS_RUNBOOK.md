# Suchi Operations Runbook

How to set up, test, deploy, monitor, and roll back Suchi. Part of the
reliability handoff pack (issue #46). Deployment internals live in
`docs/DEPLOYMENT.md`, `docs/GATED_DEPLOYMENT.md`, `docs/GCP_DEPLOYMENT.md`;
gated-pipeline known issues in `docs/cloudbuild-gated-issues.md`. This runbook
is the operational index.

## 1. Local setup

Prerequisites: Node 20 (images and CI use Node 20; verified locally on
v20.20.0), Docker (optional), gcloud CLI for anything touching GCP.

```bash
# API — http://localhost:3001, all routes under /v1
cd apps/api
npm ci
npx prisma generate
npm run dev

# Web UI — http://localhost:3000
cd apps/web
npm ci
npm run dev

# Eval framework
cd eval
npm ci
```

- Env vars: see `apps/api/src/config/env.validation.ts` for the authoritative
  required/optional list and `docs/ENVIRONMENT_VARIABLES.md` for descriptions.
  Minimum for a local API: `DATABASE_URL`, `ADMIN_BASIC_USER`,
  `ADMIN_BASIC_PASS`, plus an LLM provider (default `LLM_PROVIDER=gemini`).
- Local DB needs the pgvector extension
  (`apps/api/prisma/migrations/add_pgvector_extension.sql`).
- Unit tests do **not** need a DB or network — Prisma and LLM calls are mocked
  in the specs.

### Production DB access (migrations, debugging)

Use the Cloud SQL proxy against instance
`gen-lang-client-0202543132:us-central1:suchi-db`; `DATABASE_URL` is in Secret
Manager under the secret name `database-url`.

Known constraint: `prisma migrate dev` **fails against the prod DB** (P3014 —
the `suchi_app` user has no shadow-database permissions). Use
`prisma migrate diff` + `psql` + `prisma migrate resolve` instead, or let the
deploy pipeline's migration job run `prisma migrate deploy`
(`docs/DEPLOYMENT.md`).

## 2. Test commands

```bash
# Full API unit suite (41 suites / 821 tests green at handoff baseline —
# see docs/RELIABILITY_BASELINE.md)
cd apps/api && npx jest

# One module / file
cd apps/api && npx jest --testPathPattern=safety

# API build (must be clean before any deploy)
cd apps/api && npm run build

# Web unit tests (Vitest) and E2E (Playwright)
cd apps/web && npm test
cd apps/web && npx playwright test

# Tier1 retrieval-quality eval (hits the live API by default; needs judge-LLM
# credentials — see eval/config/loader.ts)
cd eval && npm run eval:tier1

# Full eval CLI
cd eval && npx ts-node cli.ts run --cases <cases.yaml> --output reports/out.json
```

Safety-relevant regression suites worth knowing by name:
`apps/api/src/modules/safety/hindi-safety-regression.spec.ts`,
`apps/api/src/modules/chat/` (16 spec files),
`apps/api/src/modules/safety/` (5 spec files).

## 3. CI workflows (`.github/workflows/`)

| Workflow | Trigger | What it does | Failure semantics |
|---|---|---|---|
| `deploy-api.yml` ("API build verification") | PR or push to `main` touching `apps/api/**`, `kb/**`, `cloudbuild*.yaml`, or itself | Run configuration parity check (`scripts/check_deploy_config_parity.py`) → Build candidate Docker image locally to verify it builds (does not push or deploy) | Fails on configuration mismatch or docker build failure. Does not perform deployments or database migrations. |
| `deploy-web.yml` | push to `main` touching `apps/web/**`; manual | Build web image (API URL baked in) → deploy `suchi-web` → HTTP 200 check | Fails on deploy/health failure |
| `deploy-landing.yml` | push touching `apps/landing/**`; manual | Astro build → GitHub Pages | Standard |
| `e2e-tests.yml` ("Web Tests") | PR/push touching `apps/web/**`; manual | Vitest unit tests + Playwright (`@smoke` against dev server, or full suite against a provided `base_url`) | Blocking for web PRs |
| `eval-tier1.yml` ("Eval Tier1 - Retrieval Quality") | nightly 02:00 UTC; PRs touching rag/evidence/citations/eval paths; manual | Runs `npm run eval:tier1` against live API, uploads `tier1-eval-report-<run>` artifact, emails report when failures > 0 | Job outcome reflects the evaluation result (enforced by "Enforce evaluation status" step). Email delivery uses `continue-on-error` and is a warning annotation only (no job failure). |

There is **no CI job that runs the API jest suite**; run it locally before
merging (tracked as P1-4 in `docs/RELIABILITY_BACKLOG.md`).

## 4. Deploying

Active pipeline (per `MEMORY`/`docs/DEPLOYMENT.md` practice): **simple**
Cloud Build from the repo root:

```bash
gcloud builds submit --config cloudbuild.yaml .
```

- Builds + deploys both `suchi-api` and `suchi-web`.
- No migration step and no health gate; after a simple-pipeline deploy,
  verify and promote the latest revision to 100% traffic manually if needed.

Gated pipeline (migration job `suchi-db-migrate` + candidate revision at 0%
traffic + `/v1/health` gate + promotion):

```bash
gcloud builds submit --config cloudbuild.gated.yaml .
```

- Known issues before using it: the `MIG` env var and the column checks in
  `migrate-with-repair.sh` are hardcoded to the newest-known migration
  (currently `20260606000000_phase2_user_role_review_kb_metadata`,
  `cloudbuild.gated.yaml` step `update-migrate-job-image`) and must be updated
  whenever a migration is added — full list in `docs/cloudbuild-gated-issues.md`.

Rules that apply to **any** deploy path:

1. `--set-env-vars`/`--set-secrets` REPLACE the whole Cloud Run config. Adding
   an env var means editing `apps/api/src/config/env.validation.ts` **and**
   both cloudbuild files (and `deploy-api.yml` if it stays enabled).
2. Verify local checks pass: run configuration parity check (`python scripts/check_deploy_config_parity.py`), ensure tests pass, `prisma migrate status` is clean, no doubled route prefixes, and the health check responds with 200. Refer to `docs/DEPLOYMENT.md` for details.
3. Deploys are a human decision; agents open PRs only (see `AGENTS.md`).

## 5. Production health checks

```bash
# Deep health (checks DB connectivity, not just liveness)
curl -s https://suchi-api-lxiveognla-uc.a.run.app/v1/health
# → {"status":"ok", "database":"connected", ...} on success

# Which revision is serving, and with what config (env/secret NAMES only)
gcloud run services describe suchi-api --region us-central1 \
  --project gen-lang-client-0202543132 \
  --format 'value(status.latestReadyRevisionName)'
gcloud run revisions list --service suchi-api --region us-central1

# Recent runtime errors
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=suchi-api AND severity>=ERROR' \
  --project gen-lang-client-0202543132 --limit 20

# Nightly retrieval-quality canary
gh run list --workflow eval-tier1.yml --limit 5
gh run download <run-id> -n tier1-eval-report-<n>   # tier1-report.json has summary + per-case results
```

Interpreting the Tier1 workflow: the overall CI status (red/green) directly reflects the evaluation outcome (passed, failed, or infrastructure error). Email delivery failures are marked as warning annotations and do not affect the final green/red run status. The run summary also shows details of the evaluation.

Other signals:

- Langfuse (`https://us.cloud.langfuse.com`) for per-request LLM traces when
  `LANGFUSE_ENABLED=true` (it is, in `cloudbuild.yaml`).
- Daily report email (admin module, Cloud Scheduler → `POST /v1/admin/daily-report`
  with OIDC).
- Startup log line with build ID + latest migration + DB fingerprint
  (`apps/api/src/main.ts`) — confirms which build/schema a revision runs.

## 6. Rollback path

Cloud Run keeps previous revisions; rollback is a traffic shift, no rebuild
(`docs/GATED_DEPLOYMENT.md` §rollback):

```bash
# 1. Find the last known-good revision
gcloud run revisions list --service=suchi-api --region=us-central1

# 2. Point 100% traffic at it
gcloud run services update-traffic suchi-api \
  --to-revisions=<GOOD_REVISION>=100 --region=us-central1

# 3. Verify
curl -s https://suchi-api-lxiveognla-uc.a.run.app/v1/health
```

Same pattern for `suchi-web`.

Caveats:

- **Migrations do not roll back.** Prisma has no down-migrations here; undoing
  schema requires a new forward migration (`docs/DEPLOYMENT.md:136-157`).
  Rolling traffic back to an older image after a migration is generally safe
  only if the migration was additive — check the migration in
  `apps/api/prisma/migrations/` before shifting.
- If the bad deploy came from a pipeline with a stale env/secret list, plain
  traffic rollback also restores the old (correct) env config, since env is
  part of the revision.
- Landing site rollback: revert the commit and let `deploy-landing.yml` re-run.

## 7. Scheduled/background operations

- Cloud Scheduler (service account
  `suchi-scheduler@gen-lang-client-0202543132.iam.gserviceaccount.com`) hits
  OIDC-guarded admin endpoints: daily report, article/hospital research,
  housekeeping (retention, draft expiry), review-queue digest
  (`apps/api/src/common/guards/scheduler-oidc.guard.ts`).
- Navigator research/sender Cloud Run Jobs: `cloudbuild.navigator-research.yaml`
  (state in `gs://suchi-navigator-state`; secret names
  `ANTHROPIC_API_KEY`, `NAVIGATOR_APPROVAL_SECRET`, `SMTP_PASS`).
- Autoresearch nightly loop: `cloudbuild-autoresearch.yaml`, proposal-mode
  only — it pushes `autoresearch/*` branches for human review.
- KB ingestion job image: `cloudbuild.kb-ingest.yaml` + `Dockerfile.kb-ingest`
  (runs `src/scripts/ingest-kb.ts --wipeChunks`).
