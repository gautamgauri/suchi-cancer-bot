# Suchi Cancer Bot

Cancer information assistant with safety guardrails, KB-backed RAG responses, voice input, and feedback collection.

## Project Structure

```
apps/api/          → NestJS backend (the main codebase)
  src/modules/     → Feature modules (chat, voice, voice-ws, rag, safety, llm, etc.)
  src/config/      → Env validation, app config
  src/common/      → Shared utilities, guards, filters
  prisma/          → Schema & migrations (PostgreSQL + pgvector)
apps/web/          → React + Vite frontend chat UI
eval/              → Evaluation framework (test cases, runner, rubrics)
  cases/           → Test case JSON files by category
  runner/          → Eval execution engine
  rubrics/         → Scoring rubrics
  cli.ts           → Entry point for eval runs
kb/                → Knowledge base markdown files + manifest
docs/              → Documentation (PRD, specs, policies, deployment)
scripts/           → Python ingestion pipelines (NCI, YouTube transcripts)
```

## Key Commands

```bash
# API development
cd apps/api && npm run dev          # Start API on :3001
cd apps/api && npm run build        # Build
cd apps/api && npx jest             # Run tests
cd apps/api && npx jest --testPathPattern=<pattern>  # Run specific test

# Frontend
cd apps/web && npm run dev          # Start UI on :3000

# Eval
cd eval && npx ts-node cli.ts       # Run eval suite

# Database
cd apps/api && npx prisma generate  # Regenerate Prisma client
cd apps/api && npx prisma migrate dev  # Run migrations
```

## Tech Stack

- **Backend**: NestJS, Prisma ORM, PostgreSQL + pgvector
- **LLM**: Google Gemini (via `@google/generative-ai`)
- **Voice**: Google Cloud Speech-to-Text v2, Text-to-Speech
- **Frontend**: React, Vite, TypeScript
- **Deploy**: Google Cloud Run via Cloud Build
- **Eval**: Custom TypeScript framework with rubric-based scoring

## Conventions

- API modules follow NestJS pattern: `*.module.ts`, `*.service.ts`, `*.controller.ts`
- Tests use Jest and live alongside source files as `*.spec.ts`
- Environment validation in `apps/api/src/config/env.validation.ts`
- All API endpoints prefixed with `/v1`
- Safety-critical: never bypass safety module, never return medical advice without KB backing

## GCP Project

- Project: `gen-lang-client-0202543132`
- Service account: `suchi-scheduler@gen-lang-client-0202543132.iam.gserviceaccount.com`
- Cloud Run service: `suchi-api`
