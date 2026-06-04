# Requirements Traceability Matrix

Maps each requirement from `REQUIREMENTS.md` to its implementation location and test coverage.

**Status key:** `Implemented` · `Partial` · `Missing` · `Not Required`

---

## Chat Requirements

| Req ID | Description | Implementation | Test | Status |
|---|---|---|---|---|
| FR-CHAT-001 | 9-phase pipeline, no phase skipped | `chat/chat.service.ts` `handle()` | `chat.service.spec.ts` | Implemented |
| FR-CHAT-002 | 45s request budget | `LLM_TIMEOUT_MS` env var; Cloud Run timeout 55s | — | Implemented |
| FR-CHAT-003 | Emergency fast path <1ms | `chat.service.ts` `evaluateEmergencyFastPath()` | — | Implemented |
| FR-CHAT-004 | LLM fallback to abstention | `AbstentionService`; catch in `LlmService` | — | Implemented |
| FR-CHAT-005 | Safety gate before RAG/LLM | Phase 2 in `chat.service.ts`; `SafetyService.evaluate()` | — | Implemented |
| FR-CHAT-006 | Safety events persisted | `safetyEvent` table; `SafetyService` | — | Implemented |
| FR-CHAT-007 | Auto-refuse diagnosis/prescription | `SafetyService` + `SUCHI_SAFETY_CONTRACT.md` | — | Implemented |
| FR-CHAT-008 | Medical claims grounded in KB | `EvidenceGateService`; LLM prompt instructs citation-only | — | Implemented |
| FR-CHAT-009 | Min evidence thresholds | `EvidenceGateService`; thresholds in `SUCHI_SAFETY_CONTRACT.md` | — | Implemented |
| FR-CHAT-010 | Abstention when evidence insufficient | `AbstentionService.generateAbstentionResponse()` | — | Implemented |
| FR-CHAT-011 | Only trusted KB sources used | `isTrustedSource` filter in `RagService` | — | Implemented |
| FR-CHAT-012 | Citation repair ≥2 citations | `CitationService.repairCitations()` | — | Implemented |
| FR-CHAT-013 | Citations not shown inline in chat prose | Frontend renders `[1]` as collapsible sources | — | Implemented |
| FR-CHAT-014 | Voice strips citation markers | `stripForVoice()` in Phase 9 | — | Implemented |
| FR-CHAT-015 | Session stores cancerType/emotionalState | `PatientStateService`; `session` table | — | Implemented |
| FR-CHAT-016 | Session cache 60s TTL | `PatientStateService` cache | — | Implemented |
| FR-CHAT-017 | Intent routing 6 categories | `agentic-intent-router.ts` `classifyAgenticIntent()` | — | Implemented |
| FR-CHAT-018 | hospital_search routes to planner stack | `ExecutionPlannerService` → `PlanExecutorService` | — | Implemented |
| FR-CHAT-019 | "therapy" alone ≠ PSYCHOSOCIAL | `PSYCHOSOCIAL_PATTERNS` in `agentic-intent-router.ts` | — | Implemented |
| FR-CHAT-020 | Hindi/Hinglish cross-lingual expansion | `CrossLingualService` | — | Implemented |

---

## Voice Requirements

| Req ID | Description | Implementation | Test | Status |
|---|---|---|---|---|
| FR-VOICE-001 | Max 2MB audio, max 60s | `VOICE_MAX_AUDIO_SIZE_BYTES`, `VOICE_MAX_AUDIO_DURATION_SEC` | — | Implemented |
| FR-VOICE-002 | STT v2 with phrase adaptation | `STT_VERSION=v2`; `voice/voice.service.ts` | — | Implemented |
| FR-VOICE-003 | Transcribed text through 9-phase pipeline | `ChatService.handle()` called from `VoiceService` | — | Implemented |
| FR-VOICE-004 | TTS strips markdown + citations | `stripForVoice()` in Phase 9 | — | Implemented |
| FR-VOICE-005 | TTS stored in GCS, signed URL | `GCS_BUCKET_TTS`; signed URL in `VoiceService` | — | Implemented |
| FR-VOICE-006 | Web Speech API stutter cleanup | `cleanVoiceInput()` Phase 0 | — | Implemented |

---

## Content Pipeline Requirements

| Req ID | Description | Implementation | Test | Status |
|---|---|---|---|---|
| FR-CONTENT-001 | CONTENT_GUIDE.md 7-section structure | `content/cli.ts`; AI prompt references guide | — | Partial (OD-005 open) |
| FR-CONTENT-002 | Articles as markdown with frontmatter | `content/drafts/*.md` | — | Implemented |
| FR-CONTENT-003 | New articles added to content-queue.json | `content/queue-manager.ts` | — | Implemented |
| FR-CONTENT-004 | Review triggered by email with Approve/Reject links | `admin/content-post.service.ts` | — | Implemented |
| FR-CONTENT-005 | Approval is HMAC one-click | `/v1/admin/content/approve/:id` endpoint | — | Implemented |
| FR-CONTENT-006 | Approval updates GCS status to "approved" | `queue-manager.ts` `updateStatus()` | — | Implemented |
| FR-CONTENT-007 | approvedBy captures reviewer name | **Missing** — hardcoded `"email_approval"` (OD-006) | — | Missing |
| FR-CONTENT-008 | Rejection updates GCS status | `queue-manager.ts` `updateStatus()` | — | Implemented |
| FR-CONTENT-009 | Approval endpoints are idempotent | **Missing** — no duplicate-click guard on content endpoints | — | Missing |
| FR-CONTENT-010 | Publish writes to landing/content | `content/cli.ts publish` (manual CLI) | — | Partial (OD-001) |
| FR-CONTENT-011 | Published articles visible after suchi-web deploy | Manual process; no automation (OD-001) | — | Partial |
| FR-CONTENT-012 | Canonical lifecycle terms | **Missing** — frontmatter `review_status` and queue `status` inconsistent (OD-002) | — | Missing |

---

## Hospital Directory Requirements

| Req ID | Description | Implementation | Test | Status |
|---|---|---|---|---|
| FR-HOSP-001 | Eligibility criteria enforced | Partial — research agent prompt references criteria; no formal checklist (OD-010) | — | Partial |
| FR-HOSP-002 | Hospital score 0–100 | `hospitals.json` schema includes `score` | — | Implemented |
| FR-HOSP-003 | Deduplication before adding to hospitals.json | `navigator-approve.service.ts` dedup check | `navigator-approve.service.spec.ts` | Implemented |
| FR-HOSP-004 | Review email with portal link | `navigator-approve.service.ts` email | — | Implemented |
| FR-HOSP-005 | Portal allows inline editing | Navigator review portal | — | Implemented |
| FR-HOSP-006 | Approval writes to hospitals.json | `navigator-approve.service.ts` | `navigator-approve.service.spec.ts` | Implemented |
| FR-HOSP-007 | Approvals capture reviewer name | **Missing** — not implemented for navigator (OD-006) | — | Missing |
| FR-HOSP-008 | Hospital search queries hospitals.json | `HospitalDirectoryService` | `hospital-directory.service.spec.ts` | Implemented |

---

## Social Publishing Requirements

| Req ID | Description | Implementation | Test | Status |
|---|---|---|---|---|
| FR-SOCIAL-001 | Social copy via Gemini generateRaw() | `admin/social-post.service.ts` | — | Implemented |
| FR-SOCIAL-002 | Posts added to social-queue.json | `social-post.service.ts` | — | Implemented |
| FR-SOCIAL-003 | Safety gate before approval email | `social-post.service.ts` safety check | — | Implemented |
| FR-SOCIAL-004 | Approval email with copy + safety banner | `sendApprovalEmail()` | — | Implemented |
| FR-SOCIAL-005 | 3 individual emails with others in CC | `sendApprovalEmail()` (Gautam/Divya/Nisha) | — | Implemented |
| FR-SOCIAL-006 | Only configured platforms shown in email | **Missing** — all platform buttons always shown (OD-008) | — | Missing |
| FR-SOCIAL-007 | First-click-wins idempotency | `approvePost()` status guard | — | Implemented |
| FR-SOCIAL-008 | approvedBy captures reviewer name | `?approver=` param; stored in queue | — | Implemented |
| FR-SOCIAL-009 | Approval triggers immediate publish | `approvePost()` → `publishPost()` | — | Implemented |
| FR-SOCIAL-010 | Published status with platform breakdown | `social-queue.json` `approvedPlatforms`, `failedPlatforms` | — | Implemented |
| FR-SOCIAL-011 | Platform failure doesn't block others | `Promise.allSettled()` in publish loop | — | Implemented |
| FR-SOCIAL-012 | Confirmation email to team after publish | `sendConfirmationEmail()` | — | Implemented |
| FR-SOCIAL-013 | Critical-severity safety = hard block (403) | **Missing** — banner is advisory only (OD-004) | — | Missing |

---

## Admin and Review Requirements

| Req ID | Description | Implementation | Test | Status |
|---|---|---|---|---|
| FR-ADMIN-001 | Basic Auth on all /v1/admin/* | `BasicAuthGuard` applied to admin module | — | Implemented |
| FR-ADMIN-002 | Approval endpoints use HMAC only | `/approve/:id` and `/reject/:id` use HMAC token | — | Implemented |
| FR-ADMIN-003 | Secrets in Secret Manager | All secrets via `--set-secrets` in `cloudbuild.yaml` | — | Implemented |
| FR-ADMIN-004 | Basic Auth accepted; re-evaluate trigger documented | OD-009 in `OPEN_DECISIONS.md` | — | Documented |

---

## Safety Requirements

| Req ID | Description | Implementation | Test | Status |
|---|---|---|---|---|
| FR-SAFETY-001 | SafetyModule registered; no bypass patterns | `app.module.ts`; preflight Check 6 | — | Implemented |
| FR-SAFETY-002 | Emergency fast path before any DB/network call | Phase 1 runs synchronously in `handle()` | — | Implemented |
| FR-SAFETY-003 | Never diagnose, prescribe, or guarantee outcomes | `SafetyService` + LLM system prompt | — | Implemented |
| FR-SAFETY-004 | Only trusted KB sources | `isTrustedSource: true` filter in `RagService` | — | Implemented |
| FR-SAFETY-005 | Disclaimer on all medical responses | `appendDisclaimer()` Phase 9 | — | Implemented |
| FR-SAFETY-006 | Social posts: critical categories are hard blocks | **Missing** — advisory only (OD-004) | — | Missing |
| FR-SAFETY-007 | Safety events persisted | `safetyEvent` table | — | Implemented |

---

## Non-Functional Requirements

| Req ID | Description | Implementation | Verified | Status |
|---|---|---|---|---|
| NFR-PERF-001 | P50 <8s, P95 <20s chat latency | 45s budget; Gemini API | Langfuse traces | Partial |
| NFR-PERF-002 | Emergency <1s | Synchronous regex, no async | — | Implemented |
| NFR-PERF-003 | STT <5s for 30s audio | Google STT v2 | — | Partial |
| NFR-PERF-004 | 10s buffer vs Cloud Run timeout | 45s budget vs 55s timeout | — | Implemented |
| NFR-AVAIL-001 | LLM failure → safe template | `AbstentionService` fallback | — | Implemented |
| NFR-AVAIL-002 | DB unavailable → abstention | Error handling in `RagService` | — | Partial |
| NFR-AVAIL-003 | Approval pipeline idempotent | Social: implemented. Content: missing. | — | Partial |
| NFR-SCALE-001 | Stateless API | Session in PostgreSQL | — | Implemented |
| NFR-SEC-001 | Secrets in Secret Manager | `cloudbuild.yaml` `--set-secrets` | Preflight Check 3 | Implemented |
| NFR-SEC-002 | HMAC approval tokens | `crypto.createHmac()` in approval services | — | Implemented |
| NFR-SEC-003 | HTTPS only | Cloud Run enforces HTTPS | — | Implemented |
| NFR-SEC-004 | Rate limiting | `ThrottlerModule` in `app.module.ts` | — | Implemented |
| NFR-OBS-001 | Per-request Langfuse tracing | `ObservabilityService` in each phase | — | Implemented |
| NFR-OBS-002 | LLM call duration + tokens recorded | `ObservabilityService.endGeneration()` | — | Implemented |
| NFR-OBS-003 | Safety events logged at WARN+ | `this.logger.warn()` in safety paths | — | Implemented |

---

## Audit Requirements

| Req ID | Description | Implementation | Test | Status |
|---|---|---|---|---|
| FR-AUDIT-001 | Conversations in PostgreSQL | `conversation` + `message` tables | — | Implemented |
| FR-AUDIT-002 | Safety events in safetyEvent table | `SafetyService` | — | Implemented |
| FR-AUDIT-003 | Article actions with reviewer name + timestamp | **Partial** — timestamp stored; reviewer name missing (OD-006) | — | Partial |
| FR-AUDIT-004 | Social post actions with reviewer name + timestamp | `social-queue.json` `approvedBy`, `approvedAt` | — | Implemented |
| FR-AUDIT-005 | Hospital approvals with reviewer name + timestamp | **Missing** (OD-006) | — | Missing |
| FR-AUDIT-006 | GCS queues consistent with API state | Queue updated atomically in service layer | — | Implemented |
| FR-AUDIT-007 | Draft expiry + reminder emails | **Missing** — no expiry or reminder logic (OD-007) | — | Missing |

---

## Coverage Summary

| Category | Total Reqs | Implemented | Partial | Missing |
|---|---|---|---|---|
| Chat | 20 | 20 | 0 | 0 |
| Voice | 6 | 6 | 0 | 0 |
| Content Pipeline | 12 | 7 | 3 | 2 |
| Hospital Directory | 8 | 5 | 1 | 2 |
| Social Publishing | 13 | 9 | 0 | 4 |
| Admin + Review | 4 | 3 | 0 | 0 (1 documented) |
| Safety | 7 | 5 | 0 | 1 |
| Non-Functional | 14 | 11 | 3 | 0 |
| Audit | 7 | 3 | 1 | 3 |
| **Total** | **91** | **69** | **8** | **12** |

### Missing requirements (priority order)

| Req ID | Description | OD ref |
|---|---|---|
| FR-SOCIAL-013 | Social post critical-severity = hard block | OD-004 |
| FR-SAFETY-006 | Social post hard blocks enforced | OD-004 |
| FR-CONTENT-007 | Content approval captures reviewer name | OD-006 |
| FR-HOSP-007 | Hospital approval captures reviewer name | OD-006 |
| FR-AUDIT-005 | Hospital audit trail | OD-006 |
| FR-CONTENT-009 | Content approval endpoint idempotency | — |
| FR-SOCIAL-006 | Hide unconfigured platform buttons | OD-008 |
| FR-AUDIT-007 | Draft expiry + reminders | OD-007 |
| FR-CONTENT-012 | Canonical lifecycle terms | OD-002 |
| FR-AUDIT-003 | Article audit trail (reviewer name) | OD-006 |
| FR-CONTENT-010/011 | Automated article publish | OD-001 |
