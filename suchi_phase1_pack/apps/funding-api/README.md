# funding-api

NestJS service for FundingBot: pipeline, activity logging, draft/need-statement and email drafting, eval/refine loop, donor profile generation. Optional Google Sheets persistence for activities and pipeline.

## Endpoints (prefix `/v1`)

- `GET /v1/pipeline` — pipeline entries (stub or from Sheets when configured)
- `POST /v1/pipeline/activity` — log activity (in-memory and/or append to Sheets)
- `POST /v1/draft/email` — template-based or evidence-backed email draft
- `POST /v1/draft/need-statement` — evidence-backed need statement draft
- `POST /v1/draft/need-statement/refine` — evaluate then refine draft (preserves citations)
- `POST /v1/donor/profile/generate` — structured donor profile + evidence gaps (orgName, urls?, notes?, chunks?)

## Local

- **Build:** `npm run build`
- **Start:** `npm run start` (default port 3001; set `PORT` or use `.env`)
- **Tests:** `npm test`

Requires `FUNDING_OPENAI_API_KEY` (see `.env.example`). Optional: `FUNDING_SHEETS_*` for persistence.

## GCloud deployment (Cloud Build + Cloud Run)

Same machinery as Suchi: build image → push to Artifact Registry (`suchi-images`) → `gcloud run deploy` with env + secrets. No CloudSQL; `--port 8080`; Nest reads `process.env.PORT`.

### Manual deploy

From the **repo root** (the directory that contains the `suchi_phase1_pack` folder):

```bash
gcloud builds submit --config suchi_phase1_pack/cloudbuild.funding.yaml .
```

To override the Secret Manager secret name without editing the file (default is `deepseek-api-key`, same as Suchi):

```bash
gcloud builds submit \
  --config suchi_phase1_pack/cloudbuild.funding.yaml \
  --substitutions _FUNDING_LLM_API_KEY_SECRET=YOUR_EXISTING_SECRET_NAME \
  .
```

### Cloud Build trigger

- **Config:** `suchi_phase1_pack/cloudbuild.funding.yaml`.
- **Included files:** e.g. `suchi_phase1_pack/apps/funding-api/**` and optionally the config file so only funding-api changes run this pipeline.
- **Substitutions:** defaults are `_REGION=us-central1`, `_ARTIFACT_REGISTRY=suchi-images`, `_FUNDING_LLM_API_KEY_SECRET=deepseek-api-key`, `_FUNDING_MODEL_DRAFT=deepseek-chat`, `_FUNDING_LLM_TIMEOUT_MS=45000`. Override in the trigger or via CLI as above.
- **Secrets:** `FUNDING_OPENAI_API_KEY` is set from the secret named by `_FUNDING_LLM_API_KEY_SECRET` (default: same as Suchi’s Deepseek key).
