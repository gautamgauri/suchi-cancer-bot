# Handoff: Critical Abstention Regression - System Abstaining on Valid Queries

**Date**: 2026-01-19  
**Assigned To**: @safety-gatekeeper  
**Priority**: CRITICAL  
**Status**: Open

## Problem Summary

After deploying content quality fixes, the system is now **abstaining from answering valid informational queries** that previously worked. This is a critical regression.

## Test Cases Affected

### Batch 1:
- **RQ-BREAST-01**: Abstaining with `abstentionReason: "ungrounded_entities"`
- **RQ-ORAL-01**: 504 timeout (separate issue)

### Batch 2:
- **RQ-COLORECTAL-01**: Abstaining with `abstentionReason: "ungrounded_entities"`
- **RQ-PROSTATE-01**: Abstaining with `abstentionReason: "ungrounded_entities"`
- **RQ-CERVICAL-01**: 504 timeout (separate issue)

## Symptoms

**Response Text**:
```
I don't have enough information in my NCI sources to answer this safely. Please consult a clinician.

For general information about cancer, I can help answer questions based on trusted sources. If you have specific concerns about symptoms, please consult a healthcare provider.
```

**Metadata**:
- `abstentionReason: "ungrounded_entities"`
- `citationCount: 0`
- `hasAbstention: true`
- No sections found
- No citations
- Citation confidence: RED

## Root Cause Analysis

The new LLM prompt requires structured sections with specific content. The LLM may be responding with "I don't have enough information" when it can't find specific content in RAG chunks, which then triggers the `ungrounded_entities` abstention logic.

**Possible causes**:
1. LLM prompt is too strict - requiring specific content that may not exist in RAG chunks
2. Evidence gate is detecting "I don't have enough information" as ungrounded entities
3. Abstention logic is incorrectly triggering on valid informational queries

## Code Location

The `ungrounded_entities` abstention is triggered in `apps/api/src/modules/chat/chat.service.ts` around line 776-787.

## Required Fix

1. **Review abstention logic** - Ensure informational queries with "generally asking" don't trigger `ungrounded_entities` abstention
2. **Review LLM prompt** - Ensure prompt doesn't cause LLM to say "I don't have enough information" unnecessarily
3. **Review evidence gate** - Ensure weak evidence for informational queries doesn't trigger abstention

## Allowed Paths

- `apps/api/src/modules/evidence/**` - Evidence gate logic
- `apps/api/src/modules/chat/**` - Abstention handling
- `apps/api/src/modules/llm/llm.service.ts` - LLM prompt adjustments

## Expected Behavior

After fix:
- Informational queries with "Just asking generally" should NOT abstain
- System should provide answers even with weak evidence (with appropriate disclaimers)
- Abstention should only occur for truly unsafe scenarios

## Verification

After fix, re-run both batches:
```bash
cd eval && npm run eval -- run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/tier1-batch-1-final.json --summary
cd eval && npm run eval -- run --cases cases/tier1/retrieval_quality_batch2.yaml --output reports/tier1-batch-2.json --summary
```

Expected: No abstentions for informational queries, responses should have citations and sections.
