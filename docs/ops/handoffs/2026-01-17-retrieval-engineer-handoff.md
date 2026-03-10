# Handoff: Citation Coverage Issues → @retrieval-engineer

**From:** @tests-eval-author  
**To:** @retrieval-engineer  
**Date:** 2026-01-17  
**Priority:** High

## Problem Summary

Eval cases RQ-ORAL-01 and RQ-NHL-01 failed citation checks. Overall citation coverage is 66.7%, below the 80% target threshold.

## Evidence

**Test Case Failures:**
- **RQ-ORAL-01**: `citations_present` check failed
- **RQ-NHL-01**: 
  - `citations_present` check failed
  - `citation_confidence_acceptable` check failed

**Metrics:**
```json
{
  "retrievalQuality": {
    "citationCoverageRate": 0.6666666666666666,
    "top3TrustedPresenceRate": 0
  }
}
```

**Full Report:** `eval/reports/tier1-report.json`

## Expected Behavior

- Citation coverage should be ≥ 80%
- All test cases should have at least 2 citations
- Citation confidence should be YELLOW or GREEN (not RED)
- Top-3 trusted source presence should be > 0

## Allowed Paths

- `apps/api/src/modules/rag/**`
- `apps/api/src/modules/embeddings/**`
- `apps/api/src/modules/citations/**`

## Forbidden Paths

- `eval/**`
- `apps/api/src/modules/evidence/**`
- `cloudbuild*.yaml, docs/**`

## Investigation Steps

1. Check query rewrite logic for oral cancer and NHL queries
2. Verify reranking is prioritizing trusted sources
3. Check citation generation logic in citation service
4. Review embedding quality for these specific cancer types

## Definition of Done

- No lint/type errors in touched files
- Citation coverage improves to ≥ 80%
- RQ-ORAL-01 and RQ-NHL-01 pass citation checks
- No regression in other tier1 metrics
- If ranking/rewrite changed, provide trace snippet using `RAG_TRACE_RERANK=true`

## Verification

After fix, @tests-eval-author will re-run:
```bash
cd eval && npm run eval:tier1
```

Expected: Citation coverage ≥ 80%, RQ-ORAL-01 and RQ-NHL-01 pass.
