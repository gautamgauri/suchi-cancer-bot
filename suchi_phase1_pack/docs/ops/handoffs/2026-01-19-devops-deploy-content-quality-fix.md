# Handoff: Deploy Content Quality Fixes

**Date**: 2026-01-19  
**Assigned To**: @devops-gcp-deployer  
**Priority**: High  
**Status**: Open

## Task Summary

Deploy the content quality fixes that require LLM to generate specific, evidence-based sections instead of generic placeholders.

## Changes to Deploy

**Commit**: `d2309c8` - "Fix content quality: require LLM to generate specific sections from RAG chunks, remove generic placeholders"

**Files Changed**:
- `apps/api/src/modules/llm/llm.service.ts` - Updated prompt to require specific structured sections from RAG chunks
- `apps/api/src/modules/chat/response-templates.ts` - Removed generic placeholder sections

## What Was Fixed

**Before**: Response templates added generic placeholder text like "Your healthcare provider may recommend various diagnostic tests"

**After**: LLM now generates specific, evidence-based content from RAG chunks:
- Specific warning signs with citations
- Specific diagnostic tests (mammography, CT scan, etc.) with citations
- Specific timeframes (e.g., "within 2-4 weeks") with citations
- Cancer-specific doctor questions based on references

## Deployment Steps

1. **Trigger Cloud Build**:
   ```bash
   gcloud builds submit --config=cloudbuild.yaml --substitutions=SHORT_SHA=d2309c8
   ```

2. **Verify Deployment**:
   - Check Cloud Build logs for success
   - Verify new revision is active
   - Check service health

3. **After Deployment**: Re-run batch 1 tests to verify fixes

## Expected Behavior

After deployment:
- Responses will have specific, cancer-type-specific content in sections
- All sections will be evidence-based with citations
- LLM judge checks should pass with scores > 0.7

## Verification

After deployment, @tests-eval-author will re-run batch 1:
```bash
cd eval && npm run eval -- run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/tier1-batch-1.json --summary
```

Expected: LLM judge checks should pass (warning_signs_coverage, tests_coverage, urgency_timeline, doctor_questions).
