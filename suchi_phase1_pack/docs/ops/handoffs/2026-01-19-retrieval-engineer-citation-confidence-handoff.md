# Handoff: Low Citation Confidence in Urgent Case

**Date**: 2026-01-19  
**Assigned To**: @retrieval-engineer  
**Priority**: High  
**Status**: Open

## Problem Summary

**RQ-ORAL-01** (urgent care case) is failing the `citation_confidence_acceptable` check. Citation confidence is **RED**, which is below the required minimum of **YELLOW**.

## Test Case Details

### RQ-ORAL-01
- **Query**: Urgent care case (severe mouth bleeding, difficulty breathing)
- **Citation Confidence**: RED (current) vs YELLOW (minimum required)
- **Citations Present**: 3 citations (meets minimum count requirement)
- **Citation Sources**:
  - `kb_en_red_flags_urgent_care_v1`
  - `kb_en_nci_about_cancer_treatment_side_effects_mouth_throat_oral_complications_pdq_v1`
  - `kb_en_nci_about_cancer_treatment_side_effects_mouth_throat_oral_complications_hp_pdq_v1`

## Root Cause Analysis

The citation confidence calculation likely considers:
1. Relevance of retrieved chunks to the query
2. Quality/trustworthiness of sources
3. Coverage of the query topic

For urgent care queries, the system may be retrieving chunks that are:
- Too generic (red flags general guidance)
- Not specific enough to the exact symptoms
- From sources that don't directly address the urgent scenario

## Required Fix

Improve citation confidence for urgent care queries by:

1. **Query Rewriting**: Enhance query rewriting for urgent cases to better match relevant chunks
2. **RAG Retrieval**: Improve retrieval logic to prioritize highly relevant chunks for urgent scenarios
3. **Citation Confidence Calculation**: Review how citation confidence is calculated for urgent cases - may need different thresholds or calculation method
4. **Source Selection**: Ensure urgent care queries retrieve from the most relevant sources (red flags, urgent care guidance)

## Allowed Paths

- `apps/api/src/modules/rag/rag.service.ts`
- `apps/api/src/modules/rag/query-type.classifier.ts`
- `apps/api/src/modules/citations/citation.service.ts`
- `apps/api/src/modules/evidence/evidence-gate.service.ts`

## Verification

After fix, verify with:
```bash
cd eval && npm run eval -- run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/tier1-sample-report.json --summary
```

Expected: `citation_confidence_acceptable` check should pass for RQ-ORAL-01 (confidence should be YELLOW or GREEN).
