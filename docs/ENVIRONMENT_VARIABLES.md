# Environment Variables Configuration

This document reflects the backend runtime config in `apps/api/src/config/env.validation.ts` plus module-level optional vars currently used in code.

## API Variables

### Required in all environments

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ADMIN_BASIC_USER` | Basic auth username for admin/review routes |
| `ADMIN_BASIC_PASS` | Basic auth password for admin/review routes |

### LLM provider configuration

Set `LLM_PROVIDER` to one of: `gemini` (default), `openai`, `deepseek`.

| Provider | Required Variables | Optional Variables |
|----------|--------------------|--------------------|
| `gemini` | `GOOGLE_CLOUD_PROJECT` | `VERTEX_AI_LOCATION` (default `us-central1`), `GEMINI_MODEL` (default `gemini-2.5-flash`) |
| `openai` | `OPENAI_API_KEY` | `LLM_TIMEOUT_MS` |
| `deepseek` | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com/v1`), `DEEPSEEK_MODEL` (default `deepseek-chat`), `LLM_TIMEOUT_MS` |

Notes:
- `LLM_PROVIDER` defaults to `gemini`.
- When `LLM_PROVIDER=gemini`, startup fails if `GOOGLE_CLOUD_PROJECT` is missing.
- `LLM_TIMEOUT_MS` defaults to `15000` in env validation.

### Core optional variables (validated)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | runtime default | API port |
| `NODE_ENV` | unset | Environment marker |
| `RATE_LIMIT_TTL_SEC` | `60` (module fallback) | Rate-limit window |
| `RATE_LIMIT_REQ_PER_TTL` | `20` (module fallback) | Requests per window |
| `EMBEDDING_API_KEY` | unset | Embedding provider key |
| `EMBEDDING_MODEL` | `text-embedding-004` | Embedding model |
| `REVIEW_COPILOT_MODE` | `off` | Review mode: `off`, `shadow`, `active` |

### Voice optional variables (validated)

| Variable | Default |
|----------|---------|
| `GCS_BUCKET_TTS` | unset |
| `GCS_SIGNED_URL_EXPIRY_MIN` | `60` |
| `STT_LANGUAGE_CODE` | `hi-IN` |
| `STT_MODEL` | `latest_short` |
| `STT_CONFIDENCE_THRESHOLD` | `0.6` |
| `TTS_VOICE_NAME` | `hi-IN-Neural2-A` |
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

# LLM (default path)
LLM_PROVIDER=gemini
GOOGLE_CLOUD_PROJECT=your-gcp-project
VERTEX_AI_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash
LLM_TIMEOUT_MS=15000

# Embeddings
EMBEDDING_API_KEY=your_embedding_api_key
EMBEDDING_MODEL=text-embedding-004

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

## Secret Manager Mapping (example)

| Env Var | Suggested Secret Name |
|---------|------------------------|
| `DATABASE_URL` | `database-url` |
| `ADMIN_BASIC_USER` | `admin-basic-user` |
| `ADMIN_BASIC_PASS` | `admin-basic-pass` |
| `OPENAI_API_KEY` | `openai-api-key` |
| `DEEPSEEK_API_KEY` | `deepseek-api-key` |
| `EMBEDDING_API_KEY` | `embedding-api-key` |
| `VOYAGE_API_KEY` | `voyage-api-key` |

Example deployment snippet:

```bash
--set-secrets "DATABASE_URL=database-url:latest,ADMIN_BASIC_USER=admin-basic-user:latest,ADMIN_BASIC_PASS=admin-basic-pass:latest"
```

## Security Notes

1. Never commit `.env` files.
2. Keep `ADMIN_BASIC_PASS` in secret storage, not plaintext config.
3. Rotate API keys and admin credentials regularly.
4. Use least-privilege IAM for runtime service accounts.

