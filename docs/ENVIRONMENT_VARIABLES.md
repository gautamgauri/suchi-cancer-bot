# Environment Variables Configuration

This document describes the backend runtime config in `apps/api/src/config/env.validation.ts` plus module-level optional vars currently used in code.

The schema file is the authoritative list. This document does not yet cover every variable in it. The WhatsApp, Meta, LinkedIn, Langfuse and Sarvam variables are described only by the comments in the schema. Production values are set in `cloudbuild.yaml`.

## API Variables

### Required in all environments

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ADMIN_BASIC_USER` | Basic auth username for admin/review routes |
| `ADMIN_BASIC_PASS` | Basic auth password for admin/review routes |

### LLM provider configuration

Gemini is the only live provider. Production sets `LLM_PROVIDER=gemini`, which is also the default. The `openai` and `deepseek` values are legacy code paths. Nothing in production uses them and no new work should depend on them.

| Provider | Status | Required variables | Optional variables |
|----------|--------|--------------------|--------------------|
| `gemini` | Live | `GEMINI_API_KEY` or `GOOGLE_CLOUD_PROJECT` | `VERTEX_AI_LOCATION` (default `us-central1`), `GEMINI_MODEL` (default `gemini-2.5-flash`), `LLM_TIMEOUT_MS` |
| `openai` | Legacy, unused | `OPENAI_API_KEY` | `LLM_TIMEOUT_MS` |
| `deepseek` | Legacy, unused | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com/v1`), `DEEPSEEK_MODEL` (default `deepseek-chat`), `LLM_TIMEOUT_MS` |

Notes:
- When `GEMINI_API_KEY` is set, the service calls the Google AI API. Without it, the service uses Vertex AI with `GOOGLE_CLOUD_PROJECT`. Production mounts `GEMINI_API_KEY`.
- When `LLM_PROVIDER=gemini`, startup fails only if both `GEMINI_API_KEY` and `GOOGLE_CLOUD_PROJECT` are missing.
- `LLM_TIMEOUT_MS` defaults to `15000` in env validation. Production sets `45000`.
- `cloudbuild.yaml` still mounts `DEEPSEEK_API_KEY` from the secret `deepseek-api-key`. The secret must exist for a deploy to succeed, although the API does not use it.

### Core optional variables (validated)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | runtime default | API port |
| `NODE_ENV` | unset | Environment marker |
| `RATE_LIMIT_TTL_SEC` | `60` (module fallback) | Rate-limit window |
| `RATE_LIMIT_REQ_PER_TTL` | `20` (module fallback) | Requests per window |
| `EMBEDDING_API_KEY` | unset | Embedding provider key |
| `EMBEDDING_MODEL` | `text-embedding-004` | Embedding model. Production sets `gemini-embedding-001`. |
| `REVIEW_COPILOT_MODE` | `off` | Review mode: `off`, `shadow`, `active` |

### Voice optional variables (validated)

| Variable | Default |
|----------|---------|
| `GCS_BUCKET_TTS` | unset |
| `GCS_SIGNED_URL_EXPIRY_MIN` | `60` |
| `STT_LANGUAGE_CODE` | `hi-IN` |
| `STT_MODEL` | `latest_short` |
| `STT_CONFIDENCE_THRESHOLD` | `0.6` |
| `TTS_VOICE_NAME` | `hi-IN-Neural2-D` |
| `TTS_SPEAKING_RATE` | `0.9` |
| `VOICE_MAX_AUDIO_SIZE_BYTES` | `2097152` |
| `VOICE_MAX_AUDIO_DURATION_SEC` | `60` |
| `STT_VERSION` | `v2` |
| `VOICE_WS_ENABLED` | `false` |
| `VOICE_WS_IDLE_TIMEOUT_MS` | `30000` |
| `VOICE_WS_MAX_SESSION_MS` | `60000` |

### Reranker optional variables (module-level)

These are used by `apps/api/src/modules/rag/reranker.service.ts` and are not currently enforced in `env.validation.ts`.

| Variable | Purpose |
|----------|---------|
| `RERANKER_PROVIDER` | `voyage`, `cohere`, `jina`, or `none` |
| `VOYAGE_API_KEY` | Voyage reranker auth |
| `COHERE_API_KEY` | Cohere reranker auth |
| `JINA_API_KEY` | Jina reranker auth |

## Local Development Example (`apps/api/.env`)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/suchi?schema=public
ADMIN_BASIC_USER=admin
ADMIN_BASIC_PASS=change_me_now

# LLM. Set GEMINI_API_KEY for the Google AI API (as production does),
# or GOOGLE_CLOUD_PROJECT for Vertex AI with Application Default Credentials.
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
# GOOGLE_CLOUD_PROJECT=your-gcp-project
# VERTEX_AI_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash
LLM_TIMEOUT_MS=15000

# Embeddings (production uses gemini-embedding-001)
EMBEDDING_API_KEY=your_embedding_api_key
EMBEDDING_MODEL=gemini-embedding-001

# Review Copilot rollout control
REVIEW_COPILOT_MODE=off

# Optional reranker
RERANKER_PROVIDER=voyage
VOYAGE_API_KEY=

PORT=3001
NODE_ENV=development
RATE_LIMIT_TTL_SEC=60
RATE_LIMIT_REQ_PER_TTL=20
```

## Web Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_API_URL` | Build-time optional | Backend base URL (defaults to relative `/v1` with Vite proxy in local dev) |

## Cloud SQL URL Format

Cloud Run with Cloud SQL socket:

```text
postgresql://USERNAME:PASSWORD@/DATABASE_NAME?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
```

Local development:

```text
postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME
```

## Secret Manager Mapping

These are the secrets `cloudbuild.yaml` mounts on `suchi-api`, by name only. That file is the authoritative list. Every name must exist in Secret Manager or the deploy fails. Names are case-sensitive.

| Env var | Secret name |
|---------|-------------|
| `DATABASE_URL` | `database-url` |
| `DEEPSEEK_API_KEY` | `deepseek-api-key` (legacy, still mounted) |
| `EMBEDDING_API_KEY` | `embedding-api-key` |
| `ADMIN_BASIC_USER` | `admin-basic-user` |
| `ADMIN_BASIC_PASS` | `admin-basic-pass` |
| `SMTP_PASS` | `SMTP_PASS` |
| `LANGFUSE_PUBLIC_KEY` | `langfuse-public-key` |
| `LANGFUSE_SECRET_KEY` | `langfuse-secret-key` |
| `NAVIGATOR_APPROVAL_SECRET` | `NAVIGATOR_APPROVAL_SECRET` |
| `CONTENT_APPROVAL_SECRET` | `CONTENT_APPROVAL_SECRET` |
| `META_PAGE_ACCESS_TOKEN` | `META_PAGE_ACCESS_TOKEN` |
| `META_PAGE_ID` | `META_PAGE_ID` |
| `META_IG_USER_ID` | `META_IG_USER_ID` |
| `GEMINI_API_KEY` | `GEMINI_API_KEY` |
| `DISTRIBUTION_APPROVAL_SECRET` | `DISTRIBUTION_APPROVAL_SECRET` |
| `META_WABA_PHONE_NUMBER_ID` | `META_WABA_PHONE_NUMBER_ID` |
| `META_WABA_TOKEN` | `META_WABA_TOKEN` |
| `META_APP_SECRET` | `META_APP_SECRET` |
| `WHATSAPP_VERIFY_TOKEN` | `WHATSAPP_VERIFY_TOKEN` |
| `LINKEDIN_ACCESS_TOKEN` | `LINKEDIN_ACCESS_TOKEN` |
| `LINKEDIN_AUTHOR_URN` | `LINKEDIN_AUTHOR_URN` |

`cloudbuild.yaml` also sets ten names that the schema does not declare. They are `SCHEDULER_OIDC_AUDIENCE`, `SCHEDULER_SA_EMAIL`, `DAILY_REPORT_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `QUEUE_GCS_BUCKET`, `NAVIGATOR_APPROVAL_SECRET` and `CONTENT_APPROVAL_SECRET`. The code reads them directly from the environment.

Rotation and the notes on each secret are in `docs/OPERATIONS.md` section 7.

## Security Notes

1. Never commit `.env` files.
2. Keep `ADMIN_BASIC_PASS` in secret storage, not plaintext config.
3. Rotate API keys and admin credentials regularly.
4. Use least-privilege IAM for runtime service accounts.

