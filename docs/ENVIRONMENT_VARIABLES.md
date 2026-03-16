# Environment Variables

Configuration reference for `apps/api` and `apps/web`.

## API Variables (`apps/api`)

### Required at startup

These are validated in `apps/api/src/config/env.validation.ts`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ADMIN_BASIC_USER` | Basic auth username for admin routes |
| `ADMIN_BASIC_PASS` | Basic auth password for admin routes |

### LLM provider configuration

`LLM_PROVIDER` defaults to `gemini`.

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | Allowed: `gemini`, `deepseek`, `openai` |
| `GOOGLE_CLOUD_PROJECT` | none | Required when `LLM_PROVIDER=gemini` |
| `VERTEX_AI_LOCATION` | `us-central1` | Vertex location for Gemini |
| `GEMINI_MODEL` | `gemini-2.0-flash-001` | Gemini model ID |
| `OPENAI_API_KEY` | none | Required when `LLM_PROVIDER=openai` |
| `DEEPSEEK_API_KEY` | none | Required when `LLM_PROVIDER=deepseek` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI-compatible Deepseek base URL |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Deepseek model name |
| `LLM_TIMEOUT_MS` | `15000` | LLM timeout in ms |

### Retrieval and embeddings

| Variable | Default | Notes |
|---|---|---|
| `EMBEDDING_API_KEY` | none | Used for embedding requests |
| `EMBEDDING_MODEL` | `text-embedding-004` | Deployment may override this to `gemini-embedding-001` |
| `RERANKER_PROVIDER` | auto-detect | `voyage`, `cohere`, `jina`, `none` |
| `VOYAGE_API_KEY` | none | Enables Voyage reranker |
| `COHERE_API_KEY` | none | Enables Cohere reranker |
| `JINA_API_KEY` | none | Enables Jina reranker |
| `RAG_TRACE_RERANK` | `false` | Enables verbose reranking logs when `true` |

### API runtime

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3001` local / `8080` Cloud Run | HTTP port |
| `NODE_ENV` | unset | Typical values: `development`, `production` |
| `RATE_LIMIT_TTL_SEC` | `60` | Throttling window |
| `RATE_LIMIT_REQ_PER_TTL` | `20` | Max requests per TTL |

### Voice pipeline

| Variable | Default | Notes |
|---|---|---|
| `STT_VERSION` | `v2` | `v1` or `v2` STT provider |
| `STT_LANGUAGE_CODE` | `hi-IN` | Default recognition language |
| `STT_MODEL` | `latest_short` | STT model |
| `STT_CONFIDENCE_THRESHOLD` | `0.6` | Below threshold prompts user retry |
| `TTS_VOICE_NAME` | `hi-IN-Neural2-A` | Voice used for Hindi path |
| `TTS_SPEAKING_RATE` | `0.9` | TTS speed |
| `GCS_BUCKET_TTS` | `suchi-tts-audio` | Bucket used for synthesized audio |
| `GCS_SIGNED_URL_EXPIRY_MIN` | `60` | Signed URL expiry |
| `VOICE_MAX_AUDIO_SIZE_BYTES` | `2097152` | Max uploaded file size |
| `VOICE_MAX_AUDIO_DURATION_SEC` | `60` | Max uploaded audio duration |
| `VOICE_WS_ENABLED` | `false` | Enables WebSocket voice namespace |
| `VOICE_WS_IDLE_TIMEOUT_MS` | `30000` | WS idle timeout |
| `VOICE_WS_MAX_SESSION_MS` | `60000` | WS hard session timeout |

### Scheduler and reporting

These are read via `process.env` in guard/controller/service code.

| Variable | Required for | Notes |
|---|---|---|
| `SCHEDULER_OIDC_AUDIENCE` | `POST /v1/admin/daily-report` | Must match Cloud Run audience |
| `SCHEDULER_SA_EMAIL` | `POST /v1/admin/daily-report` | Expected scheduler service account |
| `DAILY_REPORT_EMAIL` | Daily report email target | Used when `email` query param is omitted |
| `SMTP_HOST` | Sending report emails | |
| `SMTP_PORT` | Sending report emails | Defaults to `587` |
| `SMTP_USER` | Sending report emails | |
| `SMTP_PASS` | Sending report emails | |
| `SMTP_FROM` | Sending report emails | Default: `Suchi Beta <noreply@suchi.org>` |

## Web Variables (`apps/web`)

| Variable | Purpose | Example |
|---|---|---|
| `VITE_API_URL` | Base API URL injected at build time | `https://suchi-api-xxxxx.run.app/v1` |

Local dev usually uses the Vite proxy (`/v1` -> `http://localhost:3001`).

## Local `.env` Example (`apps/api/.env`)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/suchi?schema=public
ADMIN_BASIC_USER=admin
ADMIN_BASIC_PASS=change_me_now

LLM_PROVIDER=gemini
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
VERTEX_AI_LOCATION=us-central1
GEMINI_MODEL=gemini-2.0-flash-001
LLM_TIMEOUT_MS=15000

EMBEDDING_API_KEY=your-embedding-key
EMBEDDING_MODEL=text-embedding-004

RERANKER_PROVIDER=voyage
VOYAGE_API_KEY=your-voyage-key

RATE_LIMIT_TTL_SEC=60
RATE_LIMIT_REQ_PER_TTL=20
PORT=3001
NODE_ENV=development

STT_VERSION=v2
GCS_BUCKET_TTS=suchi-tts-audio
VOICE_WS_ENABLED=false
```

## Cloud SQL URL Format

Cloud Run + Cloud SQL connector:

```text
postgresql://USERNAME:PASSWORD@/DATABASE?host=/cloudsql/PROJECT_ID:REGION:INSTANCE
```

Local:

```text
postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE
```

## Troubleshooting

- Error: `GOOGLE_CLOUD_PROJECT is required when LLM_PROVIDER=gemini`
  - Set `GOOGLE_CLOUD_PROJECT` or switch `LLM_PROVIDER`.
- `POST /v1/admin/daily-report` returns OIDC guard error
  - Verify `SCHEDULER_OIDC_AUDIENCE` and `SCHEDULER_SA_EMAIL`.
- Report generation succeeds but email is never sent
  - Check `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`.
- Voice endpoint rejects uploads
  - Check MIME type, `VOICE_MAX_AUDIO_SIZE_BYTES`, and `VOICE_MAX_AUDIO_DURATION_SEC`.

