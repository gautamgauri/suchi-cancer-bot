# Environment Variables

This document reflects the current runtime behavior in `apps/api` and `apps/web`.

## API (`apps/api`) Variables

### Required for API startup

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string used by Prisma. |
| `ADMIN_BASIC_USER` | Yes | Basic auth username for admin/review/youtube endpoints. |
| `ADMIN_BASIC_PASS` | Yes | Basic auth password for admin/review/youtube endpoints. |
| `EMBEDDING_API_KEY` | Yes\* | Embeddings service key (Google AI API). |

\* `EmbeddingsService` also falls back to `GEMINI_API_KEY` if present, but `EMBEDDING_API_KEY` is the canonical setting.

### LLM provider configuration

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | Allowed: `gemini`, `openai`, `deepseek`. |
| `GOOGLE_CLOUD_PROJECT` | none | Required when `LLM_PROVIDER=gemini`. |
| `VERTEX_AI_LOCATION` | `us-central1` | Vertex region for Gemini. |
| `GEMINI_MODEL` | `gemini-2.0-flash-001` | Gemini model name. |
| `OPENAI_API_KEY` | none | Required when `LLM_PROVIDER=openai`. |
| `DEEPSEEK_API_KEY` | none | Required when `LLM_PROVIDER=deepseek`. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | Deepseek base URL. |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Deepseek model name. |
| `LLM_TIMEOUT_MS` | `15000` | LLM timeout budget in milliseconds. |
| `LLM_FALLBACK_ENABLED` | enabled | Optional runtime toggle (`false` disables Gemini fallback for non-Gemini primary providers). |

### Core runtime and throttling

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3001` local | Cloud Run usually injects `8080`. |
| `NODE_ENV` | unset | Standard Node environment (`development`, `production`, etc.). |
| `RATE_LIMIT_TTL_SEC` | `60` | Global throttler window (seconds). |
| `RATE_LIMIT_REQ_PER_TTL` | `20` | Global requests per window. |

### Voice (HTTP + TTS + storage)

| Variable | Default | Notes |
|---|---|---|
| `GCS_BUCKET_TTS` | `suchi-tts-audio` | Bucket for generated TTS audio objects. |
| `GCS_SIGNED_URL_EXPIRY_MIN` | `60` | Signed URL expiry for audio playback links. |
| `STT_LANGUAGE_CODE` | `hi-IN` | Default STT language code. |
| `STT_MODEL` | `latest_short` | STT model setting used by provider. |
| `STT_CONFIDENCE_THRESHOLD` | `0.6` | Below threshold, voice pipeline asks user to retry. |
| `STT_VERSION` | `v2` | `v1` or `v2` provider selection. |
| `TTS_PROVIDER` | `google` | `google` or `sarvam`. |
| `TTS_VOICE_NAME` | `hi-IN-Neural2-D` | Default Google TTS voice override. |
| `TTS_SPEAKING_RATE` | `0.9` | Speaking rate for Google TTS. |
| `SARVAM_API_KEY` | none | Required if `TTS_PROVIDER=sarvam`. |
| `SARVAM_TTS_SPEAKER` | `meera` | Sarvam speaker ID. |
| `SARVAM_TTS_MODEL` | `bulbul:v2` | Sarvam model. |
| `VOICE_MAX_AUDIO_SIZE_BYTES` | `2097152` | Voice upload guardrail (2 MB). |
| `VOICE_MAX_AUDIO_DURATION_SEC` | `60` | Voice duration guardrail. |

### Voice WebSocket (optional)

| Variable | Default | Notes |
|---|---|---|
| `VOICE_WS_ENABLED` | `false` | Must be `true` to enable `/v1/voice/stream`. |
| `VOICE_WS_IDLE_TIMEOUT_MS` | `30000` | Disconnect idle WS clients. |
| `VOICE_WS_MAX_SESSION_MS` | `60000` | Hard cap per WS session. |

### Review copilot

| Variable | Default | Notes |
|---|---|---|
| `REVIEW_COPILOT_MODE` | `off` | Allowed: `off`, `shadow`, `active`. |

### Daily report + email + scheduler integration

| Variable | Default | Notes |
|---|---|---|
| `DAILY_REPORT_EMAIL` | `gautamgauri@dikshafoundation.org` | Fallback recipient for `POST /v1/admin/daily-report`. |
| `SMTP_HOST` | none | Required for outbound emails. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_USER` | none | SMTP username. |
| `SMTP_PASS` | none | SMTP password. |
| `SMTP_FROM` | `Suchi Beta <noreply@suchi.org>` | Sender identity. |
| `SCHEDULER_OIDC_AUDIENCE` | none | Required by scheduler OIDC guard. |
| `SCHEDULER_SA_EMAIL` | none | Required caller service account email for OIDC guard. |

### Operational/debug variables

| Variable | Description |
|---|---|
| `INSTANCE_CONNECTION_NAME` | Used only for startup DB target fingerprint logging. |
| `BUILD_ID` / `IMAGE_TAG` | Build metadata logged at startup. |
| `RAG_TRACE_RERANK` | Reranker tracing toggle used in RAG module. |
| `KB_ROOT` | Optional KB script override path for ingestion tooling. |

## Web (`apps/web`) Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Optional | API base URL for production build. If unset, frontend uses relative `/v1` (works with local dev proxy). |

## Local Development Example (`apps/api/.env`)

```env
DATABASE_URL=postgresql://suchi_app:password@localhost:5432/suchi_db
ADMIN_BASIC_USER=admin
ADMIN_BASIC_PASS=change-me

LLM_PROVIDER=gemini
GOOGLE_CLOUD_PROJECT=your-gcp-project
VERTEX_AI_LOCATION=us-central1
GEMINI_MODEL=gemini-2.0-flash-001
LLM_TIMEOUT_MS=15000

EMBEDDING_API_KEY=your_google_ai_key
EMBEDDING_MODEL=text-embedding-004

PORT=3001
NODE_ENV=development
RATE_LIMIT_TTL_SEC=60
RATE_LIMIT_REQ_PER_TTL=20

VOICE_WS_ENABLED=false
REVIEW_COPILOT_MODE=off
```

## Common Misconfigurations

- `LLM_PROVIDER=gemini` without `GOOGLE_CLOUD_PROJECT` causes API startup failure.
- Missing embedding key (`EMBEDDING_API_KEY` or `GEMINI_API_KEY`) causes embedding service initialization failure.
- WebSocket voice tests fail unless `VOICE_WS_ENABLED=true`.
- `POST /v1/admin/daily-report` fails authentication if `SCHEDULER_OIDC_AUDIENCE` or `SCHEDULER_SA_EMAIL` is missing.

