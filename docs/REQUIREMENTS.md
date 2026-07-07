# Suchi Requirements Specification

**Version:** 2.1  
**Date:** 2026-06-22  
**Status:** Active — Phase 1 implemented; Phase 2 planned; §16 (WhatsApp conversational channel) planned

This is the canonical requirements document for the Suchi Cancer Bot. Every subsequent feature, bug fix, or architectural change should be traceable to an entry here. Cross-referenced by `REQUIREMENTS_TRACEABILITY_MATRIX.md`.

Open implementation questions are logged in `OPEN_DECISIONS.md`.

**Phase 1** (§1–14): Requirements implemented or in progress as of Jun 2026.  
**Phase 2** (§15): Requirements derived from `REQUIREMENTS_ANNEXURE_1.md` — governance, user roles, KB metadata, analytics, learning loop. Not yet implemented.

---

## Table of Contents

1. [Product Scope](#1-product-scope)
2. [Actors and User Roles](#2-actors-and-user-roles)
3. [Functional Requirements — Chat](#3-functional-requirements--chat)
4. [Functional Requirements — Voice](#4-functional-requirements--voice)
5. [Functional Requirements — Content Pipeline](#5-functional-requirements--content-pipeline)
6. [Functional Requirements — Hospital Directory](#6-functional-requirements--hospital-directory)
7. [Functional Requirements — Social Publishing](#7-functional-requirements--social-publishing)
8. [Admin and Review Requirements](#8-admin-and-review-requirements)
9. [Safety Requirements](#9-safety-requirements)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Data and Audit Requirements](#11-data-and-audit-requirements)
12. [Acceptance Criteria](#12-acceptance-criteria)
13. [Out of Scope](#13-out-of-scope)
14. [Open Decisions](#14-open-decisions)
15. [Phase 2 Requirements](#15-phase-2-requirements)
16. [Functional Requirements — WhatsApp Conversational Channel](#16-functional-requirements--whatsapp-conversational-channel)

---

## 1. Product Scope

Suchi is a cancer information assistant operated by the Suchitra Cancer Care Foundation (SCCF). It helps patients, caregivers, and health workers in Bihar and India understand cancer — treatments, side effects, navigation, and government schemes — in Hindi, English, and Hinglish.

**Suchi is an information tool, not a clinical tool.** It answers based on a curated knowledge base. It cannot diagnose, prescribe, interpret test reports, or provide individual treatment recommendations.

### 1.1 Delivery Channels

| Channel | Endpoint | Status |
|---|---|---|
| Web chat | `POST /v1/chat` | Active |
| Voice (REST) | `POST /v1/voice/query` | Active |
| Voice (WebSocket) | `WS /v1/voice-ws` | Opt-in (`VOICE_WS_ENABLED`) |
| WhatsApp (Navigator) | Hospital-navigator state machine at `/v1/whatsapp-navigator/webhook` — custom JSON endpoint (`{phone, message}`), **not** a Meta webhook (no `hub.challenge` handshake, no `X-Hub-Signature-256`, no WABA creds) | Dormant (legacy) — no inbound traffic; superseded by §16 |
| WhatsApp (Conversational) | Full chat pipeline via Meta Cloud API (`/v1/whatsapp/webhook`) — see §16 | Planned |

### 1.2 Languages

| Language | Input | Output |
|---|---|---|
| English | Text + voice | Text + voice |
| Hindi | Text + voice | Text + voice |
| Hinglish | Text | Text |

---

## 2. Actors and User Roles

| Actor | Description | Primary Actions |
|---|---|---|
| **End User** | Patient, caregiver, or health worker | Ask questions via chat or voice |
| **Content Reviewer** | SCCF team member (Gautam, Divya, Nisha) | Approve/reject articles and social posts via email |
| **Hospital Reviewer** | SCCF team member | Approve hospital entries via web portal |
| **Admin** | System operator | Trigger article generation, social post generation, hospital research |
| **Deployer** | Developer (Gautam) | Deploy via Cloud Build; run content publish CLI |

---

## 3. Functional Requirements — Chat

### 3.1 Request Processing

**FR-CHAT-001** Every user message MUST pass through the fixed agentic pipeline phases (Phases 0 to 3) in `ChatService.handle()`. No phase may be skipped except by its own exit condition.

**FR-CHAT-003** Emergency queries (cardiac arrest, suicidal ideation, severe acute distress) MUST return a response in under 1 second via the rule-based fast path. No async calls may precede this check.

**FR-CHAT-004** If the LLM call times out or fails, the system MUST fall back to a template-based abstention response. The user MUST receive a safe response regardless of LLM availability.

### 3.2 Safety Gate

**FR-CHAT-005** The safety gate MUST run before RAG retrieval and LLM generation. The safety classification values and their effects are:

| Classification | Meaning | Effect |
|---|---|---|
| `allow` | Normal request | Pipeline continues |
| `safe_redirect` | Misinformation risk or off-topic; safe to redirect | Terminates request; returns redirect response |
| `hard_refusal` | Harmful, abusive, or clearly unsafe content | Terminates request; returns refusal response |
| `emergency_fast_path` | Acute medical crisis | Handled by Phase 1 before this gate runs |

Both `safe_redirect` and `hard_refusal` MUST terminate the request without calling the LLM.

> **Note on current code:** The codebase uses `yellow_flag` and `red_flag` as the classification values. These map to `safe_redirect` and `hard_refusal` respectively. The code labels should be updated to match this terminology in a future refactor.

**FR-CHAT-006** Safety events MUST be persisted to the `safetyEvent` table for audit purposes.

**FR-CHAT-007** The system MUST auto-refuse the following query types without consulting the knowledge base:
- Diagnosis requests ("Do I have cancer?")
- Report/scan interpretation
- Individual treatment recommendation ("Which chemo should I take?")
- Prescription dosing

### 3.3 Knowledge Base Grounding

**FR-CHAT-008** Every medical claim in a chat response MUST be grounded in a KB chunk. The LLM MUST NOT generate medical facts from parametric memory.

**FR-CHAT-009** Responses MUST meet the minimum evidence thresholds defined in `SUCHI_SAFETY_CONTRACT.md` before being returned to the user:

| Query Type | Min Passages | Min Sources |
|---|---|---|
| Treatment | 2 | 2 |
| Side effects | 2 | 1 |
| Prevention | 1 | 1 |
| Screening | 2 | 1 |
| Caregiver / Navigation / General | 1 | 1 |

**FR-CHAT-010** If evidence thresholds are not met, the system MUST return an abstention response with safe next steps (consult doctor, helpline).

**FR-CHAT-011** Only KB documents with `isTrustedSource: true` from the approved source list may be used to ground responses.

### 3.4 Citations

**FR-CHAT-012** LLM responses MUST include `[1]`, `[2]` citation markers. If fewer than 2 citations are generated but RAG chunks are available, citation repair MUST deterministically attach citations from the top-ranked chunks.

**FR-CHAT-013** Citation markers in chat responses are consumed by the frontend and rendered as a collapsible sources section. They MUST NOT appear inline in the displayed prose. (See OD-003.)

**FR-CHAT-014** Voice channel responses MUST have all citation markers stripped before TTS. Spoken output must be natural prose.

### 3.5 Session and Context

**FR-CHAT-015** The session MUST store `cancerType`, `emotionalState`, and `userContext` (patient / caregiver / general). These fields MUST inform RAG filtering and prompt template selection.

**FR-CHAT-016** Session cache TTL is 60 seconds. Repeated requests within a session MUST NOT trigger redundant database round-trips.

### 3.6 Intent Routing

The system uses **two independent classification layers**. These are not the same taxonomy and MUST NOT be conflated.

| Layer | Where used | Allowed values | Purpose |
|---|---|---|---|
| **Product intent layer** (agentic router) | `agentic-intent-router.ts` | `EMERGENCY`, `NAVIGATION`, `SCHEMES`, `PSYCHOSOCIAL`, `ADMIN`, `EDUCATION` | Routes to the correct response template and prompt style |
| **Query execution layer** (intent classifier) | `IntentClassifier` → `ChatService` | `knowledge`, `hospital_search`, `explain`, `identify`, `conversational` | Selects the execution pipeline (RAG vs planner vs greeting) |

**FR-CHAT-017** Queries MUST be classified by the agentic router into one of: `EMERGENCY`, `NAVIGATION`, `SCHEMES`, `PSYCHOSOCIAL`, `ADMIN`, `EDUCATION`. Classification uses a two-stage process: regex fast path first, then `IntentClassifier` mapping.

**FR-CHAT-018** `hospital_search` queries (query execution layer) MUST route to the `ExecutionPlannerService` → `PlanExecutorService` → `OutputVerifierService` stack, not the standard RAG pipeline.

**FR-CHAT-019** The bare word "therapy" MUST NOT be sufficient to classify a query as PSYCHOSOCIAL. A mental-health qualifier (talk therapy, grief therapy, CBT, etc.) is required.

### 3.7 Multilingual

**FR-CHAT-020** Hindi and Hinglish queries MUST be expanded to English equivalents before pgvector retrieval (`CrossLingualService`). Responses MUST be delivered in the language of the query.

---

## 4. Functional Requirements — Voice

**FR-VOICE-001** Audio input MUST be accepted as multipart/form-data. Maximum accepted file size: 2 MB. Maximum accepted duration: 60 seconds.

**FR-VOICE-002** STT MUST use Google Cloud Speech-to-Text v2 with phrase adaptation enabled (`STT_VERSION=v2`). Default language: `hi-IN`. Minimum confidence threshold: 0.6.

**FR-VOICE-003** Transcribed text MUST pass through the same agentic chat pipeline (Phases 0 to 3) as text input.

**FR-VOICE-004** TTS MUST strip markdown headers, bullet points, and citation markers before synthesis. Output must read as natural speech.

**FR-VOICE-005** TTS audio MUST be stored in GCS (`GCS_BUCKET_TTS`) and returned as a signed URL with a 60-minute expiry.

**FR-VOICE-006** Voice input that contains stuttered or repeated words (common with Web Speech API) MUST be cleaned before processing.

---

## 5. Functional Requirements — Content Pipeline

The content pipeline produces treatment-information articles published on the Suchi website (`suchicancercare.org`).

### 5.1 Article Generation

**FR-CONTENT-001** Articles MUST be generated by an AI using the structure defined in `docs/CONTENT_GUIDE.md` (7-section template). `CONTENT_PAGE_SCHEMA.md` is the legacy schema and should be treated as superseded pending formal resolution of OD-005. Until OD-005 is marked resolved, this requirement is **provisional**.

**FR-CONTENT-002** Generated articles MUST be stored as markdown files in `content/drafts/` with YAML frontmatter including: `title`, `slug`, `review_status`, `created_at`, `cancer_type`, `language`.

**FR-CONTENT-003** Generated articles MUST be added to `content-queue.json` on GCS with `status: "pending"`.

### 5.2 Review Flow

**FR-CONTENT-004** Article review MUST be triggered by email. The email MUST include the full article text, an Approve link, and a Reject link.

**FR-CONTENT-005** Approval MUST be a one-click action from the email (HMAC-signed link). No login required.

**FR-CONTENT-006** Clicking Approve MUST update `content-queue.json` on GCS: `status: "approved"`, `approvedAt: <ISO timestamp>`.

**FR-CONTENT-007** `approvedBy` MUST capture the actual reviewer name from the `?approver=` query parameter, not the hardcoded string `"email_approval"`. (Resolves OD-006.)

**FR-CONTENT-008** Clicking Reject MUST update `content-queue.json` on GCS: `status: "rejected"`, `rejectedAt`, `rejectedBy`.

**FR-CONTENT-009** Approval and rejection endpoints MUST be idempotent. Re-clicking a link for an already-processed article MUST log a warning and return the current state without reprocessing.

### 5.3 Publishing

**FR-CONTENT-010** Publishing MUST produce a web-ready markdown file in `apps/landing/src/content/articles/` and update `content-queue.json` status to `published`. (Current state: manual CLI step — see OD-001.)

**FR-CONTENT-011** Published articles MUST be available on the website after the next deployment of `suchi-web`. The deployment step is currently manual. (OD-001 tracks automation.)

**FR-CONTENT-012** The article status lifecycle MUST use the following canonical terms. All queue entries, frontmatter `review_status` fields, and API responses MUST use these values and no others:

```
generated → safety_checked → sent_for_review → approved | rejected → published | archived | expired
```

| Status | Meaning |
|---|---|
| `generated` | AI draft created, not yet safety-checked |
| `safety_checked` | Safety gate passed; ready for human review |
| `sent_for_review` | Approval email sent to reviewers |
| `approved` | Reviewer approved via email link |
| `rejected` | Reviewer rejected via email link |
| `published` | Article live on website |
| `archived` | Removed from public view (not deleted) |
| `expired` | In `sent_for_review` for >30 days; auto-expired |

Current codebase uses a mix of these values and legacy terms (`pending`, `ai_draft`, `reviewed`). Alignment is tracked under OD-002.

---

## 6. Functional Requirements — Hospital Directory

### 6.1 Research

**FR-HOSP-001** Hospital research MUST target the following eligibility criteria:
- Minimum: dedicated oncology department with at least one of: medical oncology, surgical oncology, or radiation oncology
- Preferred: NCG member, NABH accredited, or PM-JAY empanelled
- Required fields: `name`, `city`, `address`, `phone`, `speciality`, `type` (government/private), `last_verified`
- Disqualifying: no oncology department; palliative/hospice only; not contactable for verification

**FR-HOSP-002** Each hospital entry MUST include a `score` (0–100) reflecting data completeness and confidence.

**FR-HOSP-003** Hospital data MUST be deduplicated before adding to `hospitals.json`. Deduplication must check name similarity and city/address.

### 6.2 Review

**FR-HOSP-004** Researched hospital batches MUST be sent to reviewers via email with a link to the review portal.

**FR-HOSP-005** The review portal MUST allow inline editing of each hospital field before approval.

**FR-HOSP-006** Approving a hospital MUST write the entry to `apps/landing/src/content/hospitals.json` on GCS.

**FR-HOSP-007** Hospital approvals MUST capture reviewer name. (Resolves OD-006 for navigator pipeline.)

### 6.3 Chat Integration

**FR-HOSP-008** Hospital search queries in chat MUST query `hospitals.json` (not the LLM's parametric memory). Results MUST include name, city, address, phone, speciality, and type.

---

## 7. Functional Requirements — Social Publishing

### 7.1 Generation

**FR-SOCIAL-001** Social post copy MUST be generated from an approved article using the Gemini LLM (`generateRaw()`). One post is generated per configured platform (Facebook, Instagram, LinkedIn).

**FR-SOCIAL-002** Generated posts MUST be added to `social-queue.json` on GCS with `status: "sent_for_approval"`.

**FR-SOCIAL-003** Posts MUST pass a safety gate before the approval email is sent. The safety gate result (`severity`) MUST be included in the approval email.

### 7.2 Approval

**FR-SOCIAL-004** Social post review MUST be triggered by email. The email MUST include the post copy, a safety warning banner (if applicable), and platform-specific Approve/Reject buttons.

**FR-SOCIAL-005** Approval emails MUST be sent to Gautam, Divya, and Nisha individually, with the other two in CC. Each recipient's link MUST include their name as the `?approver=` parameter.

**FR-SOCIAL-006** The approval email MUST only show buttons for platforms that are currently configured (i.e., have their required env vars set). Unconfigured platforms MUST be omitted with a brief note. (Resolves OD-008.)

**FR-SOCIAL-007** Approval MUST be a one-click action from the email (HMAC-signed link). The first click wins — subsequent clicks from any recipient MUST be ignored with a warning log.

**FR-SOCIAL-008** `approvedBy` MUST capture the reviewer name from the `?approver=` query parameter.

**FR-SOCIAL-009** Approval MUST set `status: "approved"` in `social-queue.json`, then immediately attempt to publish to all approved platforms.

### 7.3 Publishing

**FR-SOCIAL-010** Published posts MUST set `status: "published"` and record `publishedAt`, `approvedPlatforms`, and `failedPlatforms` in the queue entry.

**FR-SOCIAL-011** If a platform publish fails, the failure MUST be recorded in the queue entry but MUST NOT prevent publishing to other platforms.

**FR-SOCIAL-012** After publish, a confirmation email MUST be sent to Gautam with Divya and Nisha in CC. The confirmation MUST include the approver name, published platforms, and any failed platforms.

### 7.4 Safety Hard Blocks

**FR-SOCIAL-013** Posts flagged by the safety gate with `severity: "critical"` MUST NOT be publishable regardless of reviewer action. The approval endpoint MUST return a 403 for critical-severity posts. (Resolves OD-004.)

Hard-block categories:
- Diagnosis language ("you may have cancer")
- Cure or guarantee language
- Stop-treatment or self-medication advice
- Survival rate claims without context
- Specific cost claims without a verifiable source

---

## 8. Admin and Review Requirements

**FR-ADMIN-001** All `/v1/admin/*` endpoints MUST be protected by HTTP Basic Auth (`ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS`).

**FR-ADMIN-002** Approval and rejection endpoints (`/approve/:id`, `/reject/:id`) MUST use HMAC token verification only (suitable for one-click email links). Basic Auth MUST NOT be required on these endpoints.

**FR-ADMIN-003** Admin API credentials and approval tokens MUST be stored in GCP Secret Manager. They MUST NOT be committed to git or hardcoded in source.

**FR-ADMIN-004** The admin auth model (Basic Auth) is accepted for the current team size (≤ 4 people). This MUST be re-evaluated before external contractors or non-SCCF users are granted admin access. (See OD-009.)

---

## 9. Safety Requirements

These requirements supersede any conflicting guidance in other documents.

**FR-SAFETY-001** The safety module (`SafetyModule`) MUST be registered in `app.module.ts`. Bypass patterns (`skipSafety`, `bypassSafety`, `disableSafety`) MUST NOT appear in any production code path.

**FR-SAFETY-002** The emergency fast path MUST run before any database or network call for every chat request.

**FR-SAFETY-003** Suchi MUST NEVER return a response that:
- Diagnoses a specific condition
- Recommends a specific treatment for an individual
- Interprets a specific medical report or scan
- States a medication dose for an individual
- Claims a treatment will cure or guarantee an outcome

**FR-SAFETY-004** All KB sources used in responses MUST be from the approved source list in `SUCHI_SAFETY_CONTRACT.md`. Documents without `isTrustedSource: true` MUST be excluded from retrieval.

**FR-SAFETY-005** All responses to medical queries MUST include a disclaimer directing users to consult a healthcare professional.

**FR-SAFETY-006** Social posts MUST NOT contain diagnosis, cure/guarantee, stop-treatment, or unsourced cost claims. These are hard blocks at the approval endpoint, not advisory warnings.

**FR-SAFETY-007** Safety events (rule-based triggers, PSYCHOSOCIAL classifications, abstentions) MUST be persisted for monitoring.

---

## 10. Non-Functional Requirements

### 10.1 Performance

**NFR-PERF-001** Chat response latency (P50) MUST be under 8 seconds. P95 MUST be under 20 seconds.

**NFR-PERF-002** Emergency fast-path response MUST complete in under 1 second.

**NFR-PERF-003** Voice STT round-trip (audio upload → transcript) MUST complete in under 5 seconds for a 30-second audio clip.

**NFR-PERF-004** The full chat request budget is 45 seconds end-to-end (user sends → response received). Cloud Run request timeout is 55 seconds; at least 10 seconds of buffer must be maintained. This is the latency ceiling for all chat requirements.

### 10.2 Availability and Reliability

**NFR-AVAIL-001** If the LLM is unavailable or times out, the system MUST return a safe template response, not a 5xx error.

**NFR-AVAIL-002** If the RAG database is unavailable, the system MUST return an abstention response, not a 5xx error.

**NFR-AVAIL-003** The approval pipeline (content, social, hospital) MUST be idempotent — duplicate clicks MUST NOT cause duplicate actions.

### 10.3 Scalability

**NFR-SCALE-001** The API is stateless. Session state is stored in PostgreSQL. Horizontal scaling MUST be supported without session affinity.

### 10.4 Security

**NFR-SEC-001** All secrets (API keys, tokens, database URLs) MUST be stored in GCP Secret Manager and injected at deploy time. No secrets may be committed to git.

**NFR-SEC-002** Approval tokens MUST be HMAC-SHA256 signed using a secret key. Token validation MUST run before any state-mutating action.

**NFR-SEC-003** All external HTTP communication MUST use HTTPS.

**NFR-SEC-004** The API MUST apply rate limiting. Default configuration: see `RATE_LIMIT_TTL_SEC` and `RATE_LIMIT_REQ_PER_TTL` in env validation.

### 10.5 Observability

**NFR-OBS-001** Every chat request MUST be traced via `ObservabilityService` (Langfuse). Each of the pipeline phases MUST be traceable.

**NFR-OBS-002** LLM call duration, token count, and success/failure MUST be recorded for each request.

**NFR-OBS-003** Safety gate triggers, abstentions, and emergency activations MUST be logged at WARN level or above.

---

## 11. Data and Audit Requirements

**FR-AUDIT-001** All chat conversations MUST be stored in the `conversation` and `message` tables in PostgreSQL.

**FR-AUDIT-002** All safety events MUST be stored in the `safetyEvent` table, including the classification result and the triggering message.

**FR-AUDIT-003** All article approvals and rejections MUST be recorded with: article ID, action (approved/rejected), reviewer name, timestamp.

**FR-AUDIT-004** All social post actions MUST be recorded with: post ID, action, reviewer name, timestamp, platforms published, platforms failed.

**FR-AUDIT-005** All hospital approvals MUST be recorded with: hospital ID, action, reviewer name, timestamp.

**FR-AUDIT-006** GCS queue files (`content-queue.json`, `social-queue.json`, `navigator/queue.json`) are the source of truth for pipeline state. They MUST be consistent with the actions taken by the API.

**FR-AUDIT-007** Pending drafts (articles or social posts) that remain in `sent_for_review` / `sent_for_approval` status for more than 7 days MUST trigger a reminder email. Posts older than 30 days (articles) or 7 days (social posts) MUST expire automatically. (Resolves OD-007.)

---

## 12. Acceptance Criteria

These are the minimum bars for considering a feature complete. Each maps to one or more functional requirements.

### Chat

- A treatment-related query returns a KB-grounded response with at least 2 citations from at least 2 sources, within 8 seconds (P50). If evidence thresholds are not met, it returns a safe abstention response instead.
- A non-treatment medical query returns a KB-grounded response with at least 1 citation within 8 seconds (P50).
- A query matching an emergency pattern returns an emergency response in under 1 second. No LLM or database calls are made before this check.
- A query classified as `safe_redirect` or `hard_refusal` by the safety gate returns a safety response. No LLM call is made.
- A query for diagnosis, report interpretation, or individual treatment recommendation is refused with a safe redirect message.
- A Hindi query returns a Hindi response with accurate substance drawn from KB chunks.
- If the LLM call times out, the user receives a safe abstention response (not a 500 error).
- Re-sending the same message within 60 seconds does not trigger redundant DB reads (session cache).

### Voice

- A Hindi voice recording is transcribed, answered, and returned as a TTS audio URL within 15 seconds.
- TTS output contains no `[1]`, `[2]`, or markdown syntax in the spoken text.

### Content Pipeline

- Approving an article updates `content-queue.json` on GCS with `status: "approved"` and captures the reviewer name.
- Re-clicking the approval link for an already-approved article produces no state change and logs a warning.
- Running `content/cli.ts publish` for an approved article creates a web-ready markdown file in `apps/landing/src/content/articles/`.

### Social Pipeline

- Approving a social post publishes it to the configured platform(s) and sends a confirmation email.
- Re-clicking the approval link produces no duplicate post and logs a warning.
- A post containing cure/guarantee language is rejected by the approval endpoint with a 403.
- Approval buttons for unconfigured platforms do not appear in the email.

### Hospital Directory

- A hospital search query in chat returns entries from `hospitals.json`, not LLM-generated content.

---

## 13. Out of Scope

The following are explicitly outside the scope of Suchi:

- **Clinical decision support** — Suchi does not recommend treatments for individual patients.
- **Telemedicine** — Suchi does not connect users to doctors for real-time consultation.
- **Electronic Health Records (EHR)** — Suchi does not store or retrieve patient medical records.
- **Prescription management** — Suchi does not manage or track medications.
- **Billing or insurance claims** — Suchi provides general scheme information only; it does not file claims.
- **Non-cancer medical information** — Suchi will not answer general health questions unrelated to cancer.
- **Children's content (under 18)** — Suchi is designed for adult patients and caregivers.

---

## 14. Open Decisions

Active unresolved decisions that may affect requirements implementation. Full detail in `docs/OPEN_DECISIONS.md`.

| ID | Area | Summary | Impact |
|---|---|---|---|
| OD-001 | Content pipeline | Article publish step is manual (not automated) | FR-CONTENT-010, FR-CONTENT-011 |
| OD-002 | Content pipeline | Three inconsistent status lifecycles | FR-CONTENT-012 |
| OD-003 | Chat + content | Citation rendering policy not formally documented | FR-CHAT-013, FR-CHAT-014 |
| OD-004 | Social pipeline | Safety banner is advisory, not a hard block | FR-SOCIAL-013 |
| OD-005 | Content | CONTENT_GUIDE vs CONTENT_PAGE_SCHEMA conflict — CONTENT_GUIDE.md declared canonical; FR-CONTENT-001 is provisional pending CONTENT_PAGE_SCHEMA.md update | FR-CONTENT-001 |
| OD-006 | Audit | Article and navigator approvals don't capture reviewer name | FR-CONTENT-007, FR-HOSP-007 |
| OD-007 | All pipelines | Pending drafts have no expiry | FR-AUDIT-007 |
| OD-008 | Social pipeline | Inactive platform buttons shown in email | FR-SOCIAL-006 |
| OD-009 | Security | Admin endpoints protected by Basic Auth only | FR-ADMIN-004 |
| OD-010 | Hospital directory | Hospital eligibility criteria not formally defined | FR-HOSP-001 |

---

## 15. Phase 2 Requirements

Requirements derived from `REQUIREMENTS_ANNEXURE_1.md` (Annexure 1: Human-in-the-Loop AI Systems). All items are **Not Started** unless noted. Use the same traceability and implementation pattern as Phase 1.

> **Pattern for future phases:** When a new requirements document arrives, run a gap analysis against this file, then append a new numbered section (§16, §17, …) using the same FR-*/NFR-* format. Each requirement gets a row in `REQUIREMENTS_TRACEABILITY_MATRIX.md` with `Not Started` status.

---

### 15.1 Extended User Roles

**FR-ROLE-001** Suchi MUST treat **Community Members** (awareness-seekers with no personal diagnosis) as a distinct user class from Patients/Caregivers. Community Member responses should favour general awareness over personal navigation guidance.

**FR-ROLE-002** Suchi MUST support **Field Workers / Volunteers** — SCCF staff or volunteers who use Suchi to explain information to patients on their behalf. Field worker sessions should be identifiable (via a session flag) for analytics.

**FR-ROLE-003** A **Medical Reviewer** role MUST exist in the content pipeline. Medical Reviewer approval is required before any Category B or C content (§15.3) is deployed to the knowledge base.

**FR-ROLE-004** A **Program Reviewer** role MUST exist. Program Reviewers can view the human-review queue (§15.4), mark cases as reviewed, and add notes. Access via the admin panel with Basic Auth.

---

### 15.2 User Journey Specifications

The six priority user journeys from Annexure 1 §8.4 are the canonical acceptance scenarios for Suchi. Each MUST be verifiable via the eval suite.

**FR-JOURNEY-001 — Newly Diagnosed Patient:** Response reassures calmly, does not recommend a treatment plan, suggests ≥3 questions to ask the oncologist, and offers a next-step resource.

**FR-JOURNEY-002 — Caregiver Reading a Report:** Response explains terms at a general level, explicitly states that the report must be interpreted by a doctor, and helps prepare questions. Must NOT provide a definitive interpretation.

**FR-JOURNEY-003 — Person Worried About Symptoms:** Response never uses "you may have cancer" language, explains that symptoms can have many causes, and encourages timely medical consultation.

**FR-JOURNEY-004 — Treatment Preparation:** Response explains what to generally expect for the named treatment, suggests preparation questions, and defers to the treating team's advice.

**FR-JOURNEY-005 — Caregiver Stress:** Response uses empathetic language, normalises caregiver burden, and escalates to crisis resources if self-harm language is detected.

**FR-JOURNEY-006 — Emergency / Red Flag:** Response advises immediate medical attention, provides India emergency numbers (108/112), and marks the session for human review.

---

### 15.3 Knowledge Base Content Risk Classification

**FR-RISK-001 — Category A (Low-Risk Awareness):** Content covering general awareness, myths, prevention, screening basics, and glossary terms. Requires internal review before publication. Periodic medical review.

**FR-RISK-002 — Category B (Medium-Risk Treatment Explanation):** Content covering chemotherapy, radiation, surgery, side effects, staging, biopsy, and palliative care. Requires Medical Reviewer sign-off before deployment to the KB.

**FR-RISK-003 — Category C (High-Risk Guidance):** Content covering symptoms, emergencies, report interpretation, treatment decisions, side-effect severity, and distress responses. Requires strict Medical Reviewer approval, escalation logic in the chat pipeline, and continuous monitoring post-deployment.

**FR-KB-101 — KB Entry Metadata:** Each knowledge-base document MUST carry the following fields: `reviewer_name`, `review_status` (`pending`/`reviewed`/`approved`), `risk_category` (A/B/C), `approved_usage_scope`, `version`. These fields extend the existing `KbDocument` schema.

---

### 15.4 Human Review Queue

**FR-REVIEW-001 — Review Flagging:** The following conversation types MUST be flagged for human review: symptom-related queries, report-interpretation requests, side-effect severity questions, mental distress, complaints about doctors or hospitals, requests for treatment decision-making, and any response where the safety gate fires.

**FR-REVIEW-002 — Review Queue Endpoint:** A `GET /v1/admin/review-queue` endpoint MUST return all sessions flagged since a given date, with classification reason and session ID. Accessible to Program Reviewer role.

**FR-REVIEW-003 — Review Outcome Logging:** When a Program Reviewer marks a flagged session as reviewed (via `PATCH /v1/admin/review-queue/:id`), the outcome (reviewed / escalated / no-action) and reviewer name MUST be persisted.

---

### 15.5 Analytics and Content Gaps

**FR-ANALYTICS-001 — Topic Frequency:** The system MUST track and expose the top N most common query topics per time period. Derived from conversation metadata, not raw text.

**FR-ANALYTICS-002 — Content Gap Detection:** Queries that trigger abstention (evidence gate failed, no KB match) MUST be aggregated and surfaced as a "content gaps" report. Available via `GET /v1/admin/analytics/content-gaps`.

**FR-ANALYTICS-003 — Language Mix:** The system MUST report the distribution of input languages (English / Hindi / Hinglish) per time period.

**FR-ANALYTICS-004 — Escalation Counts:** Safety event counts by type (emergency fast path, self-harm, refusal, red flag) MUST be included in the daily report.

**FR-ANALYTICS-005 — Anonymised Export:** All analytics exports MUST be anonymised — no session IDs, no user text, no location linked to an individual — before use in fundraising, reporting, or the monthly Learning Note.

---

### 15.6 Monthly Learning Note

**FR-LEARN-001 — Learning Note Generation:** A scheduled job MUST produce a monthly SCCF Learning Note covering: (1) top query categories, (2) content gaps, (3) risk/distress pattern counts, (4) new resources needed, (5) aggregate interaction numbers. Output as a structured JSON + markdown report, emailed to SCCF leadership. No raw user text or session IDs in the output.

---

### 15.7 Non-Functional Requirements (Phase 2)

**NFR-MAINTAIN-001 — Version-Controlled Prompts:** All LLM system prompts MUST be stored as versioned files in the repository (not hardcoded in service files). Prompt changes MUST be traceable via git history.

**NFR-INTEROP-001 — Google Workspace Export:** The monthly Learning Note and content-gap report MUST be exportable to Google Sheets or Google Docs format (CSV or markdown respectively) for use by non-technical SCCF staff.

**NFR-LANG-001 — Language Launch Gate:** No new language (e.g., Bengali, Odia) MUST be deployed to production unless: (a) a Medical Reviewer capable of reviewing content in that language is available, and (b) at least 20 KB entries in that language have been reviewed and approved.

---

## 16. Functional Requirements — WhatsApp Conversational Channel

A full conversational delivery channel that brings the complete Suchi chat experience to WhatsApp via the **Meta WhatsApp Cloud API**. Unlike the legacy WhatsApp Navigator (a standalone hospital-finding state machine at `/v1/whatsapp-navigator/webhook`), this channel routes every inbound message through the same `ChatService.handle()` pipeline used by web and voice — inheriting all safety, RAG, citation, and abstention guarantees. Hospital-finding queries are served by the pipeline's existing navigate mode, so the legacy Navigator is **not extended** by this work.

> **Status:** Planned. Provider integration (Meta Business setup, WABA, phone number, system-user token) is tracked as a prerequisite operations task (GitHub issue, assigned to Ananya). Code and infra are tracked against the FR-WA-* requirements below.

### 16.1 Channel and Provider

**FR-WA-001** Inbound WhatsApp messages MUST be processed through the existing `ChatService.handle()` pipeline with `channel: "whatsapp"`. The channel MUST NOT implement a parallel response pipeline; all safety (§9), evidence-gate, and citation rules apply unchanged.

**FR-WA-002** The channel MUST integrate directly with the **Meta WhatsApp Cloud API** (`graph.facebook.com`). No third-party BSP (Business Solution Provider) is used.

**FR-WA-003** The channel MUST be implemented as a dedicated `whatsapp` module (controller + service), separate from the legacy `whatsapp-navigator` module. Hospital-finding intent MUST be handled by the chat pipeline's navigate mode, not by routing into the legacy Navigator.

### 16.2 Webhook

**FR-WA-004** `GET /v1/whatsapp/webhook` MUST implement the Meta verification handshake: when `hub.verify_token` matches the configured `WHATSAPP_VERIFY_TOKEN`, the endpoint MUST echo `hub.challenge` with HTTP 200; otherwise it MUST return 403.

**FR-WA-005** `POST /v1/whatsapp/webhook` MUST verify the `X-Hub-Signature-256` header (HMAC-SHA256 of the raw request body using `META_APP_SECRET`) before processing. Requests with a missing or invalid signature MUST be rejected with 403 and MUST NOT trigger pipeline processing. (Closes the unauthenticated-webhook gap noted for the legacy Navigator in `DEPLOY_PREFLIGHT.md`.)

**FR-WA-006** The webhook MUST acknowledge inbound events with HTTP 200 **immediately** (within Meta's timeout window) and process the message **asynchronously**. The chat reply MUST be delivered via an outbound Cloud API call (FR-WA-010), never in the webhook HTTP response.

**FR-WA-007** The webhook MUST be idempotent: each inbound message MUST be de-duplicated by its WhatsApp message id (`wamid`) so that Meta webhook retries do not produce duplicate replies. Delivery/read `statuses` events MUST be ignored.

### 16.3 Session and State

**FR-WA-008** A persistent phone-to-session mapping MUST be maintained in the database (e.g., a `WhatsAppContact` model keyed by `waId`), NOT in process memory — the service runs multiple Cloud Run instances and scales to zero. The mapping MUST persist `sessionId`, `locale`, and `lastActiveAt`.

**FR-WA-009** A WhatsApp contact MUST reuse its existing Suchi session while active and MUST be assigned a fresh session (via `SessionsService.create({ channel: "whatsapp" })`) once inactive beyond a defined window (default 24 hours), so each new conversation starts with clean context.

### 16.4 Outbound and Formatting

**FR-WA-010** Replies MUST be sent via `POST https://graph.facebook.com/v{version}/{META_WABA_PHONE_NUMBER_ID}/messages` authenticated with `META_WABA_TOKEN` (a system-user token holding the `whatsapp_business_messaging` scope — distinct from the Facebook page token `META_PAGE_ACCESS_TOKEN`).

**FR-WA-011** Outbound text MUST be formatted for WhatsApp: markdown emphasis converted to WhatsApp syntax (`*bold*`, `_italic_`), citation markers stripped (consistent with FR-CHAT citation policy — citations are never shown to end users), and messages exceeding the 4096-character limit split into multiple messages.

**FR-WA-012** Input language MUST be detected from the message text (reusing the existing cross-lingual handling) and cached per contact in `WhatsAppContact.locale`; replies MUST be generated in the detected language.

### 16.5 Messaging Window and Configuration

**FR-WA-013** The channel is **reactive only** — it MUST only send messages in reply to a user-initiated inbound message, which always falls inside Meta's 24-hour customer-service window. Pre-approved message templates and proactive/outbound-initiated messaging are therefore NOT required for v1 and are out of scope.

**FR-WA-014** The channel MUST be cleanly disabled when its credentials are absent: `META_WABA_PHONE_NUMBER_ID`, `META_WABA_TOKEN`, `META_APP_SECRET`, and `WHATSAPP_VERIFY_TOKEN` MUST all be optional env vars (validated in `env.validation.ts`), and the webhook MUST fail safe (no outbound attempt) when unconfigured.

### 16.6 Privacy

**FR-WA-015** WhatsApp phone numbers are PII. Per `PRIVACY_RETENTION.md`, the system MUST support locating and deleting all records for a given phone number on request, and stored `waId` values MUST be covered by the standard retention policy.

### 16.7 Out of Scope (v1 — deferred to a later phase)

- **Inbound voice notes** — transcription via the existing STT pipeline is a natural Phase 2 extension.
- **Interactive list / button menus** — replies are plain text in v1.
- **Proactive / template-initiated messaging** — see FR-WA-013.
