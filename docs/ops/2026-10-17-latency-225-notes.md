# Suchi chat latency: investigation notes (#225, #221)

Started 2026-10-16. Read-only on GCP and production.
No patient data is quoted here. Every user text referred to is a synthetic tier-1 eval question.

This file keeps the findings that explain the code changes in the pull request for #225 and #221. Live service settings, capacity figures and load detail are kept out of it because the repository is public. Cloud Run settings are not changed by that pull request.

## 1. What the 14 Oct 504s were (already established on #225)

- The Prisma connection pool was exhausted. Session creates and the health check failed while waiting for a connection.
- The pool was held by slow vector queries. `dbMs` ran from 3 to 46 s under concurrency against 50 to 100 ms alone.
- The underlying cause was database memory. The HNSW index could not stay cached. A database resize on 15 Oct fixed it. A manual eval run on 14 Oct after the resize answered every turn, with a median `dbMs` of 186 ms and a maximum of 396 ms.

## 2. State after the database fix (verified 2026-10-16)

- The nightly tier-1 runs on 15 and 16 Oct completed inside the 45-minute limit. Both were red on answer quality. Neither failed on infrastructure.
- A read-only sequential probe sent 8 tier-1 eval questions one at a time, each in its own session. Every chat turn returned 201. The times were 9.4, 11.2, 12.0, 17.0, 17.8, 18.0, 19.7 and 26.9 s, so p50 was 17.0 s and none went over 55 s.

What remained was a slow but in-budget turn for a single user, structural gaps in the code that could still turn a database stall into 504s (section 3), and #221 (section 4).

## 3. Code: the turn budget could not protect the 55 s window (fixed in the PR)

The pipeline has a 45 s turn budget (`REQUEST_BUDGET_MS`) inside the controller's 55 s timeout (`REQUEST_TIMEOUT_MS`). Three paths escaped it.

1. **The budget clock started late.** `requestDeadlineMs` was computed after the session read and the user-message insert in `handleTurn`. Both are wrapped in `prismaRetry`, with 3 attempts that can each wait for the pool timeout, plus backoff. Under pool exhaustion that could pass the 55 s window before the turn budget even started. This is the mechanism that turned the 14 Oct database stall into 504s instead of graceful degrades.
2. **Three LLM regenerations were unbounded.** The identify-rubric regeneration, the explain-mode citation regeneration and the patient-mode citation regeneration called `llm.generateWithCitations` directly, outside `llmWithDeadline`. Each claimed a fresh `LLM_TIMEOUT_MS` (45 s) and could start with as little as 15 s of turn budget left.
3. **The urgent path's early retrieval had no deadline.** For urgency-indicator turns, `rag.retrieveWithMetadata` ran before the urgent reply was composed. With `dbMs` at 46 s the urgent guidance was held until the controller's 504 replaced it with the generic "try again" copy. This is the #221 shape.

## 4. #221: a fabricated safety classification on the 504 body (fixed in the PR, no copy change)

`chat.controller.ts` hardcoded `safety: {classification: "normal", actions: []}` on every timeout. A turn cut off before any safety screen had concluded was reported as assessed normal.

## 5. Ruled out or not the bottleneck now

- *LLM timeouts with retries*: bounded in `llm.service.ts` since #168, with one shared `GenerationBudget` and at most 3 attempts per call. The remaining exposure was the three unbounded call sites in section 3.
- *Unindexed vector search*: no. The plan uses `kbchunk_embedding_hnsw_idx`. The cancer-type-filtered variant (`retrieveByCancerTypes`) was not EXPLAINed. Without pgvector 0.8 iterative scans, a selective filter can return fewer than LIMIT rows. That is a recall question and is worth one `EXPLAIN (ANALYZE, BUFFERS)`.
- *Too many sequential LLM calls*: a normal informational turn makes one Gemini generation. Regeneration happens only on rubric or citation failure. The 9 to 27 s latency for a single user is therefore dominated by that one generation. This was inferred from code, because per-stage timings need logs. Changing the model, the prompt or the answer length is clinical behaviour and out of scope.

## 6. Changes in the PR (branch `fix/latency-225`)

| change | file | patient-facing copy changed? |
|---|---|---|
| Turn deadline measured from `handle()` entry | chat.service.ts | no |
| Identify, citation and patient-citation regenerations go through `llmWithDeadline`. An overrun gives the existing budget-exhausted A3 template | chat.service.ts | no (existing degrade path) |
| Urgent early retrieval capped at 8 s. An overrun continues without chunks, as it already does when that retrieval throws | chat.service.ts | no (existing path) |
| `TurnProgress` records the safety stage's real verdict. The 504 body reports it, or `safetyAssessed: false`. No escalation actions are attached | chat.service.ts, chat.controller.ts | no (copy pinned by test) |
| The web client keeps a 504 body without `safety` as "not assessed" and does not fill in "normal" | apps/web/src/services/api.ts | no |

## 7. Requires SCCF review (not done here)

- **Urgent guidance on a timed-out urgent turn.** With the PR, an urgency-flagged turn should no longer reach the 504. It has an 8 s retrieval cap and a 15 s urgent LLM cap before persistence. If it still does (database writes stalled), the 504 body now says `red_flag` but still shows the generic "try again" copy. The proposal for SCCF is that on a 504 whose `progress.safety` is `red_flag` or `self_harm`, serve the already-approved S2 or safety escalation text and banner. That changes what a patient sees, so it **requires SCCF review** (P1-11).
- Whether "new hard lump, is this an emergency?" should be `red_flag` is a safety-keyword question (#221 out-of-scope note, P1-14) and is untouched.

## 8. Follow-ups found (not fixed here)

- The emergency fast path (pure regex) runs after the session read and user-message insert, so a database stall delays even the fastest escalation. Moving it earlier touches safety ordering (AGENTS section 1.1) and needs a considered decision.
- When the controller gives up, the pipeline keeps running and keeps holding pool connections. Its queries carry no `statement_timeout`. A per-query `SET LOCAL statement_timeout` on retrieval would free connections. Low priority while `dbMs` is around 200 ms.
- Main-path retrieval has no deadline of its own. It is bounded only indirectly, because the LLM stage refuses to start with less than 15 s left.
- The eval client's `retries: 4` with backoff amplifies a degraded backend (#225 item 4).
