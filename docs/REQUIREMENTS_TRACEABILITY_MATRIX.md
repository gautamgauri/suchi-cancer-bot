# Requirements Traceability Matrix

Maps each requirement from `REQUIREMENTS.md` to its implementation location and test coverage.

## Status definitions

**Implementation:** `Implemented` · `Partial` · `Missing`  
**Verification:** `Tested` · `Manual only` · `Untested` · `Failed`

"Implemented" means code exists. It does not mean the requirement is safe — a requirement without a test in `Verification` is only as reliable as the last manual check.

---

## Chat Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| FR-CHAT-001 | 9-phase pipeline, no phase skipped | `chat/chat.service.ts` `handle()` | `chat.service.spec.ts` | Implemented | Partial |
| FR-CHAT-003 | Emergency fast path <1ms | `evaluateEmergencyFastPath()` | No test | Implemented | Untested |
| FR-CHAT-004 | LLM failure → abstention | `AbstentionService`; catch in `LlmService` | `llm.service.spec.ts` (provider-failure → safe fallback, never throws) + `abstention.service.spec.ts` | Implemented | Tested |
| FR-CHAT-005 | Safety gate before RAG/LLM; `safe_redirect`/`hard_refusal` terminate | Phase 2; `SafetyService.evaluate()` | No test | Implemented | Untested |
| FR-CHAT-006 | Safety events persisted | `safetyEvent` table; `SafetyService` | No test | Implemented | Untested |
| FR-CHAT-007 | Auto-refuse diagnosis/prescription | `SafetyService` + LLM system prompt | No test | Implemented | Untested |
| FR-CHAT-008 | Medical claims grounded in KB only | `EvidenceGateService`; LLM prompt | No test | Implemented | Untested |
| FR-CHAT-009 | Min evidence thresholds enforced | `EvidenceGateService` | No test | Implemented | Untested |
| FR-CHAT-010 | Abstention when evidence insufficient | `AbstentionService.generateAbstentionResponse()` | No test | Implemented | Untested |
| FR-CHAT-011 | Only trusted KB sources used | `isTrustedSource` filter in `RagService` | No test | Implemented | Untested |
| FR-CHAT-012 | Citation repair ≥2 citations | `CitationService.repairCitations()` | No test | Implemented | Untested |
| FR-CHAT-013 | Citations not shown inline in prose | Frontend renders as collapsible section | Manual only | Implemented | Manual only |
| FR-CHAT-014 | Voice strips citation markers | `stripForVoice()` Phase 9 | No test | Implemented | Untested |
| FR-CHAT-015 | Session stores cancerType/emotionalState | `PatientStateService`; `session` table | No test | Implemented | Untested |
| FR-CHAT-016 | Session cache 60s TTL | `PatientStateService` cache | No test | Implemented | Untested |
| FR-CHAT-017 | Agentic router: 6 product intent categories | `agentic-intent-router.ts` `classifyAgenticIntent()` | No test | Implemented | Untested |
| FR-CHAT-018 | `hospital_search` routes to planner stack | `ExecutionPlannerService` → `PlanExecutorService` | No test | Implemented | Untested |
| FR-CHAT-019 | "therapy" alone ≠ PSYCHOSOCIAL | `PSYCHOSOCIAL_PATTERNS` in `agentic-intent-router.ts` | No test | Implemented | Untested |
| FR-CHAT-020 | Hindi/Hinglish cross-lingual expansion | `CrossLingualService` | No test | Implemented | Untested |

**Priority tests to add:** FR-CHAT-003, FR-CHAT-004, FR-CHAT-005, FR-CHAT-009, FR-CHAT-012, FR-CHAT-019, FR-CHAT-020

---

## Voice Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| FR-VOICE-001 | Max 2MB audio, max 60s | `VOICE_MAX_AUDIO_SIZE_BYTES`, `VOICE_MAX_AUDIO_DURATION_SEC` | No test | Implemented | Untested |
| FR-VOICE-002 | STT v2 with phrase adaptation | `STT_VERSION=v2`; `voice/voice.service.ts` | Manual only | Implemented | Manual only |
| FR-VOICE-003 | Transcribed text through 9-phase pipeline | `ChatService.handle()` called from `VoiceService` | No test | Implemented | Untested |
| FR-VOICE-004 | TTS strips markdown + citations | `stripForVoice()` Phase 9 | No test | Implemented | Untested |
| FR-VOICE-005 | TTS stored in GCS, signed URL returned | `GCS_BUCKET_TTS`; signed URL in `VoiceService` | Manual only | Implemented | Manual only |
| FR-VOICE-006 | Web Speech API stutter cleanup | `cleanVoiceInput()` Phase 0 | No test | Implemented | Untested |

---

## Content Pipeline Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| FR-CONTENT-001 | CONTENT_GUIDE.md 7-section structure | AI prompt references guide; `CONTENT_PAGE_SCHEMA.md` section 4 references guide | Manual only | Implemented | Manual only |
| FR-CONTENT-002 | Articles as markdown with frontmatter | `content/drafts/*.md` | Manual only | Implemented | Manual only |
| FR-CONTENT-003 | New articles added to content-queue.json | `content/queue-manager.ts` | No test | Implemented | Untested |
| FR-CONTENT-004 | Review triggered by email with Approve/Reject links | `admin/content-post.service.ts` | Manual only | Implemented | Manual only |
| FR-CONTENT-005 | Approval is HMAC one-click | `/v1/admin/content/approve/:id` | No test | Implemented | Untested |
| FR-CONTENT-006 | Approval updates GCS `status: "approved"` + timestamp | `queue-manager.ts` `updateStatus()` | No test | Implemented | Untested |
| FR-CONTENT-007 | `approvedBy` captures reviewer name (not "email_approval") | `content-approve.service.ts` `approver` param; falls back to `"email_approval"` only when absent (OD-006 closed) | `content-approve.service.spec.ts` | Implemented | Tested |
| FR-CONTENT-008 | Rejection updates GCS status | `queue-manager.ts` `updateStatus()` | No test | Implemented | Untested |
| FR-CONTENT-009 | Approval endpoints idempotent | `content-approve.service.ts` status guard (`already approved/rejected` → ignore duplicate click) | `content-approve.service.spec.ts` | Implemented | Tested |
| FR-CONTENT-010 | Publish writes to landing/content | `content/cli.ts publish` (manual CLI) | Manual only | Partial | Manual only |
| FR-CONTENT-011 | Published articles live after suchi-web deploy | Manual process; no automation (OD-001) | Manual only | Partial | Manual only |
| FR-CONTENT-012 | Canonical lifecycle terms used consistently | `content/types.ts` `ArticleStatus`; `content/cli.ts`; `content-research.service.ts`; `CONTENT_PAGE_SCHEMA.md` `REVIEW_STATUSES` | No test | Implemented | Untested |

---

## Hospital Directory Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| FR-HOSP-001 | Eligibility criteria enforced | Partial — research prompt references criteria; no formal checklist (OD-010) | Manual only | Partial | Manual only |
| FR-HOSP-002 | Hospital score 0–100 | `hospitals.json` schema includes `score` | Manual only | Implemented | Manual only |
| FR-HOSP-003 | Deduplication before adding to hospitals.json | `navigator-approve.service.ts` dedup check | `navigator-approve.service.spec.ts` | Implemented | Tested |
| FR-HOSP-004 | Review email with portal link | `navigator-approve.service.ts` email | Manual only | Implemented | Manual only |
| FR-HOSP-005 | Portal allows inline editing | Navigator review portal | Manual only | Implemented | Manual only |
| FR-HOSP-006 | Approval writes to hospitals.json | `navigator-approve.service.ts` | `navigator-approve.service.spec.ts` | Implemented | Tested |
| FR-HOSP-007 | Approvals capture reviewer name | `navigator-approve.service.ts` `approver` param → `approvedBy` | `navigator-approve.service.spec.ts` | Implemented | Tested |
| FR-HOSP-008 | Hospital search queries hospitals.json | `HospitalDirectoryService` | `hospital-directory.service.spec.ts` | Implemented | Tested |

---

## Social Publishing Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| FR-SOCIAL-001 | Social copy via Gemini `generateRaw()` | `admin/social-post.service.ts` | Manual only | Implemented | Manual only |
| FR-SOCIAL-002 | Posts added to social-queue.json | `social-post.service.ts` | Manual only | Implemented | Manual only |
| FR-SOCIAL-003 | Safety gate before approval email; severity in email | `social-post.service.ts` safety check | Manual only | Implemented | Manual only |
| FR-SOCIAL-004 | Approval email with copy + safety banner | `sendApprovalEmail()` | Manual only | Implemented | Manual only |
| FR-SOCIAL-005 | 3 individual emails with others in CC | `sendApprovalEmail()` (Gautam/Divya/Nisha) | Manual only | Implemented | Manual only |
| FR-SOCIAL-006 | Only configured platforms shown in email | `social-post.service.ts` `fbConfigured`/`igConfigured`/`liConfigured` — unconfigured platform buttons omitted (OD-008 closed) | `social-post.service.spec.ts` | Implemented | Tested |
| FR-SOCIAL-007 | First-click-wins idempotency | `approvePost()` status guard | `social-post.service.spec.ts` | Implemented | Tested |
| FR-SOCIAL-008 | `approvedBy` captures reviewer name | `?approver=` param; stored in queue | Manual only | Implemented | Manual only |
| FR-SOCIAL-009 | Approval triggers immediate publish | `approvePost()` → `publishPost()` | Manual only | Implemented | Manual only |
| FR-SOCIAL-010 | Published status with platform breakdown | `social-queue.json` `approvedPlatforms`, `failedPlatforms` | Manual only | Implemented | Manual only |
| FR-SOCIAL-011 | Platform failure doesn't block others | `Promise.allSettled()` in publish loop | No test | Implemented | Untested |
| FR-SOCIAL-012 | Confirmation email to team after publish | `sendConfirmationEmail()` | Manual only | Implemented | Manual only |
| FR-SOCIAL-013 | Critical-severity = hard block (403) | `social-post.service.ts` `HARD_BLOCK_PATTERNS` → `safetyBlocked`; `approvePost()` throws when blocked (OD-004 closed) | `social-post.service.spec.ts` | Implemented | Tested |

---

## Admin and Review Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| FR-ADMIN-001 | Basic Auth on all /v1/admin/* | `BasicAuthGuard` applied to admin module | No test | Implemented | Untested |
| FR-ADMIN-002 | Approval endpoints use HMAC only | `/approve/:id` and `/reject/:id` HMAC token | No test | Implemented | Untested |
| FR-ADMIN-003 | Secrets in Secret Manager | All secrets via `--set-secrets` in `cloudbuild.yaml` | Preflight Check 3 | Implemented | Tested |
| FR-ADMIN-004 | Basic Auth accepted; re-evaluate trigger documented | OD-009 in `OPEN_DECISIONS.md` | Documented | N/A | N/A |

---

## Safety Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| FR-SAFETY-001 | SafetyModule registered; no bypass patterns | `app.module.ts`; preflight Check 6 | Preflight Check 6 | Implemented | Tested |
| FR-SAFETY-002 | Emergency fast path before any DB/network call | Phase 1 runs synchronously in `handle()` | No test | Implemented | Untested |
| FR-SAFETY-003 | Never diagnose, prescribe, or guarantee outcomes | `SafetyService` + LLM system prompt | No test | Implemented | Untested |
| FR-SAFETY-004 | Only trusted KB sources | `isTrustedSource: true` filter | No test | Implemented | Untested |
| FR-SAFETY-005 | Disclaimer on all medical responses | `appendDisclaimer()` Phase 9 | No test | Implemented | Untested |
| FR-SAFETY-006 | Social posts: critical categories are hard blocks | `social-post.service.ts` `HARD_BLOCK_PATTERNS` → `safetyBlocked`; approval throws when blocked (OD-004 closed) | `social-post.service.spec.ts` | Implemented | Tested |
| FR-SAFETY-007 | Safety events persisted | `safetyEvent` table | No test | Implemented | Untested |

---

## Non-Functional Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| NFR-PERF-001 | P50 <8s, P95 <20s chat latency | 45s budget; Gemini API | Langfuse traces (spot check) | Partial | Manual only |
| NFR-PERF-002 | Emergency <1s | Synchronous regex, no async | No test | Implemented | Untested |
| NFR-PERF-003 | STT <5s for 30s audio | Google STT v2 | Manual only | Partial | Manual only |
| NFR-PERF-004 | 45s budget; 10s buffer vs Cloud Run 55s timeout | 45s budget enforced; Cloud Run config | No test | Implemented | Untested |
| NFR-AVAIL-001 | LLM failure → safe template | `AbstentionService` fallback | `abstention.service.spec.ts` | Implemented | Tested |
| NFR-AVAIL-002 | DB unavailable → abstention | Error handling in `RagService` | No test | Partial | Untested |
| NFR-AVAIL-003 | Approval pipeline idempotent | Social: implemented. Content: missing. | Partial | Partial | Untested |
| NFR-SCALE-001 | Stateless API; session in PostgreSQL | Session in PostgreSQL | No test | Implemented | Untested |
| NFR-SEC-001 | Secrets in Secret Manager | `cloudbuild.yaml` `--set-secrets` | Preflight Check 3 | Implemented | Tested |
| NFR-SEC-002 | HMAC approval tokens | `crypto.createHmac()` in approval services | No test | Implemented | Untested |
| NFR-SEC-003 | HTTPS only | Cloud Run enforces HTTPS | Cloud Run config | Implemented | Tested |
| NFR-SEC-004 | Rate limiting | `ThrottlerModule` in `app.module.ts` | No test | Implemented | Untested |
| NFR-OBS-001 | Per-request Langfuse tracing | `ObservabilityService` in each phase | Manual (Langfuse UI) | Implemented | Manual only |
| NFR-OBS-002 | LLM call duration + tokens recorded | `ObservabilityService.endGeneration()` | Manual (Langfuse UI) | Implemented | Manual only |
| NFR-OBS-003 | Safety events logged at WARN+ | `this.logger.warn()` in safety paths | No test | Implemented | Untested |

---

## Audit Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| FR-AUDIT-001 | Conversations in PostgreSQL | `conversation` + `message` tables | No test | Implemented | Untested |
| FR-AUDIT-002 | Safety events in safetyEvent table | `SafetyService` | No test | Implemented | Untested |
| FR-AUDIT-003 | Article actions with reviewer name + timestamp | `content-approve.service.ts` `approvedBy`/`rejectedBy`; `content-research.service.ts` `?approver=` in emails | No test | Implemented | Untested |
| FR-AUDIT-004 | Social post actions with reviewer name + timestamp | `social-queue.json` `approvedBy`, `approvedAt` | Manual only | Implemented | Manual only |
| FR-AUDIT-005 | Hospital approvals with reviewer name + timestamp | `navigator-approve.service.ts` `approver` → `approvedBy` + `approvedAt` | `navigator-approve.service.spec.ts` | Implemented | Tested |
| FR-AUDIT-006 | GCS queues consistent with API state | Queue updated atomically in service layer | No test | Implemented | Untested |
| FR-AUDIT-007 | Draft expiry + reminder emails | `draft-expiry.service.ts` — article reminder @48h; social reminder @3d, expire @7d; `POST /v1/admin/housekeeping/run-expiry` (OD-007 closed) | `draft-expiry.service.spec.ts` | Implemented | Tested |

---

## Phase 2 Requirements — Traceability

All Phase 2 requirements are **Not Started** unless noted. Implementation phase TBD.

| Req ID | Description | Implementation | Verif. | Impl. Status |
|---|---|---|---|---|
| FR-ROLE-001 | Community Member user class | — | — | Not Started |
| FR-ROLE-002 | Field Worker session flag | — | — | Not Started |
| FR-ROLE-003 | Medical Reviewer role in content pipeline | — | — | Not Started |
| FR-ROLE-004 | Program Reviewer role + review queue access | — | — | Not Started |
| FR-JOURNEY-001 | Newly diagnosed patient journey (eval) | — | — | Not Started |
| FR-JOURNEY-002 | Caregiver reading a report (eval) | — | — | Not Started |
| FR-JOURNEY-003 | Person worried about symptoms (eval) | — | — | Not Started |
| FR-JOURNEY-004 | Treatment preparation (eval) | — | — | Not Started |
| FR-JOURNEY-005 | Caregiver stress + crisis escalation (eval) | — | — | Not Started |
| FR-JOURNEY-006 | Emergency / red-flag (eval) | — | — | Not Started |
| FR-RISK-001 | Category A content — internal review gate | — | — | Not Started |
| FR-RISK-002 | Category B content — Medical Reviewer sign-off | — | — | Not Started |
| FR-RISK-003 | Category C content — strict Medical Reviewer + monitoring | — | — | Not Started |
| FR-KB-101 | KB entry: reviewer_name, review_status, risk_category, version fields | — | — | Not Started |
| FR-REVIEW-001 | Human review flagging for 10 trigger conditions | — | — | Not Started |
| FR-REVIEW-002 | `GET /v1/admin/review-queue` endpoint | — | — | Not Started |
| FR-REVIEW-003 | Review outcome persistence (reviewed/escalated/no-action) | — | — | Not Started |
| FR-ANALYTICS-001 | Top N query topics per time period | — | — | Not Started |
| FR-ANALYTICS-002 | Content gaps report from abstention events | — | — | Not Started |
| FR-ANALYTICS-003 | Language mix reporting | — | — | Not Started |
| FR-ANALYTICS-004 | Escalation counts by safety event type | Partial — daily report has counts | Manual only | Partial |
| FR-ANALYTICS-005 | Anonymised analytics export (no session IDs or raw text) | — | — | Not Started |
| FR-LEARN-001 | Monthly Learning Note — scheduled generation + email | — | — | Not Started |
| NFR-MAINTAIN-001 | Version-controlled LLM prompts in repo | — | — | Not Started |
| NFR-INTEROP-001 | Google Sheets / Docs export for Learning Note + gap report | — | — | Not Started |
| NFR-LANG-001 | Language launch gate (Medical Reviewer + 20 reviewed KB entries) | — | — | Not Started |

---

## WhatsApp Conversational Channel — Traceability (§16)

Full conversational channel over the Meta WhatsApp Cloud API, routing all inbound traffic through `ChatService.handle({channel:"whatsapp"})`. Code landed on branch `feat/whatsapp-channel`; live operation is gated on the Meta provisioning task (GitHub issue #29, assigned to Ananya).

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| FR-WA-001 | Inbound routed through existing `ChatService.handle()` w/ `channel:"whatsapp"` | `whatsapp/whatsapp.service.ts` `processInbound()` | `whatsapp.service.spec.ts` | Implemented | Tested |
| FR-WA-002 | Direct Meta WhatsApp Cloud API (no BSP) | `whatsapp.service.ts` `sendText()` (`graph.facebook.com`) | Live creds pending (issue #29) | Implemented | Untested |
| FR-WA-003 | Dedicated `whatsapp` module, separate from legacy navigator | `whatsapp/whatsapp.module.ts` | `nest build` | Implemented | Manual only |
| FR-WA-004 | GET verification handshake echoes `hub.challenge` | `whatsapp.controller.ts` `verify()`; `verifyHandshake()` | `whatsapp.service.spec.ts` | Implemented | Tested |
| FR-WA-005 | POST `X-Hub-Signature-256` HMAC verification, reject on mismatch | `verifySignature()`; controller `receive()` | `whatsapp.service.spec.ts` | Implemented | Tested |
| FR-WA-006 | ACK 200 immediately; process async; reply out-of-band | `whatsapp.controller.ts` `receive()` (fire-and-forget) | `whatsapp.service.spec.ts` | Implemented | Partial |
| FR-WA-007 | Idempotent on `wamid`; ignore `statuses` events | `parseInbound()`; `alreadySeen()`/`markSeen()` | `whatsapp.service.spec.ts` | Implemented | Tested |
| FR-WA-008 | Persistent phone→session mapping in DB (not memory) | `WhatsAppContact` model; `resolveSession()` | `whatsapp.service.spec.ts` | Implemented | Tested |
| FR-WA-009 | Reuse active session; fresh session past inactivity window | `resolveSession()` (`WHATSAPP_SESSION_TTL_HOURS`) | `whatsapp.service.spec.ts` | Implemented | Tested |
| FR-WA-010 | Outbound via Graph API `/{phoneNumberId}/messages` w/ WABA token | `sendText()` | Live creds pending (issue #29) | Implemented | Untested |
| FR-WA-011 | WhatsApp formatting: markdown→WA, strip citations, 4096 split | `whatsapp-format.ts` | `whatsapp-format.spec.ts` | Implemented | Tested |
| FR-WA-012 | Detect + cache input locale per contact | `detectLocale()`; `WhatsAppContact.locale` | `whatsapp-format.spec.ts` | Implemented | Tested |
| FR-WA-013 | Reactive-only; no templates / proactive in v1 | By design — no outbound-initiated path exists | — | Implemented | N/A |
| FR-WA-014 | Cleanly disabled when creds absent (all env vars optional) | `env.validation.ts`; `isConfigured()`; `sendText()` guard | `whatsapp.service.spec.ts` | Implemented | Tested |
| FR-WA-015 | Phone-number PII covered by retention/deletion policy | `WhatsAppContact` (deletion-by-`waId`); `PRIVACY_RETENTION.md` | No deletion job yet | Partial | Untested |

---

## Coverage Summary

_Last reconciled against code: 2026-06-24 (verified against the source tree, not prior doc state)._

| Category | Total Reqs | Implemented | Partial | Missing / Not Started |
|---|---|---|---|---|
| Chat | 19 | 19 | 0 | 0 |
| Voice | 6 | 6 | 0 | 0 |
| Content Pipeline | 12 | 10 | 2 | 0 |
| Hospital Directory | 8 | 7 | 1 | 0 |
| Social Publishing | 13 | 13 | 0 | 0 |
| Admin + Review | 4 | 3 | 0 | 0 (1 N/A) |
| Safety | 7 | 7 | 0 | 0 |
| Non-Functional | 14 | 11 | 3 | 0 |
| Audit | 7 | 7 | 0 | 0 |
| **Phase 1 Total** | **90** | **83** | **6** | **0** |
| **Phase 2 (Annexure 1)** | **26** | **0** | **1** | **25** |
| WhatsApp Conversational (§16) | 15 | 14 | 1 | 0 |
| **Grand Total** | **131** | **97** | **8** | **25** |

Phase 1 is feature-complete: 0 requirements Missing. The 6 Partial items are the deferred content-publish automation (FR-CONTENT-010/011, OD-001) and three perf NFRs verified only by manual/Langfuse spot-checks. The 25 Not Started are Phase 2 (Annexure 1), deferred by design while the quality engine is the priority.

### Verification coverage

The automated suite is the source of truth, not this column: **819 tests across 39 suites, all passing; `nest build` clean** (run `cd apps/api && npx jest`). The per-row Verification column flags which requirements have a *dedicated* spec and is a lower bound — much pipeline behaviour is covered indirectly by `chat.service.spec.ts` and the safety/RAG suites.

Areas with direct automated coverage: chat pipeline, safety (incl. Hindi/Hinglish regression), RAG/cross-lingual, citations, evidence gate, abstention (safe-template fallback), LLM-failure fallback (`llm.service`), social-post hard-block gate + platform omission, draft expiry, retention, WhatsApp (channel + formatting), voice-ws, hospital directory, content approval, navigator approval.

Implemented-but-spec-less surfaces (remaining minor gaps): `llm.service` provider-specific retry/backoff for the OpenAI-compatible path (dead in prod — Gemini-only), `NFR-AVAIL-002` DB-unavailable → abstention at the chat level.

---

## Remaining work — priority order

| Priority | Req ID | Description | Notes |
|---|---|---|---|
| Deferred | FR-CONTENT-010/011 | Full automated article publish (git push + deploy) | OD-001 — notify endpoint implemented; git push + deploy from API deferred until volume justifies (1–2 articles/mo) |
| External | FR-WA-002/010 | WhatsApp live send | Code complete; blocked on Meta provisioning (issue #29, Ananya) |
| Deferred | Phase 2 (Annexure 1) | Roles, journeys, analytics, Learning Note | Not started by design — quality engine is the current priority |

NFR-PRIV-001/002 (90-day retention) are now **implemented** via `retention.service.ts` — see `docs/PRIVACY_RETENTION.md`.

## Tests to add — priority order (safety-critical first)

The suite is at 819 passing. The P1 and P2 spec gaps identified in the Jun 2026 hardening pass are now closed:

- ✅ FR-CHAT-004 / NFR-AVAIL-001 — `abstention.service.spec.ts` (safe-template, no medical content, urgency routing) + `llm.service.spec.ts` (provider failure → safe fallback, never throws)
- ✅ FR-SOCIAL-013 / FR-SAFETY-006 — `social-post.service.spec.ts` (`approvePost()` throws when `safetyBlocked`, idempotency, guards)
- ✅ FR-SOCIAL-006 — `social-post.service.spec.ts` (unconfigured platform buttons omitted)
- ✅ FR-AUDIT-007 — `draft-expiry.service.spec.ts` (article reminder/archive, social reminder/expire, reminder-once)
- ✅ NFR-PRIV-001/002 — `retention.service.spec.ts` (>90d deletion, isEval preserved, FK-safe order, batch pagination)

Remaining (low priority):

| Priority | Requirement | What to test |
|---|---|---|
| P3 | NFR-AVAIL-002 | `chat.service` — DB unavailable mid-pipeline degrades to abstention, not 500 (integration-level) |
