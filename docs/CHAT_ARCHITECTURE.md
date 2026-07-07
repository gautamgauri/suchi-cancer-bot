# Chat Service Architecture

The core of Suchi is the `ChatService.handle()` method in `apps/api/src/modules/chat/chat.service.ts`. Every user message passes through a fixed sequence of phases. This document describes that sequence, the services involved, and the decisions made at each step.

---

## Request Flow (in order)

```
User message
     │
     ▼
Phase 0 ── Voice Input Cleanup
     │
     ▼
Phase 1 ── Emergency Fast-Path (rule-based, <1ms)
     │         └─ matches? → immediate emergency response, end
     ▼
Phase 2 ── Safety Evaluation (rule-based)
     │         └─ blocked? → safety response, end
     ▼
Phase 2.5 ── Urgency Detection
     │         └─ urgent? → early RAG retrieval + S2 template response, end
     ▼
Phase 3 ── Greeting Detection
     │         └─ greeting? → greeting flow, end
     ▼
Phase 4 ── Agentic Intent Routing
     │         classifies: conversational / knowledge / hospital_search / etc.
     ▼
Phase 5 ── Patient State + Clinical Reasoning
     │         PatientStateService reads session cancer type, emotional state
     ▼
Phase 6 ── RAG Retrieval
     │         QueryDecomposer + CrossLingual → RetrievalTool → EvidenceGate
     ▼
Phase 7 ── LLM Generation
     │         LlmService.generateWithCitations() with structured prompts
     ▼
Phase 8 ── Response Validation + Citation Repair
     │         ResponseValidator + CitationService + ClinicalKeywordEnforcer
     ▼
Phase 9 ── Output Formatting
               ResponseFormatter + disclaimer appended + voice stripping (if voice channel)
```

---

## Phase Descriptions

### Phase 0 — Voice Input Cleanup
**Service:** `cleanVoiceInput()` (inline util)

Web Speech API can produce stuttered/duplicated text ("I I want want to know"). This is cleaned before any downstream processing.

### Phase 1 — Emergency Fast-Path
**Service:** `evaluateEmergencyFastPath()`

Pure regex matching against patterns for cardiac arrest, suicidal ideation, severe acute distress. Zero async calls — runs in under 1ms. Returns a hard-coded emergency response with emergency numbers localised to the session locale (Hindi/English/Bihar).

This phase intentionally runs **before** the database session fetch completes to minimise latency for critical safety cases.

### Phase 2 — Safety Evaluation
**Service:** `SafetyService.evaluate()`

Rule-based classifier covering:
- Misinformation patterns ("stop chemotherapy", "cure with herbs")
- Self-harm language
- Off-topic requests (political, financial, unrelated medical)

Classifications: `normal`, `refusal`, `red_flag`, `self_harm`. Anything other than `normal` returns a safety response and ends the request. Events are persisted to `safetyEvent` table.

### Phase 2.5 — Urgency Detection
**Service:** `AbstentionService.hasUrgencyIndicators()` + early RAG

Detects symptom descriptions that suggest active medical need ("I have severe pain", "difficulty breathing"). If detected:
1. Fetches RAG chunks immediately (6 chunks, hard 15s LLM deadline)
2. Uses S2 template (urgent symptom template) as the base response
3. If RAG + LLM succeeds within the deadline, prepends the LLM response with citations
4. Falls back to template-only if LLM times out

### Phase 3 — Greeting Detection
**Service:** `GreetingDetector`, `GreetingFlowService`

Handles "hi", "hello", first-message onboarding, and "what can you help me with?" queries. Returns the greeting menu or a contextual first-message flow without invoking RAG or LLM.

### Phase 4 — Agentic Intent Routing
**Service:** `classifyAgenticIntent()`, `IntentClassifier`

Classifies the query into one of:
- `conversational` — small talk, non-medical
- `knowledge` — cancer information question (majority of queries)
- `hospital_search` — "find a cancer hospital in Bihar"
- `explain` — "explain this term / what does X mean"
- `identify` — "how do I identify / what are the signs of"

The `knowledge` path enters the full RAG + LLM pipeline. `hospital_search` routes to `ExecutionPlannerService` → `PlanExecutorService` → `OutputVerifierService` (Phase 3 agentic stack).

### Phase 5 — Patient State + Clinical Reasoning
**Service:** `PatientStateService`, `ClinicalKeywordEnforcerService`

`PatientStateService` reads the session's `cancerType`, `emotionalState`, and `userContext` (patient / caregiver / general). This state informs:
- Which RAG filters are applied (cancer-type-specific chunks prioritised)
- Which prompt templates are used
- Tone adjustments in the LLM prompt

`ClinicalKeywordEnforcer` post-processes LLM output to ensure clinical accuracy requirements are met (e.g. "always mention doctor consultation for symptom queries").

### Phase 6 — RAG Retrieval
**Services:** `QueryDecomposerService`, `CrossLingualService`, `RetrievalToolService`, `RagService`, `EvidenceGateService`

1. **Query decomposition** — complex multi-part questions are split into sub-queries
2. **Cross-lingual expansion** — Hindi/Hinglish queries are expanded to English equivalents
3. **Retrieval** — pgvector semantic search against the KB (`RagService.retrieveWithMetadata()`)
4. **Evidence gate** — filters chunks below confidence threshold, deduplicates, caps at max chunks per response

### Phase 7 — LLM Generation
**Service:** `LlmService.generateWithCitations()`

Constructs a structured prompt with:
- System role (cancer information educator)
- Identify/explain requirements (structured checklists for specific intent types)
- RAG chunks as reference material
- Patient state context
- Citation instructions

Calls Gemini via `@google/generative-ai` (Google AI API). 45s request budget with a 15s deadline for the urgent path. On timeout or failure: falls back to abstention response via `AbstentionService`.

### Phase 8 — Response Validation + Citation Repair
**Services:** `ResponseValidatorService`, `CitationService`, `ClinicalKeywordEnforcerService`

1. **Citation extraction** — parses `[1]`, `[2]` markers from LLM output and maps them to source chunks
2. **Citation repair** — if fewer than 2 citations were generated but RAG chunks are available, deterministically attaches citations from the top-ranked chunks
3. **Response deduplication** — `deduplicateResponse()` removes duplicate sections the LLM may have generated
4. **Clinical keyword enforcement** — ensures required safety language is present for medical queries
5. **Response validation** — checks length, format, and content policy compliance

### Phase 9 — Output Formatting
**Services:** `ResponseFormatter`, `appendDisclaimer()`, `stripForVoice()`

1. **Disclaimer** — appended to all medical responses; emergency-specific language if `isEmergency`
2. **Voice stripping** — if channel is `voice` or `voice-ws`, markdown syntax (headers, bullets, citation markers) is stripped so the text reads naturally when spoken by TTS
3. **Formatter** — applies final structure, truncation, and field assembly for the response object

---

## Key Constraints

| Constraint | Value | Reason |
|---|---|---|
| Request budget | 45s total | Cloud Run request timeout is 55s |
| Min LLM budget | 15s | Prevents stacking multiple LLM calls near deadline |
| Urgent path LLM deadline | 15s hard | Fast fallback to template if LLM is slow |
| RAG chunks (normal) | Up to 6 | Balances context richness vs. prompt length |
| RAG chunks (urgent early) | 6 | Lower cap; time is critical |
| Session cache TTL | 60s | Avoids repeated DB round-trips within a conversation turn |

---

## Services Map

| Service | Location | Role |
|---|---|---|
| `ChatService` | `chat/chat.service.ts` | Orchestrator — the only entry point |
| `SafetyService` | `safety/safety.service.ts` | Rule-based safety classification |
| `AbstentionService` | `abstention/abstention.service.ts` | Urgency detection + fallback responses |
| `RagService` | `rag/rag.service.ts` | pgvector semantic search |
| `EvidenceGateService` | `evidence/evidence-gate.service.ts` | Chunk filtering and confidence thresholds |
| `LlmService` | `llm/llm.service.ts` | Gemini API calls (Google AI API) |
| `CitationService` | `citations/citation.service.ts` | Citation extraction and repair |
| `PatientStateService` | `chat/patient-state.service.ts` | Session state (cancer type, context) |
| `QueryDecomposerService` | `rag/query-decomposer.service.ts` | Multi-part query splitting |
| `CrossLingualService` | `rag/cross-lingual.service.ts` | Hindi/Hinglish → English expansion |
| `GreetingFlowService` | `chat/greeting-flow.service.ts` | First-message and greeting handling |
| `ExecutionPlannerService` | `chat/execution-planner.service.ts` | Hospital search planning |
| `ObservabilityService` | `observability/observability.service.ts` | Langfuse tracing for every phase |

---

## What the LLM Is and Is Not Responsible For

**LLM is responsible for:**
- Generating natural language from RAG chunks
- Selecting which chunks to cite (via `[1]` markers)
- Tone and structure of the response

**LLM is NOT responsible for:**
- Safety classification (rule-based, pre-LLM)
- Emergency detection (regex, pre-LLM)
- Citation accuracy (citation repair adds deterministic citations if LLM under-cites)
- Medical fact-checking (all facts must come from KB chunks — LLM cannot invent)

This separation means a Gemini API failure does not create a safety gap — the safety and emergency layers run before the LLM is ever called.
