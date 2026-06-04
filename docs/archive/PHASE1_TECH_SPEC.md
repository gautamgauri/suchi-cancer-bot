# Suchi Phase 1 Technical Spec — NestJS + Prisma + Postgres

## Components
- NestJS API (`apps/api`)
- Prisma schema + migrations (`apps/api/prisma`)
- KB folder + manifest (`kb/`)
- KB ingestion CLI (`apps/api/src/scripts/ingest-kb.ts`)

## Endpoints
- `POST /v1/sessions`
- `POST /v1/chat`
- `POST /v1/feedback`
- `GET /v1/admin/conversations` (Basic Auth)
- `GET /v1/admin/metrics` (Basic Auth)

## Chat flow
1. Persist user message
2. Safety policy evaluation (self-harm/emergency/refusal/misinformation)
3. If policy triggered: return safe template response + safety event
4. Else: retrieve KB chunks (keyword) + generate response (LLM stub)
5. Persist assistant message + analytics

## KB retrieval
pgvector cosine-similarity search with query expansion (breast symptom synonyms), reranking (trusted-source boost, pathology/biopsy content demotion for symptom queries), and 500-char chunk size. Explain-mode prompt handles citation rules for safety responses and includes a symptom query handling section.

## Local run
From `apps/api`:
- `npm install`
- `cp .env.example .env` and set `DATABASE_URL`
- `npx prisma generate`
- `npx prisma migrate dev --name init`
- `npm run dev`
- Optional: `npm run kb:ingest`
