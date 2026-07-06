# Review Copilot Runbook

This runbook documents the implemented Review Copilot behavior in `apps/api/src/modules/review` and its integration in `apps/api/src/modules/chat/chat.service.ts`.

## Intent And Scope

Review Copilot is a second-pass response reviewer that runs after response assembly and disclaimer insertion, then:
- blocks unsafe output (`BLOCKED`)
- applies deterministic fixes (`REPAIRED`)
- flags ambiguous content for human review (`FLAGGED`)
- passes clean output (`PASS`)

It is controlled by `REVIEW_COPILOT_MODE`:
- `off`: disabled fast path
- `shadow`: evaluate + log, but always deliver unchanged
- `active`: enforce block/repair behavior

## Runtime Flow (Verified)

For each assistant message, `chat.service.ts` does:
1. build final text and attach citation markers if needed
2. append disclaimer with `appendDisclaimer(...)`
3. call `reviewService.review(reviewCtx)`
4. if mode is `active`:
   - `BLOCKED` -> replace response with safe fallback text
   - `REPAIRED` -> deliver repaired text
   - `PASS` / `FLAGGED` -> deliver unchanged text
5. persist message and citations
6. asynchronously persist review record (`persistRecord`), without breaking user response on write failure

Operational implication:
- review failures do not fail the request pipeline if DB write fails; they are logged as warnings/errors.

## Implemented Checks

### Hard failures (`BLOCKED` in active mode)
- `HF-1` ungrounded medical claim (medical content with no valid citation)
- `HF-2` diagnosis language
- `HF-3` dosing/prescription language
- `HF-4` fabricated citation not found in retrieved doc/chunk IDs
- `HF-6` emergency bypass
- `HF-7` contraindicated advice

### Soft failures (`REPAIRED` when patch available and no hard failures)
- `SF-1` missing disclaimer (appends deterministic disclaimer patch)
- `SF-2` citation format error (detected only; no patch currently)
- `SF-6` excessive length > 800 words (detected only; no patch currently)

### Ambiguous flags (`FLAGGED`)
- `AF-1` over-escalation
- `AF-6` implicit diagnosis

## Public Admin API (`/v1/review/*`)

All routes require HTTP Basic Auth (`ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS`).

### List records

`GET /v1/review/records?verdict=&sessionId=&from=&to=&limit=&offset=`

Returns `{ records, total }`, sorted newest first.

### Get single record

`GET /v1/review/records/:id`

### Human review queue

`GET /v1/review/queue?limit=&offset=`

Returns records with `humanReviewStatus = "PENDING"` sorted oldest first.

### Submit human decision

`PATCH /v1/review/queue/:id`

Body:

```json
{
  "status": "APPROVED",
  "reviewerId": "reviewer-123",
  "note": "Looks safe; retained wording."
}
```

### Metrics

`GET /v1/review/metrics?from=&to=`

Returns total counts, per-verdict counts, rates (`blockRate`, `repairRate`, `flagRate`, `passRate`), and latency (`avgLatencyMs`, `maxLatencyMs`).

### Policy management

- `GET /v1/review/policies`
- `PATCH /v1/review/policies/:id` with `{ "enabled": true|false, "config": {...} }`

## Operational Commands

### Query records

```bash
curl -u "$ADMIN_BASIC_USER:$ADMIN_BASIC_PASS" \
  "http://localhost:3001/v1/review/records?limit=20&offset=0"
```

### Check queue

```bash
curl -u "$ADMIN_BASIC_USER:$ADMIN_BASIC_PASS" \
  "http://localhost:3001/v1/review/queue?limit=20"
```

### Approve a flagged item

```bash
curl -u "$ADMIN_BASIC_USER:$ADMIN_BASIC_PASS" \
  -X PATCH "http://localhost:3001/v1/review/queue/RECORD_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"APPROVED","reviewerId":"oncall","note":"approved"}'
```

### Check metrics window

```bash
curl -u "$ADMIN_BASIC_USER:$ADMIN_BASIC_PASS" \
  "http://localhost:3001/v1/review/metrics?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z"
```

## Rollout Guidance

1. Start with `REVIEW_COPILOT_MODE=off` for baseline.
2. Move to `shadow` and watch:
   - verdict distribution
   - false positives from hard failures
   - latency trends
3. Move to `active` only after shadow calibration.
4. Keep an on-call process for `FLAGGED` queue review.

## Known Constraints And Pitfalls

1. `ReviewRecord` / `ReviewPolicy` schema exists in `schema.prisma`, but no dedicated migration for these tables is currently present in `apps/api/prisma/migrations`. On new environments, ensure migrations are up to date before enabling review.
2. `GET /v1/review/records/:id` currently searches only a limited recent records window and can return `null` for older IDs.
3. In the current integration, `reviewCtx.userText` is set to an empty string at persistence time, so user-query-dependent checks (for example emergency bypass keyword checks) may not trigger from this stage.
4. `reviewPolicy` endpoints assume table data exists; the policy list can be empty until rows are inserted.

## Troubleshooting

### No records written

Check:
- `REVIEW_COPILOT_MODE` is not `off`
- DB schema contains `ReviewRecord`
- logs for `Failed to persist ReviewRecord`

### Queue always empty

Check:
- `FLAGGED` verdicts in metrics
- whether ambiguous checks are triggering for your traffic

### Unexpected blocking

Check:
- `hardFailures` payload on `ReviewRecord`
- retrieved citation IDs vs generated citation markers for `HF-4`
- diagnosis/dosing phrasing that matches hard-rule regexes
