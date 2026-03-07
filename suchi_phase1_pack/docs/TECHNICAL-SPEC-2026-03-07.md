# Suchi Cancer Bot — Technical Specifications

**Document ID:** TECHNICAL-SPEC-2026-03-07
**Version:** 2.0
**Date:** 7 March 2026
**Status:** Active — reflects current production architecture

---

## 1. System Overview

Suchi is a monorepo containing multiple applications deployed as independent services on Google Cloud Run. The core product is a cancer information chatbot with RAG-backed responses, safety guardrails, voice I/O, and an automated evaluation framework.

### 1.1 Repository Structure

```
suchi_phase1_pack/
  apps/
    api/              → NestJS backend (primary service)
    web/              → React + Vite frontend chat UI
    funding-api/      → NestJS funding proposal generator (separate product)
    funding-web/      → React frontend for funding bot
    landing/          → Static landing page
  eval/               → Evaluation framework
    cases/            → Test case YAML/JSON files
    runner/           → Eval execution engine
    rubrics/          → Scoring rubrics (deterministic + LLM judge)
    config/           → Eval configuration and secrets
    cli.ts            → Entry point for eval runs
  kb/                 → Knowledge base markdown files + manifest.json
  docs/               → Documentation
  scripts/            → Python ingestion pipelines (NCI, YouTube transcripts)
  cloudbuild.yaml     → Main CI/CD pipeline
  cloudbuild.eval.yaml      → Evaluation pipeline
  cloudbuild.gated.yaml     → Gated deployment (eval must pass)
  cloudbuild.kb-ingest.yaml → KB ingestion pipeline
```

---

## 2. Tech Stack

| Layer | Technology | Version/Details |
|-------|-----------|----------------|
| **Backend Framework** | NestJS | TypeScript, modular architecture |
| **ORM** | Prisma | PostgreSQL with pgvector extension |
| **Database** | PostgreSQL + pgvector | Cloud SQL (production), local (dev) |
| **Primary LLM** | Google Gemini | `@google/generative-ai` SDK |
| **Fallback LLM** | DeepSeek | OpenAI-compatible API |
| **Embeddings** | Gemini Embedding | `gemini-embedding-001`, 768 dimensions |
| **Voice STT** | Google Cloud Speech-to-Text v2 | Chirp model |
| **Voice TTS** | Google Cloud Text-to-Speech | Neural voices |
| **Frontend** | React + Vite | TypeScript, SPA |
| **Deployment** | Google Cloud Run | Containerized, auto-scaling 0-10 instances |
| **CI/CD** | Google Cloud Build | Multiple pipeline configs |
| **Container Registry** | Artifact Registry | `us-central1-docker.pkg.dev` |
| **Secrets** | Google Secret Manager | All credentials and API keys |
| **Email** | SMTP (Gmail) | Daily analytics reports |

---

## 3. API Architecture

### 3.1 Module Map

The backend follows NestJS modular architecture. Each module has `*.module.ts`, `*.service.ts`, `*.controller.ts` (where applicable), and `*.spec.ts` test files.

```
src/modules/
  chat/           → Main orchestrator (handles all user messages)
  llm/            → LLM service (multi-provider: Gemini, DeepSeek)
  rag/            → Retrieval-augmented generation pipeline
  safety/         → Safety policy engine (emergency, self-harm, refusal)
  evidence/       → Evidence gate (validates KB evidence before LLM)
  citations/      → Citation extraction and validation
  embeddings/     → Vector embedding generation
  voice/          → Voice I/O (REST API: STT + TTS)
  voice-ws/       → Voice WebSocket gateway (streaming)
  sessions/       → Session management
  feedback/       → User feedback collection
  admin/          → Admin dashboard endpoints
  analytics/      → Analytics event tracking
  health/         → Health check endpoint
  abstention/     → Abstention decision logic
  prisma/         → Prisma client module
  email/          → Email service (daily reports)
  youtube/        → YouTube content integration
```

### 3.2 Module Dependency Graph

```
chat.service (ORCHESTRATOR)
  ├── safety.service          → Policy evaluation (first check)
  ├── rag.service             → KB retrieval (vector + keyword)
  │   ├── embeddings.service  → Query embedding generation
  │   ├── query-decomposer    → Multi-part query splitting
  │   ├── query-expander      → Query expansion with synonyms
  │   ├── reranker.service    → Result reranking
  │   └── retrieval-tool      → Multi-retrieve orchestration
  ├── evidence.service        → Evidence quality validation
  ├── llm.service             → LLM call (Gemini/DeepSeek)
  ├── citations.service       → Citation extraction + validation
  ├── greeting-flow.service   → User onboarding flow
  ├── empathy-detector        → Emotional tone detection (rule-based)
  ├── intent-classifier       → Query intent classification
  ├── mode-detector           → Response mode selection (explain/navigate/identify)
  ├── plan-executor.service   → Phase 3 structured response planner
  ├── output-verifier.service → Post-generation quality checks
  ├── analytics.service       → Event tracking
  └── prisma.service          → Database operations
```

---

## 4. API Endpoints

### 4.1 Public Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/v1/sessions` | Create a new chat session | None |
| `POST` | `/v1/chat` | Send message, get response | None |
| `POST` | `/v1/feedback` | Submit feedback for a message | None |
| `GET` | `/v1/health` | Health check | None |
| `POST` | `/v1/voice/stt` | Speech-to-text (audio upload) | None |
| `POST` | `/v1/voice/tts` | Text-to-speech (audio generation) | None |
| `WS` | `/v1/voice-ws` | Voice WebSocket (streaming STT/TTS) | None |

### 4.2 Admin Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/v1/admin/conversations` | List conversations with filters | Basic Auth |
| `GET` | `/v1/admin/metrics` | Analytics metrics | Basic Auth |

### 4.3 Internal/Scheduled Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/v1/admin/daily-report` | Trigger daily analytics email | OIDC (Cloud Scheduler) |

---

## 5. Chat Flow — Request Lifecycle

The `ChatService.handle()` method orchestrates the entire request. Here is the sequential flow:

### 5.1 Phase 1: Pre-Processing

```
1. Session lookup + message count          → Parallel DB queries
2. Save user message to DB                 → Sequential (needs message ID)
3. Safety policy evaluation                → Synchronous rule engine
   ├── Emergency detected?                 → Return emergency template + safety event
   ├── Self-harm detected?                 → Return crisis resources
   ├── Refusal triggered?                  → Return refusal template
   └── Misinformation?                     → Return correction template
4. Context extraction (rule-based)         → Synchronous (user type, cancer type)
5. Emotional tone detection (rule-based)   → Synchronous (anxious/calm/urgent/sad/neutral)
6. Session context update                  → DB write
```

### 5.2 Phase 2: Greeting Flow

```
7. Check greeting flow status              → DB query
   ├── Greeting in progress?               → Continue greeting Q&A
   ├── Needs greeting?                     → Start greeting flow
   └── Greeting complete                   → Continue to Phase 3
```

### 5.3 Phase 3: Retrieval & Evidence

```
8. Intent classification                   → Synchronous (regex-based)
9. Mode detection                          → Synchronous (explain/navigate/identify)
10. Recent message history                 → DB query (last 5 messages)
11. RAG retrieval                          → Vector search + keyword fallback
    ├── Query decomposition                → Split complex queries
    ├── Query expansion                    → Synonym matching
    ├── Multi-retrieve                     → Parallel retrieval across strategies
    └── Reranking                          → Score-based result ordering
12. Evidence gate validation               → Check evidence quality
    ├── Sufficient?                        → Continue to Phase 4
    ├── Weak?                              → Expansion retrieval (second RAG call)
    └── Insufficient?                      → Return SafeFallbackResponse
```

### 5.4 Phase 4: Response Generation

```
13. LLM response generation               → Gemini API call (15s timeout)
    ├── System prompt construction         → Mode-specific, cancer-type-aware
    ├── Evidence chunk injection           → Top-k chunks as context
    ├── Citation instruction               → Inline [citation:docId:chunkId] format
    └── Response generation                → Streaming or batch
14. Citation extraction                    → Parse citation markers from response
15. Citation validation                    → Verify against retrieved chunks
16. Essential term injection               → Ensure cancer-type-specific terms present
17. Time budget check (25s)                → Skip regeneration if over budget
18. Quality checks (if within budget):
    ├── Identify question regeneration     → Re-generate if identify rubric fails
    └── Citation RED regeneration          → Re-generate if citations insufficient
19. Disclaimer appending                   → Medical disclaimer on every response
20. Save assistant message to DB           → With citations, latency, evidence quality
21. Analytics event emission               → Non-blocking
```

### 5.5 Response Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Explain** | Informational queries (general, symptoms, treatment, side effects) | Full medical information with citations, structured sections |
| **Navigate** | Personal symptom queries ("I have a lump") | Provider referral, preparation guidance, no medical advice |
| **Identify** | Symptom identification questions | Symptom checklist, when to see a doctor, warning signs |

---

## 6. Database Schema

### 6.1 Entity Relationship

```
Session (1) ──→ (*) Message
Session (1) ──→ (*) Feedback
Session (1) ──→ (*) SafetyEvent
Session (1) ──→ (*) AnalyticsEvent
Session (1) ──→ (*) VoiceInteraction
Message (1) ──→ (*) Feedback
Message (1) ──→ (*) SafetyEvent
Message (1) ──→ (*) MessageCitation
KbDocument (1) ──→ (*) KbChunk
```

### 6.2 Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **Session** | Chat session with user context | `id`, `channel`, `userContext`, `cancerType`, `greetingCompleted`, `emotionalState`, `isEval`, geolocation fields |
| **Message** | User and assistant messages | `id`, `sessionId`, `role`, `text`, `safetyClassification`, `evidenceQuality`, `citationCount`, `abstentionReason`, `evidenceGatePassed`, `latencyMs` |
| **MessageCitation** | Inline citation records linking messages to KB | `messageId`, `docId`, `chunkId`, `citationText`, `position` |
| **KbDocument** | Knowledge base document metadata | `id`, `title`, `sourceType`, `isTrustedSource`, `cancerTypes[]`, `tags[]`, `license`, `lastReviewed` |
| **KbChunk** | Document chunks with embeddings | `docId`, `chunkIndex`, `content`, `embedding` (vector(768)) |
| **Feedback** | User feedback (thumbs up/down) | `sessionId`, `messageId`, `rating`, `reason`, `comment` |
| **SafetyEvent** | Safety rule trigger events | `sessionId`, `messageId`, `type`, `detail` |
| **AnalyticsEvent** | General analytics events | `sessionId`, `eventName`, `payload` (JSON) |
| **VoiceInteraction** | Voice I/O metadata | `sessionId`, `sttConfidence`, `transcript`, `audioDurationMs`, latency fields |

### 6.3 Indexes

- `KbDocument`: sourceType, status, language, cancerTypes, tags, isTrustedSource
- `KbChunk`: docId, content (full-text), embedding (pgvector HNSW/IVFFlat)
- `VoiceInteraction`: sessionId, createdAt
- `MessageCitation`: messageId, docId

---

## 7. LLM Service

### 7.1 Multi-Provider Architecture

```typescript
// llm.service.ts — Provider selection
LlmService {
  generateWithCitations(systemPrompt, context, userQuery, options)
  generate(systemPrompt, context, userQuery)
  generateDefinitionalResponse(systemPrompt, context, userQuery)
}
```

| Provider | Use Case | Timeout | Retry Strategy |
|----------|----------|---------|---------------|
| **Gemini** | Primary (production) | 15s | 1 retry with reduced context |
| **DeepSeek** | Fallback / funding bot | 15s | Up to 3 retries with exponential backoff (1s, 2s) |

### 7.2 Timeout & Budget Configuration

| Parameter | Value | Location |
|-----------|-------|----------|
| `LLM_TIMEOUT_MS` | 15000ms (production) | `cloudbuild.yaml` env var |
| `TIME_BUDGET_MS` | 25000ms | `chat.service.ts` (controls regeneration eligibility) |
| Controller request timeout | 55s | `chat.controller.ts` |
| Cloud Run timeout | 300s | `cloudbuild.yaml` deploy args |

### 7.3 Response Generation Pipeline

```
1. Build system prompt (mode-specific + cancer-type-aware)
2. Inject evidence chunks (top-k relevant)
3. Call LLM with timeout
4. Extract citations from response text
5. Validate citations against retrieved chunks
6. If within time budget:
   a. Check identify question rubric → regenerate if failed
   b. Check citation quality → regenerate if RED
7. Inject essential terms if missing
8. Append disclaimer
```

---

## 8. RAG Pipeline

### 8.1 Retrieval Strategy

```
User Query
  │
  ├── Query Decomposition (complex queries → sub-queries)
  │
  ├── Query Expansion
  │   ├── Synonym matching (cancer-specific synonyms)
  │   ├── Cross-lingual expansion (Hindi ↔ English)
  │   └── Cancer type detection (keyword + symptom inference)
  │
  ├── Multi-Retrieve (parallel)
  │   ├── Vector similarity search (pgvector cosine)
  │   ├── Keyword search (text matching)
  │   └── Cross-cancer topic retrieval
  │
  ├── Reranking
  │   ├── Source trust weighting
  │   ├── Recency weighting
  │   └── Relevance scoring
  │
  └── Evidence Gate
      ├── Min passages check
      ├── Min sources check
      ├── Source trust verification
      ├── Recency validation
      └── Pass/Fail decision
```

### 8.2 Evidence Quality Levels

| Level | Definition | Action |
|-------|-----------|--------|
| **Strong** | Multiple passages from multiple trusted sources | Answer with citations |
| **Weak** | Meets minimums but limited | Answer with citations + expansion retrieval |
| **Conflicting** | Sources disagree | Present uncertainty, recommend clinician |
| **Insufficient** | Below thresholds | Abstain — return SafeFallbackResponse |

### 8.3 Source Trust Tiers

All chunks must come from `KbDocument` records with `isTrustedSource: true`. Source types:
- `01_suchi_oncotalks` (SCCF-owned, highest trust)
- `02_nci_core` (NCI/Cancer.gov, high trust)
- `03_who_public_health` (WHO, high trust, 24-month recency)
- `04_iarc_stats` (IARC, medium trust, 60-month recency)
- `05_india_ncg` (NCG India, high trust, 18-month recency)
- `06_pmc_selective` (PMC, medium trust, 36-month recency)
- `99_local_navigation` (local resources, 12-month recency)

---

## 9. Safety Engine

### 9.1 Components

| Component | File | Purpose |
|-----------|------|---------|
| `safety.service.ts` | Main safety orchestrator | Runs all policy rules against user input |
| `safety.rules.ts` | Rule definitions | 20+ regex/pattern rules for detection |
| `safety.templates.ts` | Safe response templates | Pre-written responses for each safety category |
| `emergency-fast-path.ts` | Emergency detection | Severe symptoms → immediate escalation |
| `disclaimer-engine.ts` | Disclaimer management | Appends medical disclaimers |

### 9.2 Safety Classification

| Classification | Trigger | Response |
|---------------|---------|----------|
| `emergency` | Severe symptoms (chest pain, uncontrolled bleeding, difficulty breathing) | "Call 112 or go to nearest emergency room immediately" |
| `self_harm` | Crisis language (suicidal ideation, self-harm) | Crisis resources: Vandrevala Foundation (1860-2662-345), iCall |
| `refusal` | Diagnosis, report interpretation, dosing, treatment choice requests | Polite refusal + referral to healthcare provider |
| `misinformation` | Treatment stopping, unproven remedies | Evidence-based correction with citations |
| `mental_health_support` | Non-crisis emotional distress | Empathetic response + mental health resources |
| `normal` | All other queries | Continue to RAG + LLM pipeline |

---

## 10. Voice Architecture

### 10.1 REST API (`voice.service.ts`)

```
Audio Upload (WAV/WebM/OGG)
  → Google Cloud Speech-to-Text v2 (Chirp model)
  → Transcript text
  → ChatService.handle() (same as text chat)
  → Response text
  → Google Cloud Text-to-Speech (Neural voice)
  → Audio file (MP3)
  → GCS storage (suchi-tts-audio bucket)
  → Signed URL returned to client
```

### 10.2 WebSocket API (`voice-ws.gateway.ts`)

Real-time streaming voice interaction over WebSocket at `/v1/voice-ws`. Supports:
- Streaming audio input → incremental STT
- Text response streaming
- Audio response streaming

### 10.3 Voice Models

| Service | Model | Language |
|---------|-------|---------|
| STT | Google Chirp (v2) | English (en-IN, en-US) |
| TTS | Google Neural Voice | English (en-IN) |

---

## 11. Chat Module — Internal Components

### 11.1 Intent Classification (`intent-classifier.ts`)

Classifies user query into intents using regex patterns:

| Intent | Examples |
|--------|----------|
| `INFORMATIONAL_GENERAL` | "What is breast cancer?", "Tell me about chemotherapy" |
| `INFORMATIONAL_SYMPTOMS` | "What are the symptoms of oral cancer?" |
| `INFORMATIONAL_TREATMENT` | "What are treatment options for prostate cancer?" |
| `INFORMATIONAL_SIDE_EFFECTS` | "What are side effects of chemotherapy?" |
| `PERSONAL_SYMPTOMS` | "I found a lump in my breast" |
| `NAVIGATION` | "Where can I get screened?", "Find an oncologist" |
| `GREETING` | "Hello", "Hi", "Namaste" |
| `FOLLOWUP` | Contextual follow-up to previous message |

### 11.2 Mode Detection (`mode-detector.ts`)

Selects response mode based on intent and context:

| Mode | When | Response Style |
|------|------|---------------|
| `explain` | Informational queries | Full medical info with citations, structured sections |
| `navigate` | Personal symptoms or navigation queries | Provider referral, no medical claims |
| `identify` | Symptom identification | Symptom checklist, when to see doctor |

### 11.3 Greeting Flow (`greeting-flow.service.ts`)

Onboarding sequence for new sessions:

```
Step 0: Not started
Step 1: Ask user context (general inquiry / patient / caregiver / post-diagnosis)
Step 2: Ask cancer type (if applicable)
Step 3: Complete → proceed to normal chat
```

Context extraction uses rule-based patterns (keywords for user type, cancer type, symptom inference). LLM fallback was removed in March 2026 to eliminate hidden latency.

### 11.4 Empathy Detection (`empathy-detector.ts`)

Rule-based emotional tone detection using pattern matching:

| Tone | Pattern Examples |
|------|-----------------|
| `anxious` | "scared", "worried", "afraid", "waiting for results" |
| `urgent` | "just diagnosed", "starting treatment", "need help now" |
| `sad` | "depressed", "hopeless", "why me", "passed away" |
| `calm` | "just asking", "curious", "for a friend", "in general" |
| `neutral` | Default when no patterns match |

Also detects mental health needs (crisis vs. non-crisis) and caregiver patterns.

### 11.5 Cancer Type Detection (`utils/cancer-type-detector.ts`)

Keyword-based detection for 5 priority cancer types:

| Cancer Type | Keywords | Symptom Inference |
|-------------|----------|------------------|
| Breast | "breast" | "lump" + "breast" |
| Cervical | "cervical" | — |
| Oral | "oral", "mouth" | — |
| Colorectal | "colorectal", "colon", "rectal" | "blood/bleeding" + "stool/bowel/rectal" |
| Prostate | "prostate" | — |

**Known limitation:** Uses `includes()` (not word-boundary matching), so "cervical spine" would match "cervical cancer."

### 11.6 Response Templates (`response-templates.ts`)

Pre-built response structures for each mode:
- `explainModeFrame()` — Sections: Overview, Key Points, Warning Signs, Questions for Doctor
- `navigateModeFrame()` — Sections: Next Steps, How to Prepare, Questions to Ask
- `identifyModeFrame()` — Sections: Symptom Checklist, When to See Doctor, Warning Signs

### 11.7 Plan Executor (`plan-executor.service.ts`)

Phase 3 structured response planning. For complex queries, creates an execution plan with retrieval + template steps before generating the response. Falls through to standard explain flow if execution fails.

### 11.8 Output Verifier (`output-verifier.service.ts`)

Post-generation quality checks:
- Citation count validation
- Medical content detection
- Prohibited language detection
- Section completeness

---

## 12. Evaluation Framework

### 12.1 Architecture

```
eval/
  cli.ts                    → Entry point (npx ts-node cli.ts)
  config/
    loader.ts               → Config loading (env vars, secrets)
    secrets-manager.ts      → GCP Secret Manager integration
  runner/
    evaluator.ts            → Main evaluation orchestrator
    deterministic-checker.ts → Rule-based scoring
    llm-judge.ts            → AI-based scoring (Vertex AI / OpenAI / DeepSeek)
    report-generator.ts     → HTML/JSON report generation
    audio-synthesizer.ts    → Voice test audio generation
    voice-evaluator.ts      → Voice-specific evaluation
    voice-api-client.ts     → Voice API client
    voice-report-generator.ts → Voice eval reports
  cases/
    tier1/                  → Cancer-type-specific test cases
    generalinfo/            → Cross-cancer test cases
    voice/                  → Voice I/O test cases
  rubrics/
    rubrics.v1.json         → Text eval rubrics
    voice-rubrics.v1.json   → Voice eval rubrics
  types/
    index.ts                → TypeScript type definitions
    voice.ts                → Voice eval types
  utils/
    canonicalize.ts         → Text normalization utilities
```

### 12.2 Evaluation Flow

```
1. Load test cases from YAML/JSON files
2. For each test case:
   a. Create session via API
   b. Send user message(s) via /v1/chat
   c. Collect response + metadata (citations, chunks, timing)
   d. Run deterministic checks (disclaimer, no-diagnosis language, section presence)
   e. Run LLM judge (medical accuracy, completeness, empathy, citation quality)
   f. Compute weighted score
   g. Compare to pass threshold
3. Generate report (HTML + JSON)
4. Output summary statistics
```

### 12.3 LLM Judge Configuration

- **Providers:** Vertex AI (primary), OpenAI (fallback), DeepSeek (budget)
- **Consensus:** 2/2 agreement required (two judge calls, both must agree)
- **Rubric contract:** JSON output with `pass`, `score`, `checks`, `fail_reasons`

### 12.4 CI/CD Integration

| Pipeline | File | Purpose |
|----------|------|---------|
| `cloudbuild.eval.yaml` | Standalone eval run | Run eval suite against deployed API |
| `cloudbuild.gated.yaml` | Gated deployment | Deploy only if eval pass rate exceeds threshold |

---

## 13. Frontend Architecture

### 13.1 Tech Stack

- **Framework:** React with TypeScript
- **Build Tool:** Vite
- **Styling:** CSS (standard)
- **State:** Component-level + sessionStorage for consent
- **API Communication:** Fetch API to `/v1` endpoints

### 13.2 Key Features

| Feature | Description |
|---------|-------------|
| Consent Gate | GDPR-style consent before first interaction |
| Chat Interface | Message bubbles, auto-scroll, typing indicator |
| Suggested Prompts | Pre-built queries for new users |
| Feedback | Thumbs up/down on each bot response |
| "Start Over" | Reset session, clear chat history |
| Voice Input | Microphone button → audio upload → STT → chat |
| Citation Display | Inline citation markers linked to sources |
| Emergency Banner | Visual alert for emergency/crisis responses |

---

## 14. Infrastructure & Deployment

### 14.1 Cloud Run Services

| Service | Image | Resources | Scaling |
|---------|-------|-----------|---------|
| `suchi-api` | `suchi-api:$BUILD_ID` | 512Mi RAM, 1 CPU | 0-10 instances |
| `suchi-web` | `suchi-web:$BUILD_ID` | 256Mi RAM, 1 CPU | Auto |

### 14.2 Cloud Build Pipelines

| Config File | Purpose | Trigger |
|-------------|---------|---------|
| `cloudbuild.yaml` | Build + deploy API + Web | Main branch push |
| `cloudbuild.eval.yaml` | Run evaluation suite | Manual / scheduled |
| `cloudbuild.gated.yaml` | Eval-gated deployment | Manual |
| `cloudbuild.kb-ingest.yaml` | KB ingestion job | Manual / scheduled |
| `cloudbuild.ingest.yaml` | API-specific ingestion | Manual |
| `cloudbuild.funding.yaml` | Funding bot deployment | Manual |

### 14.3 Docker Configuration

| Dockerfile | Service | Base Image |
|------------|---------|-----------|
| `apps/api/Dockerfile` | API server | Node.js |
| `apps/api/Dockerfile.ingest` | KB ingestion job | Node.js |
| `apps/web/Dockerfile` | Web frontend | Nginx (serves built assets) |
| `apps/funding-api/Dockerfile` | Funding API | Node.js |
| `apps/funding-web/Dockerfile` | Funding Web | Nginx |
| `Dockerfile.kb-ingest` | Root-level KB ingestion | Node.js |

### 14.4 Environment Variables

**Required (secrets):**

| Variable | Secret Manager Key | Description |
|----------|--------------------|-------------|
| `DATABASE_URL` | `database-url` | PostgreSQL connection string |
| `DEEPSEEK_API_KEY` | `deepseek-api-key` | DeepSeek LLM API key |
| `EMBEDDING_API_KEY` | `embedding-api-key` | Gemini embedding API key |
| `ADMIN_BASIC_USER` | `admin-basic-user` | Admin authentication |
| `ADMIN_BASIC_PASS` | `admin-basic-pass` | Admin authentication |
| `SMTP_PASS` | `SMTP_PASS` | Email password for daily reports |

**Configuration (env vars set in cloudbuild.yaml):**

| Variable | Production Value | Description |
|----------|-----------------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `LLM_PROVIDER` | `gemini` | Primary LLM provider |
| `LLM_TIMEOUT_MS` | `15000` | LLM API call timeout (ms) |
| `EMBEDDING_MODEL` | `gemini-embedding-001` | Embedding model |
| `RATE_LIMIT_TTL_SEC` | `60` | Rate limit window |
| `RATE_LIMIT_REQ_PER_TTL` | `20` | Max requests per window |
| `GCS_BUCKET_TTS` | `suchi-tts-audio` | GCS bucket for TTS audio files |
| `DAILY_REPORT_EMAIL` | `gautamgauri@dikshafoundation.org` | Daily report recipient |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server |
| `SMTP_PORT` | `587` | SMTP port |

---

## 15. Performance Characteristics

### 15.1 Latency Budget (per request)

| Stage | Budget | Notes |
|-------|--------|-------|
| Pre-processing (safety, context, emotion) | <50ms | All rule-based, no LLM calls |
| RAG retrieval | 2-5s typical | Vector search + reranking |
| LLM generation (primary) | 5-15s | 15s hard timeout |
| Citation validation | <50ms | String parsing |
| Post-processing (disclaimer, formatting) | <10ms | String operations |
| **Total target** | **<25s** | TIME_BUDGET_MS enforced |

### 15.2 Timeout Hierarchy

```
Cloud Run container: 300s
  └── Controller request: 55s
      └── Chat service TIME_BUDGET_MS: 25s
          └── LLM call timeout: 15s
              └── LLM internal retry: 15s (with reduced context)
```

### 15.3 Performance Optimizations (March 2026)

| Optimization | Before | After | Impact |
|-------------|--------|-------|--------|
| LLM timeout | 45s | 15s | 3x faster timeout for stuck calls |
| TIME_BUDGET_MS | 45s | 25s | Prevents runaway regeneration cycles |
| Context extraction | LLM fallback (2-15s) | Rule-based only (<1ms) | Eliminated hidden LLM call |
| Emotion detection | LLM fallback (2-15s) | Rule-based only (<1ms) | Eliminated hidden LLM call |
| Fallback path | No budget check | 25s budget gate | Prevents unbounded fallback LLM calls |
| Urgent path | No timeout | 15s + template fallback | Bounded worst case |

---

## 16. Testing

### 16.1 Unit Tests

| Area | Pattern | Runner |
|------|---------|--------|
| API modules | `*.spec.ts` alongside source | Jest |
| Key test files | `chat.service.spec.ts`, `safety.service.spec.ts`, `empathy-detector.spec.ts`, `intent-classifier.spec.ts`, `mode-detector.spec.ts`, etc. | Jest |

### 16.2 Commands

```bash
cd apps/api && npx jest                          # Run all tests
cd apps/api && npx jest --testPathPattern=chat    # Run chat tests
cd apps/api && npx jest --coverage               # With coverage
```

### 16.3 Evaluation (Integration Tests)

```bash
cd eval && npx ts-node cli.ts                    # Full eval suite
cd eval && npx ts-node cli.ts --tier=1           # Tier 1 only
cd eval && npx ts-node cli.ts --cancer=breast    # Breast cancer only
```

---

## 17. Monitoring & Observability

### 17.1 Structured Logging

All key decisions are logged with structured JSON:

| Event | When | Key Fields |
|-------|------|------------|
| `evidence_gate_blocked` | Evidence insufficient | reasonCode, queryType, chunkCount |
| `citation_enforcement_failed` | Medical content without citations | citationCount, intent |
| `safety_event` | Safety rule triggered | type, detail |
| `llm_timeout` | LLM call exceeded timeout | provider, timeoutMs |
| `abstention` | Bot chose to abstain | reason, evidenceQuality |

### 17.2 Database Metrics

| Metric | Source | Query |
|--------|--------|-------|
| Response latency | `Message.latencyMs` | Aggregate by time window |
| Citation coverage | `Message.citationCount` | Percentage with count >= 2 |
| Abstention rate | `Message.abstentionReason IS NOT NULL` | Count over total |
| Safety events | `SafetyEvent` table | Count by type |
| User satisfaction | `Feedback.rating` | Positive/negative ratio |

### 17.3 Daily Report

Automated email (via Cloud Scheduler) with:
- Total sessions and messages
- Average latency
- Safety event counts
- Abstention rate
- Feedback summary

---

## 18. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| PII exposure | Anonymous sessions (no login required), no PII stored by default |
| Injection attacks | NestJS validation pipes, parameterized Prisma queries |
| API abuse | Rate limiting (20 req/60s), Cloud Run scaling limits |
| Secret management | All secrets in Google Secret Manager, never in code |
| Medical misinformation | Structural enforcement (evidence gate + citation validation) |
| Admin access | Basic Auth on admin endpoints, restricted to authorized users |
| Voice data | Audio files in GCS with signed URLs (time-limited access) |

---

## 19. Known Limitations & Technical Debt

| Item | Description | Severity | Status |
|------|-------------|----------|--------|
| Cancer type detection uses `includes()` | "cervical spine" matches cervical cancer | Low | Known, not yet fixed |
| No word-boundary matching | Could match substrings incorrectly | Low | Known |
| Symptom inference limited | Only breast (lump) and colorectal (blood+stool) have symptom-based detection | Medium | Planned expansion |
| Redundant greeting flow DB queries | `needsGreetingFlow` and `isGreetingFlowInProgress` called twice | Low | Performance nit |
| Try/catch fallthrough in Phase 3 and answer-first | Failed attempts fall through to full explain flow, adding latency | Medium | Partially mitigated by time budget |
| Single-region deployment | Only us-central1 | Low | Acceptable for current user base |
| No caching layer | Every request hits DB and LLM | Medium | Consider Redis for repeated queries |

---

## 20. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-XX | SCCF | Initial Phase 1 Tech Spec |
| 2.0 | 2026-03-07 | Development Team | Comprehensive rewrite reflecting current production architecture: multi-module API, RAG v2 pipeline, voice I/O, eval framework, performance optimizations, safety layers, deployment infrastructure |

---

*This document supersedes the original `PHASE1_TECH_SPEC.md` as the authoritative technical reference.*
