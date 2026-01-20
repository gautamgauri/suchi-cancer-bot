# Handoff: 504 Timeout Errors on Some Queries

**Date**: 2026-01-19  
**Assigned To**: @devops-gcp-deployer  
**Priority**: High  
**Status**: ✅ COMPLETED

## Problem Summary

Some test cases are experiencing 504 timeout errors, indicating requests are exceeding the 45-second timeout limit.

## Affected Cases

- **RQ-PROSTATE-01**: 504 timeout
- **RQ-CERVICAL-01**: 504 timeout  
- **RQ-ORAL-01**: 504 timeout (also in batch 1)

## Root Cause Analysis

The 45-second request timeout may be too short for complex queries that require:
- RAG retrieval
- LLM generation with structured sections (warning signs, tests, timeline, questions)
- Multiple citations
- Response validation

**Current Timeout Settings**:
- Request timeout: 45s (in `chat.controller.ts`)
- LLM timeout: 15s (in `llm.service.ts`)
- Cloud Run timeout: 300s (default)

## Options to Fix

### Option 1: Increase Request Timeout (Quick Fix)
- Increase from 45s to 60s or 90s
- Allows more time for complex queries

### Option 2: Optimize Performance (Better Long-term)
- Optimize RAG retrieval
- Optimize LLM prompt (reduce token count)
- Cache common queries
- Parallelize operations

### Option 3: Both
- Increase timeout to 60s as immediate fix
- Plan performance optimizations

## Recommended Approach

**Immediate**: Increase request timeout to 60s  
**Future**: Optimize LLM prompts and RAG retrieval

## Allowed Paths

- `apps/api/src/modules/chat/chat.controller.ts` - Request timeout
- `cloudbuild.yaml` - Cloud Run timeout settings (if needed)

## Expected Behavior

After fix:
- Complex queries should complete within timeout
- No more 504 errors for valid queries
- Better user experience

## Verification

After fix, re-run affected cases:
```bash
cd eval && npm run eval -- run --cases cases/tier1/retrieval_quality_batch2.yaml --output reports/tier1-batch-2-verify.json --summary
```

Expected: RQ-PROSTATE-01 and RQ-CERVICAL-01 should complete without timeout.
