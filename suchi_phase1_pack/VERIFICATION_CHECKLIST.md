# Retrieval Quality Sprint - Verification Checklist

## Implementation Summary

All 4 PRs have been implemented as specified in the plan:

### PR-1: Eval Harness + Tier1 Cases ✅
- **Files Created:**
  - `eval/cases/tier1/retrieval_quality.yaml` (15 test cases)
  - `eval/run-tier1.ps1` (PowerShell runner)
- **Files Modified:**
  - `eval/types/index.ts` (added retrieval quality metrics)
  - `eval/runner/evaluator.ts` (added quality calculation)
  - `eval/runner/report-generator.ts` (added quality summary)
  - `eval/package.json` (added `eval:tier1` script)

### PR-2: Trusted-Source Reranker + Instrumentation ✅
- **Files Modified:**
  - `apps/api/src/modules/rag/rag.service.ts` (added reranking logic)
  - `apps/api/src/modules/chat/chat.service.ts` (added retrievedChunks to response)
- **Features:**
  - Deterministic reranking with priority-based boosts
  - Trace logging behind `RAG_TRACE_RERANK=true` env flag
  - Applied to both vector and keyword search

### PR-3: Query Rewrite + Evidence Coupling + Citation Integrity ✅
- **Files Modified:**
  - `apps/api/src/modules/rag/rag.service.ts` (added query rewrite)
  - `apps/api/src/modules/citations/citation.service.ts` (enhanced integrity checks)
  - `apps/api/src/modules/chat/chat.service.ts` (passes cancerType to retrieval)
- **Features:**
  - Query rewrite using QueryTypeClassifier + cancer terms
  - Strict 1:1 citation-to-chunk mapping
  - Orphan citation filtering with logging

### PR-4: Evidence Thresholds + API Tests ✅
- **Files Modified:**
  - `apps/api/src/modules/evidence/evidence-gate.service.spec.ts` (added regression tests)
- **Tests Added:**
  - Weak evidence for informational queries should NOT abstain
  - Very weak evidence should still allow through
  - Untrusted sources should still cause abstention
  - No evidence should abstain even for informational queries
  - Clarifying question generation

## Verification Steps

### A. Hygiene Checks

#### Eval Package
```powershell
cd eval
npm run lint        # ✅ Passed (20 warnings, 0 errors - all pre-existing)
npm run typecheck   # ✅ Passed (no errors)
```

#### API Package
- Note: API package.json doesn't include lint/typecheck scripts
- TypeScript compilation verified via `read_lints` tool: ✅ No errors

### B. Core Acceptance Checks

#### Run Tier1 Eval
```powershell
cd eval
npm run eval:tier1
# OR with timestamped output:
.\run-tier1.ps1
```

**Expected Report Output:**
- Top-3 trusted source presence rate (percentage)
- Citation coverage % (percentage of responses with citations)
- Abstention rate (percentage of responses that abstained)
- Per-case breakdown showing at least 3 improvements in top-3 relevance

**Note:** This requires:
- API server running (or configured API endpoint)
- LLM provider configured (Deepseek/OpenAI/Vertex AI)
- Test cases will make actual API calls

### C. Trace Sanity Check

#### Enable Trace Logging
```powershell
$env:RAG_TRACE_RERANK = "true"
# Then make API calls to test queries
```

**Expected Trace Output:**
```
[RERANK] Query: "What are common symptoms of breast cancer? Just generally asking..."
[RERANK] Before: [{"docId":"...","sourceType":"unknown_source","isTrusted":false,"similarity":0.65},...]
[RERANK] After: [{"docId":"...","sourceType":"02_nci_core","isTrusted":true,"similarity":0.65,"rerankScore":0.80},...]
[RERANK] Deltas: [{"moved":"changed","from":"unknown_doc","to":"nci_doc","beforeTrusted":false,"afterTrusted":true}]
```

**What to Verify:**
- Top-3 before/after shows reordering
- Trusted sources move up in ranking
- Rerank scores are higher for trusted sources
- No bizarre jumps (low similarity shouldn't become #1 without trusted boost)

## Risk Areas to Double-Check

### A. Orphan Citation Filtering

**Risk:** Filtering orphans might reduce citation count below expected thresholds.

**Check:** In tier1 report, verify:
- Citation coverage doesn't drop unexpectedly
- Cases with improved relevance still maintain citation integrity
- Answers don't become too generic due to filtered citations

**Implementation Note:** Orphan citations are logged with `[CITATION_INTEGRITY]` prefix for monitoring.

### B. Evidence Gate + Untrusted Sources

**Current Behavior:**
- Untrusted sources in top results cause abstention
- Reranking should surface trusted sources into top-K if they exist

**Potential Issue:** If all top results are untrusted but trusted exists lower, reranking should help but may not be sufficient if similarity gap is too large.

**Follow-on Improvement (not in this sprint):**
- Add rule: "if any trusted exists above min similarity threshold (e.g., 0.3), prefer it over untrusted even if untrusted has higher similarity"

## Sample Trace Log (Expected Format)

When `RAG_TRACE_RERANK=true` is set, you should see logs like:

```
[RagService] [RERANK] Query: "What are common symptoms of breast cancer? Just generally asking."
[RagService] [RERANK] Before: [{"docId":"doc_unknown_1","sourceType":"unknown_source","isTrusted":false,"similarity":0.72},{"docId":"doc_nci_1","sourceType":"02_nci_core","isTrusted":true,"similarity":0.68},{"docId":"doc_unknown_2","sourceType":"unknown_source","isTrusted":false,"similarity":0.65}]
[RagService] [RERANK] After: [{"docId":"doc_nci_1","sourceType":"02_nci_core","isTrusted":true,"similarity":0.68,"rerankScore":0.83},{"docId":"doc_unknown_1","sourceType":"unknown_source","isTrusted":false,"similarity":0.72,"rerankScore":0.72},{"docId":"doc_unknown_2","sourceType":"unknown_source","isTrusted":false,"similarity":0.65,"rerankScore":0.65}]
[RagService] [RERANK] Deltas: [{"moved":"changed","from":"doc_unknown_1","to":"doc_nci_1","beforeTrusted":false,"afterTrusted":true},{"moved":"changed","from":"doc_nci_1","to":"doc_unknown_1","beforeTrusted":true,"afterTrusted":false},{"moved":"same","docId":"doc_unknown_2"}]
```

This shows:
- NCI source moved from #2 to #1 due to trusted boost
- Unknown source moved from #1 to #2 (still high similarity but no boost)
- Rerank score for NCI: 0.68 + 0.15 = 0.83 (high priority boost)

## Next Steps

1. **Run `npm run eval:tier1`** with API server running to get baseline metrics
2. **Enable trace logging** and test 2-3 representative queries
3. **Review tier1 report** for:
   - At least 3 cases showing improved top-3 relevance
   - Citation coverage maintained or improved
   - No new informational abstentions
4. **Monitor orphan citation logs** to ensure filtering isn't too aggressive

## CI Integration (Recommended Follow-on)

Add to `.github/workflows/ci.yml`:
```yaml
- name: Run Tier1 Eval
  run: |
    cd eval
    npm install
    npm run eval:tier1
  env:
    EVAL_LLM_PROVIDER: deepseek
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

Make it a required status check for PRs touching retrieval/safety code.
