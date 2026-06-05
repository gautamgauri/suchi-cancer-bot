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
| FR-CHAT-004 | LLM failure → abstention | `AbstentionService`; catch in `LlmService` | No test | Implemented | Untested |
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
| FR-CONTENT-007 | `approvedBy` captures reviewer name (not "email_approval") | **Not implemented** — hardcoded `"email_approval"` (OD-006) | — | Missing | — |
| FR-CONTENT-008 | Rejection updates GCS status | `queue-manager.ts` `updateStatus()` | No test | Implemented | Untested |
| FR-CONTENT-009 | Approval endpoints idempotent | **Not implemented** — no duplicate-click guard | — | Missing | — |
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
| FR-HOSP-007 | Approvals capture reviewer name | **Not implemented** (OD-006) | — | Missing | — |
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
| FR-SOCIAL-006 | Only configured platforms shown in email | **Not implemented** — all buttons always shown (OD-008) | — | Missing | — |
| FR-SOCIAL-007 | First-click-wins idempotency | `approvePost()` status guard | Manual only | Implemented | Manual only |
| FR-SOCIAL-008 | `approvedBy` captures reviewer name | `?approver=` param; stored in queue | Manual only | Implemented | Manual only |
| FR-SOCIAL-009 | Approval triggers immediate publish | `approvePost()` → `publishPost()` | Manual only | Implemented | Manual only |
| FR-SOCIAL-010 | Published status with platform breakdown | `social-queue.json` `approvedPlatforms`, `failedPlatforms` | Manual only | Implemented | Manual only |
| FR-SOCIAL-011 | Platform failure doesn't block others | `Promise.allSettled()` in publish loop | No test | Implemented | Untested |
| FR-SOCIAL-012 | Confirmation email to team after publish | `sendConfirmationEmail()` | Manual only | Implemented | Manual only |
| FR-SOCIAL-013 | Critical-severity = hard block (403) | **Not implemented** — advisory only (OD-004) | — | Missing | — |

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
| FR-SAFETY-006 | Social posts: critical categories are hard blocks | **Not implemented** — advisory only (OD-004) | — | Missing | — |
| FR-SAFETY-007 | Safety events persisted | `safetyEvent` table | No test | Implemented | Untested |

---

## Non-Functional Requirements

| Req ID | Description | Implementation | Verification | Impl. Status | Verif. Status |
|---|---|---|---|---|---|
| NFR-PERF-001 | P50 <8s, P95 <20s chat latency | 45s budget; Gemini API | Langfuse traces (spot check) | Partial | Manual only |
| NFR-PERF-002 | Emergency <1s | Synchronous regex, no async | No test | Implemented | Untested |
| NFR-PERF-003 | STT <5s for 30s audio | Google STT v2 | Manual only | Partial | Manual only |
| NFR-PERF-004 | 45s budget; 10s buffer vs Cloud Run 55s timeout | 45s budget enforced; Cloud Run config | No test | Implemented | Untested |
| NFR-AVAIL-001 | LLM failure → safe template | `AbstentionService` fallback | No test | Implemented | Untested |
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
| FR-AUDIT-005 | Hospital approvals with reviewer name + timestamp | **Not implemented** (OD-006) | — | Missing | — |
| FR-AUDIT-006 | GCS queues consistent with API state | Queue updated atomically in service layer | No test | Implemented | Untested |
| FR-AUDIT-007 | Draft expiry + reminder emails | **Not implemented** — no expiry or reminder logic (OD-007) | — | Missing | — |

---

## Coverage Summary

| Category | Total Reqs | Implemented | Partial | Missing |
|---|---|---|---|---|
| Chat | 19 | 19 | 0 | 0 |
| Voice | 6 | 6 | 0 | 0 |
| Content Pipeline | 12 | 10 | 1 | 1 |
| Hospital Directory | 8 | 5 | 1 | 2 |
| Social Publishing | 13 | 9 | 0 | 4 |
| Admin + Review | 4 | 3 | 0 | 0 (1 N/A) |
| Safety | 7 | 5 | 0 | 1 |
| Non-Functional | 14 | 11 | 3 | 0 |
| Audit | 7 | 5 | 0 | 2 |
| **Total** | **90** | **73** | **5** | **10** |

### Verification coverage (implementation-status ≥ Partial)

| Verification status | Count |
|---|---|
| Tested (automated) | 5 |
| Manual only | 25 |
| Untested | 52 |
| N/A | 1 |

Only 5 of 83 implemented/partial requirements have automated tests. This is the main risk for a health-information service.

---

## Missing requirements — priority order

| Priority | Req ID | Description | Notes |
|---|---|---|---|
| P1 | FR-CONTENT-010/011 | Full automated article publish (git push + deploy) | OD-001 partial — notify endpoint implemented, git push deferred |
| P2 | NFR-PRIV-001 | 90-day PostgreSQL retention job for messages/sessions | See `docs/PRIVACY_RETENTION.md` |
| P2 | NFR-PRIV-002 | 1-year retention for safety events + feedback | See `docs/PRIVACY_RETENTION.md` |

## Tests to add — priority order (safety-critical first)

All P0/P1/P2 tests from the original list are now implemented (250 passing). Remaining gaps:

| Priority | Requirement | What to test |
|---|---|---|
| P2 | FR-AUDIT-007 | Draft expiry service: articles archived at 30d, reminded at 48h |
| P2 | FR-CONTENT-010 | notify-publish endpoint returns correct approved slugs |
