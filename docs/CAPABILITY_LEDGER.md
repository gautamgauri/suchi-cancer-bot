# Capability Ledger

**The living record of what Suchi actually does, and the proof.**

| | |
| :-- | :-- |
| Status | Living document — refresh every release |
| Verified against | **Repo `main` @ `8d15e3f`. NO PRODUCTION VERIFICATION was performed for this first edition** — no deploy, no `/v1/version` check, no prod DB read, no prod run IDs. Every row below is therefore **L1 (static/CI) at most**. Read nothing here as evidence about the deployed `suchi-api` service. |
| Test evidence | **859 tests across 43 suites, all passing; `nest build` clean.** Reproduce: `cd apps/api && npx jest`. |
| Eval evidence | `eval/cases/case-manifest.json` — **601 cases across 25 files**, manifest generated 2026-07-05. Tier-1 nightly is enforcing (a true eval failure fails CI). |
| Requirements baseline | `docs/REQUIREMENTS.md` (131 reqs) + `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md` (105 implemented / 7 partial / 18 not started, reconciled against source 2026-06-24) |
| Created | 2026-09-05, closing issue [#65](https://github.com/gautamgauri/suchi-cancer-bot/issues/65) |

> **Why this doc exists.** Suchi's intent is spread across `REQUIREMENTS.md`, `SUCHI_SAFETY_CONTRACT.md` and `SUCHI_ANSWER_POLICY.md`; its verification status lives in the traceability matrix; its release history lives in git and in memory. None of those answers *"what is built and working right now, and how do we know?"* in one place — so that claim decays into handoff notes and chat, and ends up being made from memory in a grant narrative or a deploy decision. This ledger is the single evidence-backed answer.
>
> **Its one rule:** a capability is only `Proven` if it points at something executable — **a test, an eval score, or a prod run ID**. If it cannot, it is `Partial` at best.

## Status legend

| Status | Meaning |
| :-- | :-- |
| ✅ **Proven** | Verified against a test, an eval, or a real prod run (evidence cited). |
| 🟡 **Partial** | Code exists and is plausibly working, but not verified end-to-end under the *current* pipeline this cycle. |
| 🟠 **Built, unverified** | Endpoints/services exist; no recent evidence it works. |
| ⛔ **Absent / dead** | Referenced somewhere but not wired, or schema with no live code. |

## Verification levels

The **Level** column states what class of evidence backs the row. It exists so nobody reads a green unit test as a production proof.

| Level | Meaning | Ceiling |
| :-- | :-- | :-- |
| **L1** | Static / CI — jest, `nest build`, `prisma validate` | Proves the code contract, never runtime behaviour in prod |
| **L2** | Local runtime — API on :3001, exercised with curl | Proves local behaviour only |
| **L3** | Prod read-only — health, GET endpoints, SELECT via cloud-sql-proxy | May prove deployment, availability, isolation, read-only behaviour — nothing mutating |
| **L4** | Prod mutation — only under explicit per-campaign authorisation | Functional production evidence |

**No row in this edition is above L1.** Raising a row to L2/L3/L4 requires a `testing` agent campaign, reviewed by a *separate* `evidence-reviewer` (separation of duties: the agent that produced evidence never approves its own status change).

---

## 1. Safety & refusal

The non-negotiable layer. Per `AGENTS.md` §1.3, none of this may be changed without SCCF medical review.

| Capability | Status | Level | Evidence |
| :-- | :-- | :-- | :-- |
| Safety gate runs before RAG/LLM; `safe_redirect` / `hard_refusal` terminate the pipeline | ✅ Proven | L1 | `modules/safety/safety.service.spec.ts`; pipeline ordering asserted in `modules/chat/chat.service.spec.ts` (Phase 2 precedes retrieval) |
| Emergency fast path | ✅ Proven | L1 | `modules/safety/emergency-fast-path.spec.ts` |
| Hindi / Hinglish safety detection (the `\b`-on-Devanagari class of bug) | ✅ Proven | L1 | `modules/safety/hindi-safety-regression.spec.ts` — a dedicated regression suite, written after a real escape |
| Input normalisation before keyword matching (romanised / mixed script) | ✅ Proven | L1 | `modules/safety/text-normalizer.spec.ts`, `modules/chat/intent-classifier.romanized.spec.ts` |
| Disclaimer injection by response class | ✅ Proven | L1 | `modules/safety/disclaimer-engine.spec.ts` |
| Refusal templates are specific, not generic boilerplate | 🟡 Partial | L1 | `modules/chat/response-templates.spec.ts`. The matching eval regression fixture is **not in `main`** — it rides on PR [#59](https://github.com/gautamgauri/suchi-cancer-bot/pull/59), still open. |
| Safety events persisted to `SafetyEvent` | 🟡 Partial | L1 | Table + write path exist (`safety.service.ts`); the persistence path itself has no dedicated spec (matrix FR-CHAT-006: "No test"). Counts are now readable — see §8. |
| Refusal behaviour holds under real prod traffic | 🟠 Built, unverified | — | **Never measured in prod.** No prod safety-event review has been recorded in this repo. |

## 2. Answer grounding

| Capability | Status | Level | Evidence |
| :-- | :-- | :-- | :-- |
| Evidence gate — minimum evidence thresholds before an answer is allowed | ✅ Proven | L1 | `modules/evidence/evidence-gate.service.spec.ts` |
| Abstention when evidence is insufficient; safe template, no medical content | ✅ Proven | L1 | `modules/abstention/abstention.service.spec.ts` |
| LLM provider failure degrades to abstention, never throws | ✅ Proven | L1 | `modules/llm/llm.service.spec.ts` (provider-failure → safe fallback) |
| Citation repair / minimum citation count | ✅ Proven | L1 | `modules/citations/citation.service.spec.ts` |
| Output verification against retrieved evidence | ✅ Proven | L1 | `modules/chat/output-verifier.service.spec.ts` |
| Citations are for auditors, not users — never rendered inline in prose | 🟡 Partial | Manual | Frontend renders a collapsible section; matrix FR-CHAT-013 is "Manual only". Note the open contradiction with the `citation_format_valid` rubric — issue [#54](https://github.com/gautamgauri/suchi-cancer-bot/issues/54). |
| Retrieval quality against the gold pack | 🟡 Partial | eval | Tier-1 nightly enforcing over 601 cases. **Currently expected RED** on `RQ-LUNG-02` — a known, tracked failure (issue [#53](https://github.com/gautamgauri/suchi-cancer-bot/issues/53), bounded zero-evidence response for `SYMPTOMATIC_PATIENT`, blocked on SCCF medical review). A red nightly here is correct behaviour, not drift. |

## 3. Conversation & language

| Capability | Status | Level | Evidence |
| :-- | :-- | :-- | :-- |
| 9-phase chat pipeline, no phase skipped | ✅ Proven | L1 | `modules/chat/chat.service.spec.ts` |
| Agentic intent routing (6 product intent categories) | ✅ Proven | L1 | `modules/chat/agentic-intent-router.spec.ts`, `modules/chat/intent-classifier.spec.ts` |
| Greeting / patient-context flow | ✅ Proven | L1 | `modules/chat/greeting-flow.service.spec.ts` |
| Empathy + emotional-state detection | ✅ Proven | L1 | `modules/chat/empathy-detector.spec.ts`, `modules/chat/mode-detector.spec.ts` |
| Cross-lingual (Hindi/Hinglish) query expansion | ✅ Proven | L1 | `modules/rag/cross-lingual.service.spec.ts` |
| Response language selection | ✅ Proven | L1 | `modules/chat/utils/response-language.spec.ts` |
| Query decomposition | ✅ Proven | L1 | `modules/rag/query-decomposer.service.spec.ts` |
| Structured output templates / extraction | ✅ Proven | L1 | `modules/chat/structured-output-templates.spec.ts`, `modules/chat/structured-extractor.service.spec.ts` |

## 4. Channels

| Capability | Status | Level | Evidence |
| :-- | :-- | :-- | :-- |
| Web / PWA chat (`/v1/chat`, `/v1/sessions`) | 🟡 Partial | L1 | Pipeline specs green; the HTTP surface itself has no controller spec. Both endpoints require `channel: "web"`. |
| Voice output stripping (markdown + citation markers before TTS) | ✅ Proven | L1 | `modules/chat/voice-output-stripper.spec.ts` |
| Google STT v2 provider | ✅ Proven | L1 | `modules/voice/providers/google-stt-v2.provider.spec.ts` |
| Voice WebSocket gateway | ✅ Proven | L1 | `modules/voice-ws/voice-ws.gateway.spec.ts` |
| WhatsApp inbound/outbound + formatting | ✅ Proven | L1 | `modules/whatsapp/whatsapp.service.spec.ts`, `whatsapp.controller.spec.ts`, `whatsapp-format.spec.ts` |
| WhatsApp durable inbound record before webhook ack + cross-instance wamid de-dup | ✅ Proven | L1 | `modules/whatsapp/whatsapp.controller.spec.ts` (PR #80, `8d15e3f`) |
| WhatsApp navigator (hospital search over WA) | ✅ Proven | L1 | `modules/whatsapp-navigator/whatsapp-navigator.{controller,service}.spec.ts` |
| WhatsApp **live send** to real users | ⛔ Absent | — | Code complete, blocked on Meta provisioning (issue #29). Never exercised against a live number. |

## 5. Content, distribution & navigator pipelines

| Capability | Status | Level | Evidence |
| :-- | :-- | :-- | :-- |
| Article approval / rejection with one-click links | ✅ Proven | L1 | `modules/admin/content-approve.service.spec.ts` |
| Draft expiry (reminder → archive, reminder-once) | ✅ Proven | L1 | `modules/admin/draft-expiry.service.spec.ts` |
| Social post safety hard-block; unconfigured platforms omitted | ✅ Proven | L1 | `modules/admin/social-post.service.spec.ts` |
| Distribution controller (approve/reject API) | ✅ Proven | L1 | `modules/distribution/distribution.controller.spec.ts` |
| Navigator hospital batch approval + dedup | ✅ Proven | L1 | `modules/admin/navigator-approve.service.spec.ts` |
| Hospital directory lookup | ✅ Proven | L1 | `modules/chat/hospital-directory.service.spec.ts`, `modules/chat/execution-planner.service.spec.ts` |
| Automated article publish (git push + deploy from API) | ⛔ Absent | — | Deliberately deferred — OD-001. Notify endpoint exists; publishing is manual at 1–2 articles/month. |
| Any of these pipelines end-to-end **in production** | 🟠 Built, unverified | — | No prod run of the content, distribution or navigator pipeline is recorded in this repo. |

## 6. Admin, review & privacy

| Capability | Status | Level | Evidence |
| :-- | :-- | :-- | :-- |
| Human review queue (flag → list → mark reviewed) | 🟡 Partial | L1 | `review-queue.service.ts` + `modules/review/review.service.spec.ts`, `review-checks.spec.ts`. Queue *size* is now instrumented (§8); the flag→review→outcome loop has never been exercised on real flagged traffic. |
| Retention: >90d conversation data deleted, eval sessions preserved, FK-safe order, batched | ✅ Proven | L1 | `modules/admin/retention.service.spec.ts` — see `docs/PRIVACY_RETENTION.md` |
| Admin endpoints gated (`BasicAuthGuard`) / scheduler endpoints gated (`SchedulerOidcGuard`) | 🟡 Partial | L1 | Guards applied consistently in `admin.controller.ts`; no dedicated fail-closed spec for the admin guard itself. |
| Daily report metrics + email | 🟠 Built, unverified | — | `analytics/daily-report.service.ts` + `scripts/generate-daily-report.ts`; no spec, and no recorded prod send. |

## 7. Eval & quality engine

| Capability | Status | Level | Evidence |
| :-- | :-- | :-- | :-- |
| Tier-1 eval suite, CI-enforcing | ✅ Proven | L1 | `.github/workflows/eval-tier1.yml`; eval-vs-notification status split is itself regression-tested (`eval/ci/eval-status.test.js`, issue #47 / PR #49) |
| Case-manifest disappearance guard | ✅ Proven | L1 | Manifest pins 601 cases across 25 files; the workflow hard-fails if cases vanish |
| Per-case records + failure-cluster report + `eval-result.json` artifact | ✅ Proven | L1 | PR #52 (merged) |
| Regression fixtures for fixed P0 failures | ✅ Proven | L1 | `eval/cases/regression/p0_2026_03_26_zero_citation_stomach.yaml`, `p0_2026_07_05_lung_retrieval_miss.yaml` |
| Secret redaction in eval report artifacts | ⛔ **Not in `main`** | — | **PR [#59](https://github.com/gautamgauri/suchi-cancer-bot/pull/59) is still OPEN.** Until it merges, nightly eval artifacts still leak the DeepSeek key, and the judge model is unpinned. **Two open owner actions: merge #59, and rotate the exposed DeepSeek key.** |
| Autoresearch quality engine (failure miner → patcher → gatekeeper → archivist) | 🟠 Built, unverified | — | `eval/autoresearch/` exists; no recorded end-to-end autoresearch cycle with an accepted patch. |

## 8. Ops instrumentation

Closes issues [#61](https://github.com/gautamgauri/suchi-cancer-bot/issues/61), [#62](https://github.com/gautamgauri/suchi-cancer-bot/issues/62), [#63](https://github.com/gautamgauri/suchi-cancer-bot/issues/63), [#64](https://github.com/gautamgauri/suchi-cancer-bot/issues/64).

| Capability | Status | Level | Evidence |
| :-- | :-- | :-- | :-- |
| `active_users_7d` collector | ✅ Proven | L1 | `modules/analytics/ops-metrics.service.spec.ts`. **Reported as sessions, not distinct humans** — web/PWA carries no durable identity, so the caveat ships with the number; `distinctWhatsappContacts` is the only true per-person count. |
| `review_queue_size` collector | ✅ Proven | L1 | Same spec — asserts the queue is the *unreviewed* subset, never the flagged total |
| `safety_events_30d` collector | ✅ Proven | L1 | Same spec — type + count only; no message text, detail or session id leaves the collector |
| `tier1_eval_status` collector | 🟡 Partial | L1 | `scripts/ops-metrics.ts` reads the latest `eval-tier1.yml` conclusion via `gh`. Not unit-tested (it shells out); degrades to *unavailable*, never to a green. |
| Eval traffic excluded from every figure | ✅ Proven | L1 | Spec asserts `isEval: false` on every query. This matters more than the numbers: ~86% of `/v1/chat` traffic is the eval runner. |
| Collector reachable **in production** | 🟠 Built, unverified | — | `GET /v1/admin/ops-metrics` is **inert until deployed**. And the Ops Center's `collect_usage()` reads `~/bodh-ai-ops/manual/suchi.json` only — it has no HTTP transport — so today the script fills that file and the endpoint is the durable path for later. |

## 9. Build, deploy & schema

| Item | Status | Level | Evidence |
| :-- | :-- | :-- | :-- |
| Jest suite | ✅ Proven | L1 | 859 tests / 43 suites passing |
| `nest build` | ✅ Proven | L1 | Clean |
| API checks run on every PR | ✅ Proven | L1 | `e083d6e` (PR #76) |
| Single deployment authority — Cloud Build only | ✅ Proven | L1 | `deploy-api.yml` is build-verification only; `scripts/check_deploy_config_parity.py` fails CI on env/secret drift between the two cloudbuild files (PR #51) |
| **Prisma migration history is diverged from the live schema** | ⛔ **Known-broken** | — | **9 migrations in `apps/api/prisma/migrations/`, but the DB records only the second-oldest as applied; several tables were created out-of-band via `psql`.** Adding a migration is therefore unsafe until the history is reconciled. This is the single most load-bearing "looks wrong, is wrong" fact about this repo — it constrains every schema change. |
| Deployed revision ↔ repo SHA correspondence | 🟠 Built, unverified | — | Not checked for this edition. Traffic is pinned to a named revision, so "latest revision" ≠ "serving revision" — always verify with `/v1/version` before citing prod. |

## 10. What is explicitly NOT proven

Listing these is the point of the ledger. None may be cited as a capability.

1. **Nothing is production-proven.** This edition has no prod run ID, no `/v1/version` check, no prod DB read. Every ✅ above means "a test passes", not "it works for a user".
2. **Real-user behaviour is essentially unmeasured.** Measured 2026-09-05: `/v1/chat` served **808 requests in 30 days, of which 697 (86%) were the eval runner and roughly 10 were real humans.** Any claim about user experience, satisfaction or safety-in-the-wild rests on ~10 conversations.
3. **The safety layer has never been reviewed against real prod safety events.** §1 is CI-proven and prod-unproven.
4. **WhatsApp has never sent a message to a real user** (Meta provisioning, issue #29).
5. **The review loop has never been run on real flagged traffic** — only its unit contracts are proven.
6. **Tier-1 is currently expected RED** on `RQ-LUNG-02` (issue #53), pending SCCF medical review.
7. **Eval artifacts still leak a secret.** PR #59 (redaction + judge-model pin) is open, not merged; the exposed DeepSeek key has not been rotated.

## How to update this ledger

1. A `testing` agent runs a campaign and produces an evidence table (level, commands, artifacts, verdict). It does **not** edit this file.
2. A **separate** `evidence-reviewer` agent approves / downgrades / rejects each proposed status change.
3. Only approved changes are applied here, with the evidence string cited inline and the header's "Verified against" line updated.

Never raise a status without citing something executable. A row that cannot cite a test, an eval score, or a prod run ID is `Partial` at best — that rule is the only thing that keeps this document worth reading.
