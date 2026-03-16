# Suchi Deployment Preflight

Checklist for API/Web deployment on the current Cloud Build + Cloud Run pipeline.

## How To Use

Run this before merging to `main` or manually triggering deploy.
If any check fails, stop and fix first.

## 1. Build Inputs

| Check | Command / Validation |
|---|---|
| API compiles | `cd apps/api && npm run build` |
| Web compiles | `cd apps/web && npm run build` |
| Prisma schema valid | `cd apps/api && npx prisma validate` |
| No accidental path drift | Confirm changed files are in expected app/module paths |

## 2. Runtime Configuration

| Check | Why it matters |
|---|---|
| `DATABASE_URL`, `ADMIN_BASIC_USER`, `ADMIN_BASIC_PASS` set | Required for API startup and admin auth |
| `LLM_PROVIDER` + provider-specific credentials are consistent | Prevents startup/runtime LLM failures |
| If `LLM_PROVIDER=gemini`, set `GOOGLE_CLOUD_PROJECT` | Required by Vertex AI path |
| `EMBEDDING_MODEL` and embedding key are set intentionally | Prevents retrieval regressions |
| Scheduler envs (`SCHEDULER_OIDC_AUDIENCE`, `SCHEDULER_SA_EMAIL`) are present for daily report cron | Prevents OIDC guard failures |
| SMTP envs are present if email report delivery is expected | Avoids silent `emailSent=false` behavior |

Reference: `docs/ENVIRONMENT_VARIABLES.md`.

## 3. Database & Migration Safety

| Check | Command / Validation |
|---|---|
| Local migration status is clean | `cd apps/api && npx prisma migrate status` |
| New migration reviewed for backward compatibility | Confirm SQL is safe for rolling deploy |
| Cloud Run migration job target exists (`suchi-db-migrate`) | Required by `cloudbuild.gated.yaml` |

## 4. API Smoke Tests (Local Or Candidate)

| Check | Command / Validation |
|---|---|
| Health check responds on prefixed path | `GET /v1/health` returns `status: ok` |
| Session + chat round-trip works | `POST /v1/sessions` then `POST /v1/chat` |
| Feedback write works | `POST /v1/feedback` with valid `sessionId` |
| Admin auth works | `GET /v1/admin/metrics` with Basic Auth |
| If touching voice code: verify upload path | `POST /v1/voice/respond` with supported MIME |
| If touching voice WS code: verify feature-flagged namespace | Enable `VOICE_WS_ENABLED=true`, test `/v1/voice/stream` |

## 5. Deployment Pipeline Checks

`cloudbuild.gated.yaml` is the primary deployment path.

| Check | Why it matters |
|---|---|
| Candidate deploy keeps `--no-traffic` before promotion | Protects live traffic during validation |
| Candidate health check targets `/v1/health` | Matches global API prefix |
| Migration step runs before candidate promotion | Avoids schema/runtime mismatch |
| Web deploy waits for API promotion | Prevents frontend pointing to broken API |
| Build timeout is sufficient for image + migration + rollout | Avoids partial deploy failures |

## 6. Operational Runbook (Production)

Trigger deployment:

```bash
gcloud builds submit --config=cloudbuild.gated.yaml
```

Watch rollout:

```bash
gcloud builds list --limit=5
gcloud run revisions list --service=suchi-api --region=us-central1
```

Check post-deploy health:

```bash
API_URL=$(gcloud run services describe suchi-api --region us-central1 --format='value(status.url)')
curl -fsS "$API_URL/v1/health"
```

## 7. Fast Failure Recovery

If a bad revision is promoted, shift traffic back immediately:

```bash
gcloud run revisions list --service=suchi-api --region=us-central1
gcloud run services update-traffic suchi-api \
  --region=us-central1 \
  --to-revisions=<known-good-revision>=100
```

Then fix forward with a new commit.
