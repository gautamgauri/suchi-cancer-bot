# Suchi Cancer Bot

Suchi is a safety-constrained cancer information assistant with KB-grounded responses, citation enforcement, voice workflows, and evaluation tooling.

## Repository Layout
- `apps/api`: NestJS API (main runtime)
- `apps/web`: React + Vite chat frontend
- `kb`: Knowledge base markdown + manifest
- `eval`: Evaluation framework and test suites
- `docs`: Product, architecture, ops, and deployment docs
- `scripts`: Ingestion/content generation utilities

## Quick Start

### 1. Backend (`apps/api`)
```bash
cd apps/api
npm install
```

Create `apps/api/.env` (minimum local dev variables):
```env
DATABASE_URL=postgresql://suchi_app:password@localhost:5432/suchi_db
ADMIN_BASIC_USER=admin
ADMIN_BASIC_PASS=your_secure_password

# LLM runtime (default provider is gemini)
LLM_PROVIDER=gemini
GOOGLE_CLOUD_PROJECT=your-gcp-project
VERTEX_AI_LOCATION=us-central1
GEMINI_MODEL=gemini-2.0-flash-001

# Embeddings are required for KB retrieval
EMBEDDING_API_KEY=your_google_ai_key
EMBEDDING_MODEL=text-embedding-004
```

Then:
```bash
npx prisma generate
npx prisma migrate dev
npm run dev
```

API base URL: `http://localhost:3001/v1`

### 2. Frontend (`apps/web`)
```bash
cd apps/web
npm install
npm run dev
```

Frontend URL: `http://localhost:3000`
The Vite dev proxy forwards `/v1` to `http://localhost:3001`.

## API Surface

All endpoints are prefixed with `/v1`.

### Core Chat
- `POST /sessions`: Create a session (`channel` in `web|app|whatsapp|voice`)
- `GET /sessions/:sessionId`: Get session metadata
- `POST /chat`: Run chat turn
- `POST /feedback`: Submit feedback (`up|down`)
- `GET /health`: DB connectivity and service health

### Voice HTTP
- `POST /voice/respond`: Multipart audio (`audio` file + `sessionId`, optional `locale`)
- `POST /voice/tts`: Text-to-speech for web “Listen” playback

### Voice WebSocket (opt-in)
- Namespace: `/v1/voice/stream`
- Enable with `VOICE_WS_ENABLED=true`
- Events: `audio:start` (with `sessionId`, optional `locale`), `audio:chunk` (binary chunks), `audio:end`
- Server emits: `stt:interim`, `stt:final`, `response`, `error`

### Admin / Review / Copilot
- Admin (Basic Auth): `/admin/*` and `/admin/youtube/*`
- Review queue and policies (Basic Auth): `/review/*`
- Copilot workflow APIs (internal workflow): `/copilot/*`

## Examples

### Create session + chat
```bash
curl -sS -X POST "http://localhost:3001/v1/sessions" \
  -H "content-type: application/json" \
  -d '{"channel":"web"}'
```

```bash
curl -sS -X POST "http://localhost:3001/v1/chat" \
  -H "content-type: application/json" \
  -d '{
    "sessionId":"<SESSION_UUID>",
    "channel":"web",
    "userText":"What are warning signs of oral cancer?"
  }'
```

### Voice respond (multipart)
```bash
curl -sS -X POST "http://localhost:3001/v1/voice/respond" \
  -F "audio=@sample.wav" \
  -F "sessionId=<SESSION_UUID>" \
  -F "locale=en-IN"
```

### TTS for web playback
```bash
curl -sS -X POST "http://localhost:3001/v1/voice/tts" \
  -H "content-type: application/json" \
  -d '{"text":"Please consult your oncologist.","locale":"en-IN"}'
```

## Operational Notes
- Chat responses are cleaned for UI display while citations are returned in structured fields.
- `POST /chat` has a bounded request timeout and returns a user-safe timeout payload when exceeded.
- Voice uploads are size-limited in the controller (`2 MB` max file size).
- WebSocket voice is disabled unless explicitly enabled.

## Developer Runbooks
- Environment variables: `docs/ENVIRONMENT_VARIABLES.md`
- Deployment and migrations: `docs/DEPLOYMENT.md`
- Gated deployment flow: `docs/GATED_DEPLOYMENT.md`
- Eval framework: `eval/README.md`
- NCI ingestion pipeline: `docs/NCI_INGESTION_GUIDE.md`

## Common Pitfalls
- Missing `GOOGLE_CLOUD_PROJECT` with `LLM_PROVIDER=gemini` causes API startup failure.
- Missing embedding key (`EMBEDDING_API_KEY` or `GEMINI_API_KEY`) prevents embedding service startup.
- Calling WS voice endpoint without `VOICE_WS_ENABLED=true` results in connection failure.
