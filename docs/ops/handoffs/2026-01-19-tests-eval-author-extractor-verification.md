# Handoff: Run Eval Verification for Deterministic Extractor

**Date**: 2026-01-19  
**Assigned To**: @tests-eval-author  
**Priority**: High  
**Status**: Open

## Task Summary

Run tier1 eval suite to verify that the deterministic extraction layer improvements are working as expected.

## What Was Implemented

The deterministic extraction layer has been enhanced with:
1. ✅ Integration tests for extract → generate → enforce pipeline
2. ✅ Observability logging for completeness outcomes
3. ✅ Improved fallback insertion with multiple pattern matching

## Expected Improvements

After the deterministic extractor, we should see:
- **tests_coverage**: Should improve (4+ tests consistently extracted)
- **warning_signs_coverage**: Should improve (5+ signs consistently extracted)
- **urgency_timeline**: Should be more consistent (when timeline exists in sources)
- **No regressions**: No false positives, citation mismatches, or over-triggering

## Verification Steps

1. **Run tier1 eval suite**:
   ```bash
   cd eval
   $env:GOOGLE_CLOUD_PROJECT = "gen-lang-client-0202543132"
   $env:EVAL_LLM_PROVIDER = "deepseek"
   $env:DEEPSEEK_API_KEY = (gcloud secrets versions access latest --secret="deepseek-api-key")
   npm run eval -- run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/tier1-extractor-verification.json --summary
   ```

2. **Analyze results**:
   - Check `tests_coverage` scores (should be higher than before)
   - Check `warning_signs_coverage` scores (should be higher)
   - Check `urgency_timeline` consistency
   - Look for any regressions (false positives, citation issues)

3. **Compare with previous results**:
   - Compare with `tier1-batch-1-verify.json` and `tier1-batch-2-verify.json`
   - Document improvements or issues found

## Success Criteria

- ✅ `tests_coverage` shows improvement (more tests consistently extracted)
- ✅ `warning_signs_coverage` shows improvement
- ✅ No new regressions introduced
- ✅ Fallback insertion working correctly (when needed)

## If Issues Found

Route to appropriate sub-agents:
- **Citation issues** → @retrieval-engineer
- **Response format/safety issues** → @safety-gatekeeper
- **Performance/timeout issues** → @devops-gcp-deployer
