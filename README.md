# Suchi Cancer Bot

Cancer information assistant with safety guardrails, KB-backed responses, voice support, and feedback collection.

## Repository Layout

- `apps/api`: NestJS backend (chat, RAG, safety, voice, admin, analytics)
- `apps/web`: React + Vite chat app
- `apps/landing`: Astro static site for public video/content pages
- `kb`: Knowledge base markdown and `manifest.json`
- `eval`: Evaluation runner, test cases, and rubrics
- `docs`: Deployment, environment, architecture, and operational docs
- `scripts`: KB ingestion and utility scripts

## Local Setup

### 1. Prerequisites

- Node.js 20+ and npm
- PostgreSQL with `pgvector`
- Google Cloud credentials for local features that call Vertex AI / Cloud APIs
- `ffmpeg` + `ffprobe` if you plan to test voice upload endpoints locally

### 2. API (`apps/api`)

```bash
cd apps/api
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate dev
npm run dev
```

API base URL: `http://localhost:3001/v1`

### 3. Web App (`apps/web`)

```bash
cd apps/web
npm install
npm run dev
```

Web app URL: `http://localhost:3000`

### 4. Landing Site (`apps/landing`)

```bash
cd apps/landing
npm install
npm run dev
```

Landing site URL: `http://localhost:4321`

## Public API Surface

All routes are prefixed by `/v1`.

### Core Endpoints

- `POST /v1/sessions`: create a user session
- `GET /v1/sessions/:sessionId`: fetch session status/context
- `POST /v1/chat`: send user text and receive an assistant response
- `POST /v1/feedback`: submit thumbs up/down feedback
- `GET /v1/health`: API + database health check
- `POST /v1/voice/respond`: one-shot voice request (audio upload -> STT -> chat -> TTS)

### Admin Endpoints (Basic Auth)

- `GET /v1/admin/conversations`
- `GET /v1/admin/metrics`
- `GET /v1/admin/kb-stats`
- `GET /v1/admin/daily-report`
- `POST /v1/admin/youtube/ingest`
- `POST /v1/admin/youtube/test`

### Scheduled/Admin Endpoint (OIDC Guard)

- `POST /v1/admin/daily-report`

## Request Examples

Create session:

```bash
curl -X POST http://localhost:3001/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"channel":"web","locale":"en"}'
```

Chat turn:

```bash
curl -X POST http://localhost:3001/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId":"<uuid>",
    "channel":"web",
    "locale":"en",
    "userText":"What are early signs of breast cancer?"
  }'
```

Voice turn (multipart upload):

```bash
curl -X POST http://localhost:3001/v1/voice/respond \
  -F "audio=@sample.wav;type=audio/wav" \
  -F "sessionId=<uuid>" \
  -F "locale=hi-IN"
```

## Voice Workflows

### HTTP Voice Endpoint

`POST /v1/voice/respond` accepts audio field name `audio` and supports:

- `audio/webm`
- `audio/ogg`
- `audio/opus`
- `audio/wav`
- `audio/wave`
- `audio/x-wav`
- `audio/mpeg`
- `audio/mp4`

Current server-side limits:

- max size: `2 MB` (configurable via `VOICE_MAX_AUDIO_SIZE_BYTES`)
- max duration: `60 s` (configurable via `VOICE_MAX_AUDIO_DURATION_SEC`)

### Realtime Voice (WebSocket, Optional)

Enable with `VOICE_WS_ENABLED=true`. The namespace is:

- `/v1/voice/stream`

Client event flow:

1. `audio:start` with `sessionId` (+ optional `locale`)
2. repeat `audio:chunk` with PCM chunks
3. `audio:end`
4. receive `stt:interim`, `stt:final`, and `response`

Timeout controls:

- `VOICE_WS_IDLE_TIMEOUT_MS`
- `VOICE_WS_MAX_SESSION_MS`

## Deployment Overview

- API/Web production deployment uses gated Cloud Build (`cloudbuild.gated.yaml`).
- Candidate API revision is health-checked before traffic promotion.
- Landing site deploys through GitHub Pages workflow (`.github/workflows/deploy-landing.yml`).

See:

- `docs/DEPLOYMENT.md`
- `docs/DEPLOY_PREFLIGHT.md`
- `docs/ENVIRONMENT_VARIABLES.md`

## Common Pitfalls

- `LLM_PROVIDER=gemini` requires `GOOGLE_CLOUD_PROJECT` (Vertex AI path).
- If you enable voice, ensure runtime has `ffmpeg`/`ffprobe` and Cloud Storage access for TTS URLs.
- Use `/v1/health` for smoke checks (global API prefix is always applied).
- Keep KB ingestion and DB schema migrations in sync before deploy.
