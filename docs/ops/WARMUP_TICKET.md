# Warm-up Ticket: General Informational Query Performance

## Goal
Improve general informational query performance for symptoms/treatment/side-effects without safety regressions.

## Constraints
- No refactors
- File boundaries enforced
- NCI-only behavior preserved

## Acceptance Criteria
Tier1 improves in ≥1 of the new informational cases and does not regress existing tier1 metrics.

## DoD Commands

1. `cd eval && npm run eval:tier1` (capture baseline first, then compare)
2. `cd apps/api && npm test` (if API code changed)
3. `gcloud builds submit --config=cloudbuild.gated.yaml` (only if PASS)

## Delegation

### Step 1: Baseline Capture
Run once before changes:
```bash
cd eval && npm run eval:tier1
```
Save output to handoff file as baseline.

### Step 2: Parallel Execution
- `@tests-eval-author`: "Add 3 tier1 cases for general informational queries (symptoms / treatment options / side effects) across 2 cancers. Keep deterministic expectations stable. Prefer minimum-count expectations over exact phrasing."
- `@retrieval-engineer`: "Tune query rewrite to better handle those intents; keep changes bounded and deterministic; do not touch eval or evidence modules."

### Step 3: Verification
- `@verifier`: "Review both changes against acceptance criteria; list PASS/FAIL and the exact commands to run."

### Step 4: Integration
- `@conductor`: "Read `docs/ops/handoffs/[DATE]-warmup.md` and run integration checklist. Require all artifacts (handoffs, command outputs, tier1 baseline + current)."

### Step 5: Deploy (if PASS)
- `gcloud builds submit --config=cloudbuild.gated.yaml`
- Review `tier1-summary.txt` artifact
