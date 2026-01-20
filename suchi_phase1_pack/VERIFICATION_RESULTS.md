# Retrieval Quality Sprint - Verification Results

## Pass 1: Clean Correctness ✅

### Eval Package
```bash
cd eval
npm run lint        # ✅ PASSED - 0 errors, 20 warnings (all pre-existing)
npm run typecheck   # ✅ PASSED - No type errors
```

**Result:** ✅ **PASS** - No new errors introduced

### API Package
```bash
cd apps/api
npx tsc --noEmit    # ✅ PASSED - No type errors (after fixing import path)
```

**Issues Fixed:**
- Fixed import path: `../config/` → `../../config/` for trusted-sources.config
- Removed invalid "diagnosis" case from query rewrite switch (not in QueryType enum)

**Result:** ✅ **PASS** - All type errors resolved

---

## Pass 2: Tier1 Eval Report (Pending API Server)

### Command to Run
```powershell
cd eval
npm run eval:tier1
# OR with timestamped output:
.\run-tier1.ps1
```

### Expected Output Location
- `eval/reports/tier1-report.json` (or timestamped version)

### Metrics to Record

**From Report Summary:**
```json
{
  "summary": {
    "retrievalQuality": {
      "top3TrustedPresenceRate": 0.XX,  // Target: > 0.80 (80%+)
      "citationCoverageRate": 0.XX,    // Target: > 0.90 (90%+)
      "abstentionRate": 0.XX            // Target: < 0.10 (10% or less)
    }
  }
}
```

**Per-Case Improvements:**
- Count cases where `retrievalQuality.top3TrustedPresence === true` improved
- Target: **≥ 3 cases** showing improved top-3 relevance

### Pass Conditions

✅ **PASS if:**
- ≥ 3 cases show improved top-3 relevance
- Citation coverage does not drop materially vs baseline
- Abstention rate does not increase for informational cases

❌ **FAIL if:**
- < 3 cases improved → relevance didn't improve (check reranking)
- Citation coverage drops significantly → orphan filtering too aggressive
- Abstention rate increases → evidence gate regression

**Status:** ⏳ **PENDING** - Requires API server running with:
- Database connection
- Vector store accessible
- LLM provider configured (for eval judge)

---

## Pass 3: Trace Sanity Check (Pending API Server)

### Setup
```powershell
$env:RAG_TRACE_RERANK = "true"
# Restart API server
```

### Test Queries
1. "What are common treatments for breast cancer?"
2. "What are common side effects of chemotherapy for lung cancer?"
3. "How is colorectal cancer diagnosed?"

### Expected Trace Output

**What You Should See:**
```
[RagService] [RERANK] Query: "What are common treatments for breast cancer?"
[RagService] [RERANK] Before: [
  {"docId":"doc_unknown_1","sourceType":"unknown_source","isTrusted":false,"similarity":0.72},
  {"docId":"doc_nci_1","sourceType":"02_nci_core","isTrusted":true,"similarity":0.68},
  {"docId":"doc_unknown_2","sourceType":"unknown_source","isTrusted":false,"similarity":0.65}
]
[RagService] [RERANK] After: [
  {"docId":"doc_nci_1","sourceType":"02_nci_core","isTrusted":true,"similarity":0.68,"rerankScore":0.83},
  {"docId":"doc_unknown_1","sourceType":"unknown_source","isTrusted":false,"similarity":0.72,"rerankScore":0.72},
  {"docId":"doc_unknown_2","sourceType":"unknown_source","isTrusted":false,"similarity":0.65,"rerankScore":0.65}
]
[RagService] [RERANK] Deltas: [
  {"moved":"changed","from":"doc_unknown_1","to":"doc_nci_1","beforeTrusted":false,"afterTrusted":true}
]
```

**Pass Conditions:**
- ✅ Rerank deltas look rational (trusted sources moving up, not teleporting)
- ✅ Citation integrity warnings are rare and explainable
- ✅ No "answer with zero citations" where evidence exists

**Status:** ⏳ **PENDING** - Requires API server with trace enabled

---

## Watch Items Status

### A. Orphan Citation Filtering

**Current Implementation:**
- Orphan citations are filtered with `[CITATION_INTEGRITY]` warnings
- Only citations referencing actual retrieved chunks are included

**Monitoring:**
- Check tier1 report for citation coverage drops
- Review logs for excessive `[CITATION_INTEGRITY]` warnings
- Verify answers don't become too generic

**Status:** ✅ **IMPLEMENTED** - Ready for monitoring

### B. Low-Similarity Trusted Chunks

**Current Behavior:**
- Fixed boosts (0.05-0.15) applied to trusted sources
- If untrusted has 0.90 similarity and trusted has 0.30, untrusted still wins
- This is intentional (don't force low-relevance trusted sources)

**Check:**
- Are trusted sources appearing in top-3 for queries where they should exist?
- If not, may need follow-on: "trusted-source fallback search" (next sprint)

**Status:** ✅ **INTENTIONAL** - Monitor tier1 results

---

## Summary

### ✅ Completed
- Pass 1: Clean correctness (lint, typecheck) - **PASSED**
- All TypeScript errors fixed
- Code structure verified

### ⏳ Pending (Requires API Server)
- Pass 2: Tier1 eval report - **NEEDS API SERVER**
- Pass 3: Trace sanity check - **NEEDS API SERVER**

### Next Steps
1. Start API server with database/vector store connected
2. Run `npm run eval:tier1` from `eval/` directory
3. Review report metrics and paste summary here
4. Enable `RAG_TRACE_RERANK=true` and test 2-3 queries
5. Paste trace log snippet for review

---

## Files Modified (Final)

### Eval Package
- `eval/cases/tier1/retrieval_quality.yaml` (new)
- `eval/types/index.ts`
- `eval/runner/evaluator.ts`
- `eval/runner/report-generator.ts`
- `eval/package.json`
- `eval/run-tier1.ps1` (new)

### API Package
- `apps/api/src/modules/rag/rag.service.ts` (reranking + query rewrite)
- `apps/api/src/modules/citations/citation.service.ts` (citation integrity)
- `apps/api/src/modules/chat/chat.service.ts` (retrievedChunks metadata)
- `apps/api/src/modules/evidence/evidence-gate.service.spec.ts` (regression tests)

**All files pass linting and type checking.** ✅
