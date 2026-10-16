# Suchi chat latency — investigation notes (#225, #221)

Started 2026-10-16 (IST evening; file dated for the 17 Oct hand-off). Read-only on GCP and production.
No patient data is quoted here; every user text below is a synthetic tier-1 eval question.

## 0. Access available to this investigation

- `gcloud run services describe` worked (read-only, via the `suchi-scheduler` service account already configured in gcloud).
- `gcloud logging read` and Cloud Monitoring did **not** work: the owner's user credential needs an interactive `gcloud auth login`, and the service account has no log-view permission. **Per-stage timings from Cloud Run logs could not be pulled in this session.** The log evidence quoted below comes from the 14 Oct investigation already recorded on #225.
- No DB session (no `EXPLAIN ANALYZE` from here).

## 1. Live service config (`suchi-api`, revision `suchi-api-00429-zzn`, 100% traffic)

| setting | value |
|---|---|
| CPU / memory | 1 vCPU / 512 Mi |
| CPU allocation | always (`cpu-throttling: false`) |
| startup CPU boost | on |
| min instances | **0** (no `minScale` annotation) |
| max instances | 2 (#217) |
| container concurrency | **80** |
| request timeout | 300 s |
| startup probe | TCP :8080, period/timeout 240 s, failureThreshold 1 |
| `LLM_TIMEOUT_MS` | 45000 |
| LLM model | `gemini-2.5-flash` (no `GEMINI_MODEL` env; code default), thinking budget 512 tokens |
| DB | Cloud SQL `suchi-db`, resized f1-micro → **g1-small** on 15 Oct 00:27 IST |
| Prisma pool | `connection_limit=5`, `pool_timeout=10` per instance (prisma.service.ts default; secret also carries 5 per #217) |

Drift found: `cloudbuild.gated.yaml` still deploys `--max-instances 10` and has no `--timeout`; `cloudbuild.yaml` has 2 and 300 s.
Other tagged revisions with 0% traffic: `candidate` (00411), `flashlite` (00459).

## 2. What the 14 Oct 504s were (already established on #225)

- Prisma pool exhaustion (`connection limit: 5`, `pool timeout: 10`), session create failing at 2 × 10 s, health check failing the same way.
- Held by slow vector queries: `dbMs` 3–46 s under concurrency vs 50–100 ms alone.
- Underlying cause: `suchi-db` db-f1-micro (0.6 GB) at 100 % memory for a week; the 181 MB HNSW index could not stay cached.
- Fixed by the 15 Oct resize to g1-small. The manual eval run 38631304541 (14 Oct 20:21 UTC) answered every turn; `dbMs` median 186 ms, max 396 ms.

## 3. Post-fix state (verified 2026-10-16)

- Nightly tier-1 runs on 15 Oct (38697627239, 19.6 min) and 16 Oct (38864420259, 18.8 min) **completed** inside the 45-min limit. Both are red on quality (16/21), not on infrastructure.
- Read-only sequential probe from a laptop in India, 8 turns, one at a time, each in its own session, using the tier-1 eval's own synthetic questions (same as the nightly eval does):

```
health 200 887ms
sessions: 201 in 483–804 ms
chat:     all 201 — 9.4, 11.2, 12.0, 17.0, 17.8, 18.0, 19.7, 26.9 s
n=8 p50=17.0 s  p95/max=26.9 s  over 55 s = 0
```

So the "34 of 39 turns 504" state is gone. What remains:
1. A 9–27 s turn, warm, single user. Slow for a judge but inside budget.
2. Structural traps that can still turn a burst into 504s (below).
3. #221: the timeout body fabricates `safety.classification = "normal"`.

## 4. Root causes

### 4a. Primary, 14 Oct, already remediated: database memory (infrastructure)
As in section 2. `suchi-db` on db-f1-micro could not keep the 181 MB HNSW index in memory. Concurrent vector searches went to disk on a shared vCPU (`dbMs` 3–46 s). Each turn runs about three searches in parallel, so they held the 5-connection Prisma pool. Session creates, message inserts and the health check then timed out waiting for a connection. The resize on 15 Oct fixed this. Sections 3 and 6 have the evidence.

### 4b. Code: the turn budget could not protect the 55 s window (fixed in this PR)
The pipeline has a 45 s turn budget (`REQUEST_BUDGET_MS`) inside the controller's 55 s timeout (`REQUEST_TIMEOUT_MS`). Three paths escaped it:

1. **The budget clock started late.** `requestDeadlineMs` was computed *after* the session read and the user-message insert (`handleTurn`). Both are wrapped in `prismaRetry`: 3 attempts, each waiting up to `pool_timeout` = 10 s, plus 1.5 s of backoff. Under pool exhaustion that is up to ~63 s before the "45 s" budget even started. This is the mechanism that turned the 14 Oct DB stall into 504s, not graceful degrades.
2. **Three LLM regenerations were unbounded.** Identify-rubric regeneration, explain-mode RED-citation regeneration and patient-mode RED-citation regeneration called `llm.generateWithCitations` directly, not through `llmWithDeadline`. Each claimed a fresh `LLM_TIMEOUT_MS` (45 s) and could start with as little as 15 s of turn budget left.
3. **The urgent path's early retrieval had no deadline.** For urgency-indicator turns, `rag.retrieveWithMetadata` ran before the urgent reply was composed. With `dbMs` at 46 s the urgent guidance was held until the controller's 504 replaced it with the generic "try again" copy. This is the #221 shape.

### 4c. #221: a fabricated safety classification on the 504 body (fixed in this PR, no copy change)
`chat.controller.ts` hardcoded `safety: {classification: "normal", actions: []}` on every timeout.

### 4d. Config: cold starts and burst queueing (proposed; needs owner approval)
- `min-instances = 0`. After ~15 idle minutes the next visitor pays a NestJS + Prisma + hospital-directory cold start. A judge clicking the MIT Solve link is that visitor. **Cold-start duration is unmeasured**: it needs logs, which this session couldn't read. The section 6 query measures it.
- `containerConcurrency = 80` with `maxScale = 2`. Cloud Run adds an instance at roughly 60 % of the concurrency target, about 48 in-flight requests. So any realistic burst lands on one instance and its 5 DB connections. The second instance, which #217 deliberately allowed, is almost never used.

### 4e. Ruled out or not the bottleneck now
- *CPU allocated only during requests*: no. `cpu-throttling: false` is live, and startup CPU boost is on.
- *LLM timeouts with retries*: bounded in `llm.service.ts` since #168: one shared `GenerationBudget`, at most 3 attempts per call. The remaining exposure was the three unbounded call sites in 4b.
- *Unindexed vector search*: no. The plan uses `kbchunk_embedding_hnsw_idx` (#225, 15 Oct). Unverified: the cancer-type-filtered variant (`retrieveByCancerTypes`, a join filter on `KbDocument.cancerTypes`) was not EXPLAINed. Without pgvector ≥ 0.8 iterative scans, a selective filter can return fewer than LIMIT rows. That is a recall issue, not latency, and is worth one `EXPLAIN (ANALYZE, BUFFERS)`.
- *Too many sequential LLM calls*: the normal informational turn makes **one** Gemini generation (`explain-mode-llm1`). Regeneration happens only on rubric or citation failure. Embedding plus three parallel vector searches plus FTS come before it. The 9–27 s warm latency is therefore dominated by one `gemini-2.5-flash` generation with a 512-token thinking budget and long cited answers. This was inferred from code, because per-stage timings need logs. Changing the model (a `flashlite` tagged revision exists) or the prompt or answer length is clinical behaviour and **out of scope**.

## 5. Changes in the PR (branch `fix/latency-225`)

| change | file | patient-facing copy changed? |
|---|---|---|
| Turn deadline measured from `handle()` entry | chat.service.ts | no |
| Identify, citation and patient-citation regenerations go through `llmWithDeadline`; overrun → the existing budget-exhausted A3 template | chat.service.ts | no (existing degrade path) |
| Urgent early retrieval capped at 8 s; overrun → continue without chunks, as it already does when that retrieval throws | chat.service.ts | no (existing path) |
| `TurnProgress` records the safety stage's real verdict; the 504 body reports it, or `safetyAssessed: false`; no escalation actions attached | chat.service.ts, chat.controller.ts | no (copy pinned by test) |
| `--min-instances 1`, `--concurrency 20`, `--cpu-boost` (simple pipeline); gated pipeline drift fixed (`--max-instances 10 → 2`, `--timeout 300`) with min 0 for the no-traffic candidate | cloudbuild.yaml, cloudbuild.gated.yaml | no |

Tests: `chat.service.turn-deadline.spec.ts` (5) and `chat.controller.timeout.spec.ts` (6). The 3 behavioural regressions **fail against the pre-fix service** and pass after. Full API suite: `capped npx jest --runInBand` → 94 suites, 2059 passed, 1 skipped. `tsc --noEmit` clean.

Web client impact of the #221 change: `apps/web/src/services/api.ts` already defaults a missing `safety` to normal, so `safetyAssessed: false` renders exactly as before. A reported `red_flag` with `actions: []` neither shows nor clears a banner.

## 6. Config to apply (owner approval), exact commands

Live now, without waiting for a deploy (creates a new revision from the current image):

```bash
gcloud run services update suchi-api \
  --project gen-lang-client-0202543132 --region us-central1 \
  --min-instances 1 --concurrency 20 --cpu-boost
# revert the spend at any time:
gcloud run services update suchi-api --project gen-lang-client-0202543132 --region us-central1 --min-instances 0
```

**Cost** (Cloud Run us-central1, instance-based billing because CPU is always allocated; list price US$0.000018/vCPU-s and US$0.000002/GiB-s): one 1 vCPU / 0.5 GiB instance for 730 h comes to about US$47.3 + US$2.6 ≈ **US$50 a month, about ₹4,200 at ₹84/US$**. That is a ceiling: hours when an instance is already up for traffic or the nightly eval are billed today anyway, and any unused free tier (240k vCPU-s) comes off it. `--concurrency 20` and `--cpu-boost` cost nothing extra. Cheaper option: keep min 1 only through the MIT Solve judging window, then revert.

Not recommended now: raising `--max-instances`. g1-small allows more connections than f1-micro's 25. Its exact `max_connections` is unverified here; check it before relaxing #217's cap.

## 7. Verification after deploy (exact)

1. One tier-1 run against production (the existing nightly suite, nothing extra):
   `gh workflow run eval-tier1.yml -R gautamgauri/suchi-cancer-bot`, or wait for the 02:00 UTC schedule.
2. Per-turn latency for that run's window:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="suchi-api" AND logName:"requests" AND httpRequest.requestMethod="POST" AND httpRequest.requestUrl:"/v1/chat" AND timestamp>="<run start UTC>" AND timestamp<="<run end UTC>"' \
     --project gen-lang-client-0202543132 --format='value(httpRequest.status,httpRequest.latency)'
   ```
   **Success: fewer than 5 % of turns over the 45 s budget and zero 504s. Target p95 < 30 s.**
3. Degrades are visible, not silent: `jsonPayload.message:"Request budget exhausted"` or `textPayload:"early RAG exceeded"`. Count them: they are graceful templates, not 504s.
4. Cold start: with min 1 there should be no `Starting new instance` log on the first request after a quiet hour. Before applying, measure one with `textPayload:"Nest application successfully started"` against the container start time.

Sequential probe used for the section 3 baseline (8 turns, tier-1 questions, one at a time). It is the same kind of traffic the nightly eval sends: `node probe.js <api-url> 8`. The script is in the PR description.

## 8. Requires SCCF review (not done here)

- **Urgent guidance on a timed-out urgent turn.** With this PR, an urgency-flagged turn should no longer reach the 504 at all: 8 s retrieval cap, 15 s urgent LLM cap, then persistence. If it still does (DB writes stalled), the 504 body now says `red_flag` but still shows the generic "try again" copy. Proposal for SCCF: on a 504 whose `progress.safety` is `red_flag`/`self_harm`, serve the already-approved S2/safety escalation text and banner instead. That changes what a patient sees, so **REQUIRES SCCF REVIEW** (P1-11).
- Whether "new hard lump … is this an emergency?" should be `red_flag` is a safety-keyword question (#221 out-of-scope note, P1-14) and is untouched.

## 9. Follow-ups found (not fixed here)

- The emergency fast path (pure regex) runs *after* the session read and user-message insert, so a DB stall delays even the fastest escalation. Moving the evaluation earlier touches safety ordering (AGENTS §1.1) and needs a deliberate decision.
- When the controller gives up, the pipeline keeps running and keeps holding pool connections; its queries carry no `statement_timeout`. A per-query `SET LOCAL statement_timeout` on retrieval would free connections. Low priority now that `dbMs` is ~200 ms.
- Main-path retrieval has no deadline of its own. It is bounded only indirectly, because the LLM stage refuses to start with < 15 s left.
- Eval client `retries: 4` with backoff amplifies a degraded backend (#225 item 4).
