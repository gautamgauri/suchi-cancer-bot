# Suchi Architecture

System-level map of the Suchi Cancer Bot: modules, data flows, deployment
surfaces, and external dependencies. Written as part of the reliability
handoff pack (issue #46). Every non-obvious claim cites a source file.

Related docs (canonical, not duplicated here): `docs/CHAT_ARCHITECTURE.md`
(chat pipeline deep-dive), `docs/REQUIREMENTS.md` (what the system must do),
`docs/SUCHI_SAFETY_CONTRACT.md` / `docs/SUCHI_ANSWER_POLICY.md` (clinical
policy), `docs/NAVIGATOR_PIPELINE.md`, `docs/DISTRIBUTION_PIPELINE_SPEC.md`,
`docs/VECTOR_RAG_SETUP.md`.

## 1. Top-level layout

| Path | What it is |
|---|---|
| `apps/api/` | NestJS backend — the main codebase (service name `suchi-api`, `apps/api/package.json`) |
| `apps/web/` | React + Vite chat UI, served by nginx on Cloud Run (`apps/web/Dockerfile`, `apps/web/nginx.conf`) |
| `apps/landing/` | Astro static marketing site, deployed to GitHub Pages (`.github/workflows/deploy-landing.yml`) |
| `eval/` | Evaluation framework: cases, runner, rubrics, autoresearch (`eval/cli.ts`) |
| `evals/` | Separate, older eval datasets/runners (distinct from `eval/`) |
| `kb/` | Knowledge base markdown + manifest, ingested into Postgres |
| `content/`, `distribution/` | Article-drafting and social-distribution pipeline code + queue data |
| `navigator/` | Hospital-directory research/approval tooling (Cloud Run Jobs) |
| `repairable/` | Manifest of KB articles patched by autoresearch |
| `scripts/` | Python ingestion pipelines (NCI, YouTube transcripts) |
| `docs/` | Specs, policies, runbooks |

## 2. API bootstrap

`apps/api/src/main.ts`:

- Global route prefix `v1` (`app.setGlobalPrefix("v1")`, line 12). Controllers
  therefore declare **bare** paths; doubling the prefix caused the bugs fixed
  in PRs #44 and #45 (commits `a029286`, `e902ae1`).
- Port from `PORT` env (3001 locally, 8080 in the container).
- CORS enabled, Helmet headers, global `ValidationPipe`
  (whitelist + forbidNonWhitelisted + transform).
- Raw request body preserved for WhatsApp webhook HMAC verification.
- Optional Socket.io adapter for `/v1/voice/stream` when `VOICE_WS_ENABLED=true`.
- Startup logs include latest DB migration name, build ID, and a DB target
  fingerprint (operational sanity check for "which build am I talking to").

`apps/api/src/app.module.ts` wires ~20 feature modules plus `ConfigModule`
(env validation via `apps/api/src/config/env.validation.ts`) and
`ThrottlerModule` (default 20 req / 60 s, tunable via `RATE_LIMIT_TTL_SEC`,
`RATE_LIMIT_REQ_PER_TTL`). `VoiceWsModule` is imported conditionally on
`VOICE_WS_ENABLED`.

## 3. Modules

HTTP-facing modules (controller path shown is under the global `/v1` prefix):

| Module | Route | Purpose |
|---|---|---|
| `chat` | `POST /v1/chat` | Core conversational pipeline (see §4). 55 s controller timeout. |
| `sessions` | `POST /v1/sessions`, `GET /v1/sessions/:id` | Session creation with locale/channel/greeting state and IP-based city-level geolocation. |
| `feedback` | `POST /v1/feedback` | Thumbs up/down + comment on messages. |
| `voice` | `POST /v1/voice/respond`, `POST /v1/voice/tts` | STT upload → chat → TTS; audio limits enforced. |
| `voice-ws` | WS `/v1/voice/stream` | Streaming voice via Socket.io gateway (`voice-ws.gateway.ts`), optional. |
| `health` | `GET /v1/health` | Deep health check: runs `SELECT 1` against Postgres and reports `database: connected|disconnected` (`src/modules/health/health.service.ts`). Used by deploy health gates. |
| `admin` | `/v1/admin/*` | Conversations, metrics, KB stats, daily report, hospital + article research triggers, navigator review portal, content/social approve-reject links, housekeeping (retention, draft expiry), review queue, analytics. Mixed auth (see §6). |
| `youtube` | `/v1/admin/youtube/*` | YouTube transcript ingestion into the KB (BasicAuth). |
| `distribution` | `GET /v1/distribution/approve/:slug`, `/reject/:slug` | One-click HMAC-tokenized approval links for social content packs (added in PR #43, prefix fixed in PR #44). |
| `review` | `/v1/review/*` | Review Copilot records, queue, policies, metrics (BasicAuth). |
| `copilot` | `/v1/copilot/sessions/*` | Review Copilot session workflow: diagnose → plan → approve → execute → compare. |
| `whatsapp` | `GET/POST /v1/whatsapp/webhook` | Meta WhatsApp Cloud API webhook: verify challenge, HMAC-SHA256 signature check, async message processing (`whatsapp.service.ts`). |
| `whatsapp-navigator` | `POST /v1/whatsapp-navigator/webhook` | Hospital-directory flow over WhatsApp text; in-memory sessions with 30-min TTL (prefix fixed in PR #45). |

Service-only modules (no controller; consumed by the pipeline):

| Module | Purpose |
|---|---|
| `safety` | Rule-based classification: emergency, self-harm, stop-treatment, alternative-only, report-interpretation, treatment-choice, prognosis, dosage, diagnosis. Priority-ordered in `safety.service.ts`; Devanagari-safe matching (see `hindi-safety-regression.spec.ts`). |
| `abstention` | Urgency indicators + Safe-but-Helpful abstention templates when evidence is insufficient. |
| `rag` | Hybrid retrieval: pgvector similarity + Postgres FTS, multi-query expansion, reranking, cross-lingual and cross-cancer-topic handling. Entry: `RagService.retrieveWithMetadata()`. |
| `embeddings` | Google Embeddings REST API (768-dim vectors) for both ingestion and query time. |
| `evidence` | Evidence gate: hybrid score threshold or trusted-top-3 rule, trust-first filtering, recency checks. Entry: `evaluateEvidenceGate()`; reason codes `NO_RESULTS/LOW_TRUST/LOW_SCORE/RECENCY_FAIL/LOW_DIVERSITY`. |
| `llm` | Multi-provider LLM wrapper (`llm.service.ts`): Gemini (default, via API key or Vertex ADC), OpenAI and DeepSeek plumbing retained as legacy fallback — production is 100% Gemini (`LLM_PROVIDER=gemini` in `cloudbuild.yaml`). `generateWithCitations()` embeds `[citation:docId:chunkId]` markers; `generateRaw()` used by content/social generation. |
| `citations` | Extraction, validation against retrieved chunks, and repair of citation markers. |
| `analytics` | Event emission (`chat_turn_submitted`, `safety_triggered`, `emergency_fast_path_triggered`, …) + daily report generation. |
| `observability` | Optional Langfuse traces/spans/generations (`LANGFUSE_ENABLED`). |
| `email` | Nodemailer SMTP transport for reports and approval emails. |
| `prisma` | Prisma client wrapper (Postgres + pgvector). |

## 4. Chat request flow (the safety-critical path)

Implemented in `apps/api/src/modules/chat/chat.service.ts` (`handle()`), with a
45 s request budget inside the 55 s controller timeout. Order matters and must
not be changed without medical review:

1. **Input cleanup** — `cleanVoiceInput()` strips Web-Speech stutter.
2. **Emergency fast path** — `evaluateEmergencyFastPath()`: regex-based,
   sub-millisecond, returns an escalation response immediately and logs a
   `SafetyEvent`. Never reaches the LLM.
3. **Safety classification** — `SafetyService.evaluate()` over normalized text
   (`normalizeForMatch()`), producing `normal | amber_flag | red_flag` +
   fired rules.
4. **Urgency detection** — `AbstentionService.hasUrgencyIndicators()`; urgent
   but non-emergency queries get a template response with optional
   RAG enhancement under a hard deadline.
5. **Greeting flow** — `GreetingFlowService.processGreeting()` +
   `detectCancerType()` for first-message context.
6. **RAG retrieval** — `RagService.retrieveWithMetadata()` (hybrid vector+FTS,
   query expansion, rerank).
7. **Evidence gate** — `EvidenceGateService.evaluateEvidenceGate()`; on
   `insufficient` the pipeline **abstains** (step 8) rather than generating.
8. **Abstention** — `AbstentionService.generateAbstentionMessage()` renders a
   safe fallback with escalation guidance.
9. **LLM generation** — `LlmService.generateWithCitations()` with mode
   detection and cancer-type-aware template selection, under the remaining
   deadline budget (`llmWithDeadline()`).
10. **Citation extraction/repair** — `CitationService`; citations must resolve
    to retrieved chunks.
11. **Response validation** — `ResponseValidatorService.validate()` (hallucinated
    citations, guardrails), then `ClinicalKeywordEnforcerService.enforce()`.
12. **Formatting** — `ResponseFormatter.format()`; citation markers are
    stripped from user-visible text (citations are for auditors, not users —
    OD-003 in `docs/OPEN_DECISIONS.md`); `stripForVoice()` for voice output.
13. **Persistence** — `Message` rows store `safetyClassification`,
    `policyRulesFired`, `kbDocIds`, `latencyMs`, `evidenceQuality`,
    `citationCount`, `abstentionReason`.
14. **Analytics emission** — non-blocking.

Invariants: safety runs **before** retrieval and generation; insufficient
evidence produces abstention, never a fluent guess; emergencies bypass the LLM
entirely.

## 5. Data model

`apps/api/prisma/schema.prisma` (PostgreSQL + pgvector; 9 migrations in
`apps/api/prisma/migrations/`):

| Model | Purpose |
|---|---|
| `Session` | Locale, channel, cancer type, greeting state, geolocation, `isEval` marker, review flag. |
| `Message` | User/assistant turns with safety + evidence + citation metadata. |
| `Feedback` | Reactions and comments. |
| `SafetyEvent` | Safety gate triggers per session/message. |
| `AnalyticsEvent` | Generic event stream. |
| `KbDocument` / `KbChunk` | KB docs and chunks; `KbChunk.embedding` is `vector(768)` (pgvector) plus FTS column (migration `20260120163141_add_fts_to_kbchunk`). |
| `MessageCitation` | Extracted citation markers per assistant message. |
| `VoiceInteraction` | STT confidence, transcript, durations, TTS URL (migration `20260217000000_add_voice_interaction`). |
| `WhatsAppContact` | Persistent phone→session mapping (migration `20260622000000_add_whatsapp_contact`). |
| `ReviewRecord` / `ReviewPolicy` | Review Copilot verdicts and policy definitions (migration `20260606000000_phase2_user_role_review_kb_metadata`). |

## 6. AuthN/AuthZ surfaces

- **HTTP Basic** — `apps/api/src/common/guards/basic-auth.guard.ts`
  (`ADMIN_BASIC_USER`/`ADMIN_BASIC_PASS` secrets) on `/v1/admin`,
  `/v1/admin/youtube`, `/v1/review`.
- **Cloud Scheduler OIDC** — `apps/api/src/common/guards/scheduler-oidc.guard.ts`
  verifies Google-issued ID tokens (audience `SCHEDULER_OIDC_AUDIENCE`, caller
  `SCHEDULER_SA_EMAIL`) on scheduled POSTs: daily report, article/hospital
  research, notify-publish, housekeeping, review-queue digest.
- **HMAC one-click links** — approval/reject URLs carry
  HMAC-SHA256 tokens derived from `NAVIGATOR_APPROVAL_SECRET`,
  `CONTENT_APPROVAL_SECRET`, `SOCIAL_APPROVAL_SECRET`,
  `DISTRIBUTION_APPROVAL_SECRET` (Secret Manager names; never values).
- **WhatsApp webhook** — Meta `X-Hub-Signature-256` HMAC with `META_APP_SECRET`
  plus verify-token challenge (`whatsapp.service.ts`).
- Public, unauthenticated: chat, sessions, feedback, voice, health
  (rate-limited by the global throttler).

## 7. External dependencies

| Dependency | Used by | Source |
|---|---|---|
| Google Gemini (LLM) | chat, content/social generation, autoresearch | `apps/api/src/modules/llm/llm.service.ts` |
| Google Embeddings API (768-dim) | RAG + KB ingestion | `apps/api/src/modules/embeddings/embeddings.service.ts` |
| Google Cloud Speech-to-Text v2 | voice | `apps/api/src/modules/voice/providers/google-stt-v2.provider.ts` |
| Google Cloud TTS (Chirp3-HD) | voice | `apps/api/src/modules/voice/providers/google-tts.provider.ts` |
| Google Cloud Storage | TTS audio (`GCS_BUCKET_TTS`), pipeline queues (`QUEUE_GCS_BUCKET=suchi-navigator-state`), public assets (`suchi-public-assets`) | `apps/api/src/modules/voice/services/gcs-storage.service.ts`, `cloudbuild.yaml` |
| Meta WhatsApp Cloud API | whatsapp module (graph.facebook.com v21.0) | `apps/api/src/modules/whatsapp/whatsapp.service.ts` |
| Meta Facebook/Instagram Graph API | social publishing | `apps/api/src/modules/admin/social-post.service.ts` |
| LinkedIn UGC API | social publishing (currently disabled; token expiry tracked in issue #27) | `apps/api/src/modules/admin/social-post.service.ts` |
| SMTP (Gmail) via nodemailer | reports, approval emails | `apps/api/src/modules/email/email.service.ts` |
| Langfuse | optional LLM observability | `apps/api/src/modules/observability/observability.service.ts` |
| Anthropic Claude API | navigator hospital research job only (not the chat runtime) | `Dockerfile.navigator-research`, `cloudbuild.navigator-research.yaml` |
| OpenAI / DeepSeek | legacy LLM fallback plumbing; also eval-judge options | `llm.service.ts`, `eval/config/loader.ts` |

Environment variables for all of the above are declared (required vs optional)
in `apps/api/src/config/env.validation.ts`; see also
`docs/ENVIRONMENT_VARIABLES.md`.

## 8. Deployment surfaces

GCP project `gen-lang-client-0202543132`, region `us-central1`. Full
operational detail in `docs/OPERATIONS_RUNBOOK.md`; pipeline internals in
`docs/DEPLOYMENT.md` and `docs/GATED_DEPLOYMENT.md`.

| Surface | Kind | Deployed by |
|---|---|---|
| `suchi-api` | Cloud Run service (Node 20 image, port 8080) | `cloudbuild.yaml` (active), `cloudbuild.gated.yaml` (gated: migration job + health gate + traffic promotion), `.github/workflows/deploy-api.yml` (auto on push to `main` touching `apps/api/**` or `kb/**`) |
| `suchi-web` | Cloud Run service (nginx serving Vite build; API URL baked in via `VITE_API_URL` build arg) | `cloudbuild.yaml`, `.github/workflows/deploy-web.yml` |
| Landing site | GitHub Pages (Astro) | `.github/workflows/deploy-landing.yml` |
| `suchi-db-migrate` / `suchi-migrate` | Cloud Run Jobs running `prisma migrate deploy` | `cloudbuild.gated.yaml` / `deploy-api.yml` respectively |
| `suchi-kb-ingest` | Cloud Run Job image (KB ingestion, `Dockerfile.kb-ingest`) | `cloudbuild.kb-ingest.yaml` |
| `suchi-navigator-research`, `suchi-navigator-sender` | Cloud Run Jobs (hospital research via Claude API; daily sender) | `cloudbuild.navigator-research.yaml` |
| Autoresearch loop | Cloud Build run producing `autoresearch/*` proposal branches (never auto-merged) | `cloudbuild-autoresearch.yaml` |
| Database | Cloud SQL Postgres `suchi-db` with pgvector | connection `gen-lang-client-0202543132:us-central1:suchi-db` |

**Critical property:** every deploy path uses `--set-env-vars` /
`--set-secrets`, which **replace** the entire Cloud Run env/secret
configuration. Any env var not listed in the pipeline file is dropped on the
next deploy. `cloudbuild.yaml` and `cloudbuild.gated.yaml` are currently in
sync (verified byte-identical env/secret lists, `cloudbuild.yaml:90-93` vs
`cloudbuild.gated.yaml:107-110`); `.github/workflows/deploy-api.yml` is **not**
in sync — see P0-1 in `docs/RELIABILITY_BACKLOG.md`.

## 9. Evaluation & quality engine

- `eval/cli.ts` — commands: `run`, `voice-e2e`, `report`, `voice-transcript`,
  `release-gate`, `judge-compare`, `loop`, `eval-optimize`, `autoresearch`,
  `generate-cases`.
- Cases in `eval/cases/` (gold, tier1, tier1.5, tier2, voice, generalinfo);
  Tier1 retrieval-quality suite is `eval/cases/tier1/retrieval_quality.yaml`,
  run via `npm run eval:tier1` (`eval/package.json`).
- Runner in `eval/runner/` (`evaluator.ts`, `api-client.ts`, `llm-judge.ts`,
  `deterministic-checker.ts`, `release-gate.ts`, voice evaluators); rubrics in
  `eval/rubrics/rubrics.v1.json` and `voice-rubrics.v1.json`.
- Judge LLM provider resolved in `eval/config/loader.ts` (line 57):
  `EVAL_LLM_PROVIDER` env → secret → config default (`vertex_ai` in
  `eval/config/default.json`); the CI workflow instead defaults to `deepseek`
  (`.github/workflows/eval-tier1.yml:69`).
- Autoresearch engine in `eval/autoresearch/` (`autoresearch-runner.ts`,
  `failure-miner.ts`, `patcher.ts`, `gatekeeper.ts`, `archivist.ts`,
  `triage-router.ts`, agents) — nightly Cloud Build proposal loop.
- Eval targets the live API by default
  (`EVAL_API_BASE_URL`, default in `eval/config/default.json`); eval sessions
  are flagged via `Session.isEval` (migration
  `20260131000000_add_is_eval_to_session`).
