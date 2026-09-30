# AI safety classifier — Phase 1 (shadow mode)

**Proposal:** #197. **Status:** shadow mode only, **off by default**. Enforcing mode (Phase 2) is not
built and **requires SCCF clinical sign-off**.

## What it is

Red-flag detection is rule-based: the emergency fast path
(`safety/emergency-fast-path.ts`), `SafetyService` (`safety.rules.ts`) and
`AbstentionService.hasUrgencyIndicators`. The rules are fast, deterministic and
hard to talk out of escalating, but they miss phrasings nobody wrote a rule
for. Issue #81, a Hinglish report of post-chemo bleeding with dizziness, is one
example.

The AI safety classifier is a Gemini call that labels each sampled inbound
message `critical | urgent | none`, with categories from a closed list and a
confidence value. In Phase 1 the verdict is **only logged**, compared with what
the rules decided, and emitted as a `safety_classifier_shadow` analytics event.

### Invariants

1. **The rules remain the gate.** The chat turn is decided exactly as before.
2. **The AI is add-only.** Even in a future Phase 2 it could only *add* an
   escalation. It can never remove, suppress or downgrade one.
3. **Shadow means shadow.** In Phase 1 the verdict never reaches the response.
   ChatService does not await the call and does not read its result. Tests
   (`chat.service.safety-classifier-shadow.spec.ts`) check that response text
   and safety classification are identical with the flag on or off, whatever
   the AI says (critical, none, timeout, garbage, error).
4. **Failure is a no-op.** A timeout, API error or unparseable output gives the
   `none` verdict with `outcome != "ok"`. It is not counted as a disagreement,
   and the rules still apply.
5. **No raw text in the event or the log.** Identifiers, enums and numbers only.

## Code map

| File | Role |
|---|---|
| `apps/api/src/modules/safety-classifier/safety-classifier.prompt.ts` | System prompt, JSON schema, closed category list, input sanitising. `SAFETY_CLASSIFIER_PROMPT_VERSION`. |
| `apps/api/src/modules/safety-classifier/safety-classifier.service.ts` | `classify()` makes one Gemini JSON-mode call with a hard timeout, validates the output with zod, and never throws. |
| `apps/api/src/modules/safety-classifier/rule-verdict.ts` | Maps the three deterministic layers onto the same scale for comparison. |
| `apps/api/src/modules/safety-classifier/safety-classifier-shadow.service.ts` | Flag, sampling, in-flight cap, comparison, and the event and log. |
| `apps/api/src/modules/llm/llm.service.ts` → `generateStructuredJson()` | Single-attempt JSON-mode call: temperature from the caller, thinking off on Flash, request aborted on timeout, nothing sent to Langfuse. |
| `apps/api/src/modules/chat/chat.service.ts` | One fire-and-forget call site, right after the emergency fast path. |

## Enabling it

Set these on the Cloud Run service (or in `.env` locally):

| Variable | Default | Meaning |
|---|---|---|
| `SAFETY_CLASSIFIER_SHADOW_ENABLED` | `false` | Only the exact value `true` (any case) turns it on. When it's off, no LLM call is made and nothing is emitted. |
| `SAFETY_CLASSIFIER_SAMPLE_RATE` | `1` | Fraction of messages classified, from 0 to 1. This is the cost lever. `0` disables all calls. |
| `SAFETY_CLASSIFIER_TIMEOUT_MS` | `3000` | Hard per-call timeout. The request is aborted and the result recorded as `outcome=timeout`. |
| `SAFETY_CLASSIFIER_MAX_IN_FLIGHT` | `16` | Concurrent-call cap. Messages over the cap are skipped and a warning is logged. |
| `SAFETY_CLASSIFIER_MODEL` | `GEMINI_MODEL` | Model override. Use a Flash-class model. |

Suggested rollout:

1. Staging: `SAFETY_CLASSIFIER_SHADOW_ENABLED=true`, `SAFETY_CLASSIFIER_SAMPLE_RATE=1`.
   Run the eval suite and check that events appear.
2. Production: start at `SAFETY_CLASSIFIER_SAMPLE_RATE=0.25`. Watch Gemini
   quota and 429s on the main answer path, because the classifier shares the
   project's Gemini quota. Raise the rate once that is clearly fine.

To roll back, set `SAFETY_CLASSIFIER_SHADOW_ENABLED=false`. No redeploy of code
is needed.

Cloud Run runs with `--no-cpu-throttling` (see `cloudbuild*.yaml`), so a
classification that finishes after the HTTP response is sent (which is typical
on the millisecond-fast emergency path) still completes and logs.

## Latency and cost (estimates, verify against current pricing)

* **Added patient-facing latency is about 0.** The call is scheduled on a later
  event-loop turn (`setImmediate`) and never awaited. The only synchronous work
  on the turn is a flag check and a random number.
* **Classifier latency:** a Flash-class model with thinking off, about 1.2k
  input tokens and about 40 output tokens is expected to take about 0.5–1.5 s at
  p50. Anything over 3 s is recorded as `timeout`. Watch the `latencyMs` and
  timeout rate in the events.
* **Tokens per call:** about 1.1k (system prompt, including the few-shot
  examples) + about 50–150 (message) input, and about 40 output.
* **Cost per classified message**, assuming list prices (paid tier) at the time
  of writing:
  * gemini-2.5-flash ($0.30/M input, $2.50/M output): about $0.0005, i.e. **about
    $0.50 per 1,000 messages**;
  * gemini-2.5-flash-lite ($0.10/M input, $0.40/M output): about $0.00015, i.e.
    **about $0.15 per 1,000 messages**.
  * Multiply by `SAMPLE_RATE`.

## The event: `safety_classifier_shadow`

This is written through `AnalyticsService.emit()` to the `AnalyticsEvent`
table, with `sessionId` in its column, the same way as the existing
`emergency_fast_path_triggered` and `safety_triggered` events. The same fields
are also written to the structured application log (`event:
"safety_classifier_shadow"`).

| Field | Meaning |
|---|---|
| `messageId` | Id of the **user** `Message` row. A reviewer with existing authorised DB access looks the text up there, under the existing 90-day retention. |
| `channel` | web / whatsapp / voice |
| `promptVersion`, `model` | Never mix metrics across these. |
| `outcome` | `ok`, `timeout`, `error` or `parse_error` |
| `latencyMs`, `timeoutMs`, `sampleRate` | |
| `ruleSeverity` | The rules' verdict on the same scale (see mapping below). |
| `ruleSources` | Which rule layers escalated: `fast_path`, `safety_rules`, `urgency_indicators` |
| `ruleLabels` | Rule and pattern identifiers that fired, e.g. `coughing_blood_en` |
| `aiSeverity`, `aiCategories`, `aiConfidence` | The AI verdict. Categories come only from the closed list. |
| `droppedCategoryCount` | Out-of-vocabulary categories the model returned. The count is recorded, never the values. |
| `disagreement` | `aiSeverity != ruleSeverity`, counted **only** when `outcome = ok` |
| `direction` | `agree`, `ai_higher`, `ai_lower` or `not_comparable` |
| `enforced` | Always `false` in Phase 1 |

The message text is never included, and neither is the model's raw output,
which can echo the user's words. Categories are constrained by the response
schema and re-filtered after parsing, so they can't carry free text. Tests
assert this (`safety-classifier-shadow.service.spec.ts`, "privacy").

How the rules map onto the scale:
- fast path `critical` / `urgent` → `critical` / `urgent`
- `SafetyService` `red_flag` or `self_harm` → `critical`
- `hasUrgencyIndicators` → `urgent`
- scope refusals → `none`

## Reading the disagreement metrics

Always filter to `outcome = 'ok'` and to a single `promptVersion`.

```sql
-- Overview by direction
SELECT payload->>'direction' AS direction, count(*)
FROM "AnalyticsEvent"
WHERE "eventName" = 'safety_classifier_shadow'
  AND payload->>'outcome' = 'ok'
  AND payload->>'promptVersion' = 'shadow-v1'
GROUP BY 1;

-- Health: outcome mix and latency
SELECT payload->>'outcome' AS outcome, count(*),
       percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'latencyMs')::int) AS p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'latencyMs')::int) AS p95_ms
FROM "AnalyticsEvent" WHERE "eventName" = 'safety_classifier_shadow' GROUP BY 1;

-- Review queue: AI would have ADDED an escalation (Phase 2 candidates)
SELECT e."createdAt", e."sessionId", e.payload->>'messageId' AS message_id,
       e.payload->>'ruleSeverity' AS rule, e.payload->>'aiSeverity' AS ai,
       e.payload->'aiCategories' AS categories, e.payload->>'aiConfidence' AS confidence
FROM "AnalyticsEvent" e
WHERE e."eventName" = 'safety_classifier_shadow'
  AND e.payload->>'outcome' = 'ok' AND e.payload->>'direction' = 'ai_higher'
ORDER BY e."createdAt" DESC;
```

A reviewer opens a message with `SELECT text FROM "Message" WHERE id = '<message_id>'`,
through the same access that already exists (see `docs/PRIVACY_RETENTION.md`).

| Metric | Definition | Why it matters |
|---|---|---|
| **AI-adds rate** | `ai_higher / ok` | How often the AI flags something the rules didn't. This is the Phase 2 behaviour change. |
| **AI-adds precision (human-reviewed)** | Of a random sample of `ai_higher` messages, the share a clinician says *should* have escalated | Is it catching real misses (#81-type) or crying wolf? |
| **Rule-miss recall proxy** | Known misses such as #81 and new eval cases that the AI catches | Direct evidence for the add-only layer. |
| **AI-lower rate** | `ai_lower / (ok with ruleSeverity ≠ none)` | AI miss rate on rule-caught emergencies. It doesn't affect behaviour, but it is a sanity check on quality. |
| **Failure rate** | Share of `timeout`, `error` and `parse_error` | Needs to be low for Phase 2 to add value. |
| **Latency p50 / p95** | `latencyMs` | Budget for an enforcing design. |
| **By channel / language** | Slice by `channel`. Language is looked up during review. | Hinglish, Bhojpuri and Maithili are the main reason for this layer. |

Suggested bar before proposing Phase 2 (for SCCF to confirm): at least 4 weeks
or at least 5,000 `ok` events, at least 100 human-reviewed `ai_higher`
messages with a precision SCCF finds acceptable, and a failure rate under 2%.

## Prompt-injection note

User text is sent between `<user_message>` tags. Any delimiter or control
markers inside it are neutralised. The system prompt says explicitly that this
content is data, not instructions. The more important protection is structural,
though. Because the classifier can only **add** escalations, a message crafted
to make the model answer "none" cannot suppress a rule escalation. In the
worst case it hides a case the AI would otherwise have *added*, which is no
worse than today. A test covers this: "an AI 'none' verdict … does not suppress
a rule escalation".

## Changing the prompt

Bump `SAFETY_CLASSIFIER_PROMPT_VERSION` whenever the prompt, schema or category
list changes. The Bhojpuri and Maithili few-shot examples need review by a
native speaker (an open question for SCCF).
