# funding-api

NestJS backend for the Funding Bot. It owns proposal/fellowship generation, opportunity orchestration, evidence ingest + retrieval, donor pipeline, application assistant, governance approvals, and reporting.

## What This Service Does

- Runs the orchestrator pipeline (`fit -> gmail memory -> budget envelope -> web evidence -> generation`).
- Routes fellowship opportunities to a dedicated personal-voice path.
- Ingests and retrieves evidence chunks from Drive/Gmail-backed corpora.
- Supports inbound email automation that can intake, generate, and reply with drafts.
- Provides operational/admin endpoints (audit, export, reports, review queue).

## API Surface

Most controllers use global prefix `/v1`.

| Area | Endpoints |
|---|---|
| Health | `GET /live`, `GET /ready`, `GET /v1/health`, `GET /v1/version` |
| Orchestrator + proposals | `POST /v1/orchestrator/run`, `POST /v1/orchestrator/assess`, `POST /v1/proposals/generate`, `POST /v1/proposals/:runId/sections/:sectionName/regenerate`, `GET /v1/proposals/:runId`, `GET /v1/proposals/:runId/gaps` |
| Opportunity + pipeline | `GET/POST/PATCH /v1/opportunities*`, `GET/POST/PATCH /v1/pipeline*` |
| Evidence + governance | `POST /v1/evidence-ingest/*`, `GET /v1/evidence-ingest/*`, `PATCH /v1/evidence-ingest/review-queue/:documentId`, `GET /v1/admin/audit`, `POST /v1/admin/export/pipeline-to-sheets`, `POST /v1/approvals/*` |
| Apps + utility modules | `POST /v1/draft/*`, `POST /v1/donor/profile/generate`, `GET/POST /v1/funder-orgs/*`, `POST /v1/applications/*`, `GET /v1/applications/*`, `GET /v1/reports/*` |
| Email pipeline (current pathing) | `POST /v1/v1/email-pipeline/poll`, `POST /v1/v1/email-pipeline/process`, `GET /v1/v1/email-pipeline/status` |

Email pipeline note: controller currently declares `@Controller("v1/email-pipeline")`, so with global prefix the effective route is `/v1/v1/email-pipeline/*`.

## Local Setup

From `suchi_phase1_pack/apps/funding-api`:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Useful commands:

- `npm run build`
- `npm run start`
- `npm test`
- `npm run kb:ingest-funding`
- `npm run kb:ingest-funding:dry`
- `npm run test:smoke:quick`

## Environment Variables

Minimum required to boot:

- `DATABASE_URL`
- `FUNDING_OPENAI_API_KEY`

Common optional/runtime variables:

| Area | Variables |
|---|---|
| LLM and retries | `FUNDING_OPENAI_BASE_URL`, `FUNDING_MODEL_DRAFT`, `FUNDING_MODEL_EVAL`, `FUNDING_LLM_TIMEOUT_MS`, `FUNDING_LLM_MAX_RETRIES`, `FUNDING_LLM_RETRY_DELAY_MS` |
| Embeddings and retrieval | `USE_PGVECTOR` (default true), `FUNDING_EMBEDDING_PROVIDER` (`google` or `openai`), `FUNDING_EMBEDDINGS_API_KEY`, `FUNDING_EMBEDDINGS_BASE_URL`, `FUNDING_GEMINI_API_KEY`, `EVIDENCE_EMBEDDING_MODEL` |
| Google integrations | `FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON`, `FUNDING_GMAIL_USER`, `EVIDENCE_DRIVE_FOLDER_ID`, `SCCF_DRIVE_FOLDER_ID` |
| Email pipeline | `EMAIL_PIPELINE_POLL_ENABLED`, `EMAIL_PIPELINE_POLL_LABEL` (default `funding-bot`), `EMAIL_PIPELINE_OWNER_EMAIL` (defaults internally to `gautamgauri@dikshafoundation.org`) |
| Guarded/admin flows | `FUNDING_EXPORT_TOKEN` (evidence-ingest/admin guards), `FUNDING_WRITE_APPROVAL_TOKEN` (internal write approval flows) |

See `src/config/env.validation.ts` for the canonical schema.

## Workflow Examples

Run full orchestration:

```bash
curl -X POST http://localhost:3001/v1/orchestrator/run \
  -H "Content-Type: application/json" \
  -d '{
    "opportunityId": "RF-ESA-2026-27-001",
    "forceGenerate": false,
    "proposalOptions": {
      "focusGeography": "Bihar",
      "skipFramework": false
    }
  }'
```

Assess only (no generation):

```bash
curl -X POST http://localhost:3001/v1/orchestrator/assess \
  -H "Content-Type: application/json" \
  -d '{"opportunityId":"RF-ESA-2026-27-001"}'
```

Poll inbox email pipeline:

```bash
curl -X POST http://localhost:3001/v1/v1/email-pipeline/poll
```

Retrieve evidence for drafting (requires `orgId` in this mode):

```bash
curl -X POST http://localhost:3001/v1/evidence-ingest/retrieve \
  -H "Content-Type: application/json" \
  -d '{
    "query":"attendance outcomes for KHEL program",
    "mode":"proposal_drafting",
    "orgId":"diksha",
    "limit":5
  }'
```

## Operational Notes

- Fellowship routing is automatic in orchestrator when opportunity `docTypeCategory` is `"fellowship"`.
- Email pipeline idempotency is backed by `ProcessedEmail` table, so repeated polls should skip already-seen messages.
- `ExportTokenGuard` protects `evidence-ingest/*`, `admin/audit`, and `admin/export/*` only when `FUNDING_EXPORT_TOKEN` is configured.
- For `proposal_drafting` retrieval mode, `orgId` is mandatory to prevent cross-org evidence leakage.

## Troubleshooting

| Symptom | What to check |
|---|---|
| `orgId is required for proposal_drafting retrieval` | Include `"orgId"` in `POST /v1/evidence-ingest/retrieve` when mode is `proposal_drafting`. |
| `Invalid or missing export token` | Send `Authorization: Bearer <FUNDING_EXPORT_TOKEN>` (or `?token=`) on guarded admin/evidence endpoints. |
| `Gmail not configured — set FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON and FUNDING_GMAIL_USER` | Configure both vars before email pipeline or Gmail-backed features. |
| Orchestrator returns `stage: "parked"` | Fit decision was `no`; only use `"forceGenerate": true` deliberately. |
| Orchestrator returns `stage: "size_mismatch"` | Opportunity minimum grant exceeds modeled org capacity; use returned options to re-scope or skip. |

## Deployment

Cloud Build config: `suchi_phase1_pack/cloudbuild.funding.yaml`

Manual deploy from repo root:

```bash
gcloud builds submit --config suchi_phase1_pack/cloudbuild.funding.yaml .
```

The pipeline builds and deploys both `funding-api` and `funding-web`, runs `funding-migrate`, and sets API env/secrets for Cloud Run.
