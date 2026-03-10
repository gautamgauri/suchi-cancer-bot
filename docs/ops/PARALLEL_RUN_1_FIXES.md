# Parallel Run 1 - Pre-Deployment Fixes

## Status: **PASS — pending runtime gate**

All structural checks pass. Behavioral verification required via gated Cloud Build.

---

## Fixes Applied

### Fix 1: Improved Precedence for Symptoms vs Side Effects

**File:** `apps/api/src/modules/rag/query-type.classifier.ts`

**Change:** Implemented canonical precedence logic:
1. **Side effects with treatment context** (highest priority): If query mentions treatment context (chemotherapy, radiation, etc.) AND has side effect or symptom language → classify as `sideEffects`
2. **Explicit side effects language**: If query includes "side effect", "adverse effect", "adverse reaction", "complication" → classify as `sideEffects`
3. **Symptom language**: Only if no treatment context or explicit side effects → classify as `symptoms`

**Rationale:** Prevents misclassification of queries like "symptoms of chemotherapy" which should be `sideEffects`, not `symptoms`.

**Test cases covered:**
- "What are side effects of chemotherapy?" → `sideEffects` ✓
- "Symptoms after radiation treatment" → `sideEffects` ✓
- "What are common symptoms of lung cancer?" → `symptoms` ✓

---

### Fix 2: Removed Generic "Information" Term

**File:** `apps/api/src/modules/rag/rag.service.ts`

**Change:** Removed the generic "information" term from general query rewrite. Now only adds cancer type context.

**Rationale:** Generic terms like "information" can act as semantic noise and dilute retrieval specificity. Better to rely on cancer type context and let the vector search handle semantic matching.

**Before:**
```typescript
if (cancerType) {
  parts.push(`${cancerType} cancer`);
  parts.push("information"); // REMOVED
}
```

**After:**
```typescript
if (cancerType) {
  parts.push(`${cancerType} cancer`);
  // No generic terms - let vector search handle semantics
}
```

---

### Fix 3: Added Explicit "Just Asking Generally" Test Case

**File:** `eval/cases/tier1/retrieval_quality.yaml`

**Added:** `RQ-BLADDER-01` - Explicitly educational query with "Just asking generally for educational purposes"

**Expectations:**
- `max_clarifying_questions: 0` - Should NOT interrogate the user
- Should provide general information with citations immediately
- Tests that system recognizes explicitly educational intent

**Query:** "What are common symptoms of bladder cancer? Just asking generally for educational purposes."

---

### Fix 4: Updated Abstention Service for New QueryType

**File:** `apps/api/src/modules/abstention/abstention.service.ts`

**Change:** Added "symptoms" to the QueryType description mapping to fix TypeScript compilation error.

---

## Verification Checklist for Gated Build

### Required Metrics (from build artifacts)

1. **Top-3 trusted presence rate**
   - Should stay ≥ threshold (likely 90%)
   - If drops: investigate query rewrite changes

2. **Citation coverage %**
   - Should not drop
   - Ideally rises with improved query rewrite

3. **Abstention rate for informational queries**
   - Should not increase
   - New `symptoms` type should not cause more abstentions

### Commands to Run

```bash
# Run gated build
gcloud builds submit --config=cloudbuild.gated.yaml

# After build completes, check artifacts for:
# - tier1-summary.txt (or equivalent report)
# - Build logs showing promotion decision
```

### What to Share

1. **tier1-summary.txt** contents (or copy from logs)
2. **Promotion status**: Did build promote traffic or stop before promotion?
3. **Key metrics**: Top-3 trusted %, citation coverage %, abstention rate

---

## Files Changed Summary

1. `apps/api/src/modules/rag/query-type.classifier.ts` - Canonical classification precedence
2. `apps/api/src/modules/rag/rag.service.ts` - Removed generic "information" term
3. `apps/api/src/modules/abstention/abstention.service.ts` - Added symptoms QueryType
4. `eval/cases/tier1/retrieval_quality.yaml` - Added explicit educational query test case

---

## Decision Status

**MERGE:** ✅ Approved (structural checks pass, type-safe, deterministic)

**DEPLOY:** ⏸️ **Gated** - Awaiting behavioral verification via Cloud Build

**Next Step:** Run `gcloud builds submit --config=cloudbuild.gated.yaml` and share tier1 summary metrics.

---

## Risk Assessment

### Low Risk
- Classification precedence fix is more conservative (favors sideEffects when ambiguous)
- Removal of "information" term reduces noise, should improve specificity
- New test case validates expected behavior

### Medium Risk (to monitor)
- New `symptoms` QueryType must flow through all runtime switchpoints
- Evidence gate service must handle `symptoms` type correctly
- Query rewrite changes may affect retrieval ranking (monitor top-3 trusted %)

### Mitigation
- Gated build will catch any runtime issues before traffic promotion
- Tier1 metrics will show if retrieval quality improves or regresses
