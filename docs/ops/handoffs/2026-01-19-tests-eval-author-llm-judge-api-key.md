# Handoff: Fix LLM Judge Initialization - Deepseek API Key Not Loading

**Date**: 2026-01-19  
**Assigned To**: @tests-eval-author  
**Priority**: High  
**Status**: Open

## Problem Summary

**LLM judge checks are all failing** because Deepseek API key is not being loaded in the eval framework, preventing proper evaluation of critical checks like `what_to_do_now`.

## Evidence

**From `eval/reports/health-check.json`**:
- Config shows: `"apiKey": ""` (empty string)
- All LLM judge checks failing with: "Deepseek client not initialized. Provide DEEPSEEK_API_KEY in config."
- Log shows: "⚠ Secret Manager unavailable" but environment variable should be set

**Affected Checks**:
- `what_to_do_now` - Cannot verify urgent response concrete steps
- `emergency_guidance` - Cannot verify emergency guidance
- `rag_backed_content` - Cannot verify evidence-based content
- `no_unsupported_medical_claims` - Cannot verify citation validation
- `warning_signs_coverage` - Cannot verify warning signs
- `tests_coverage` - Cannot verify test coverage

## Root Cause Analysis

**Current Flow**:
1. Script sets `$env:DEEPSEEK_API_KEY` from Secret Manager
2. Eval framework tries to load from Secret Manager first
3. Secret Manager fails (authentication issue)
4. Falls back to environment variables
5. **But environment variable is not being read correctly**

**Possible Issues**:
1. Environment variable not persisting to child process (npm/ts-node)
2. Config loader not reading environment variable correctly
3. Secret Manager check happens before env var is available

## Files to Check

1. **`eval/config/loader.ts`**:
   - Check how it reads `process.env.DEEPSEEK_API_KEY`
   - Verify fallback logic from Secret Manager to env vars

2. **`eval/runner/llm-judge.ts`**:
   - Check how it initializes Deepseek client
   - Verify it's reading from config correctly

3. **`eval/run-eval.ps1`**:
   - Verify environment variable is set correctly
   - Check if it persists to child process

## Expected Fix

1. **Ensure environment variable is set** before eval runs
2. **Fix config loader** to properly read `DEEPSEEK_API_KEY` from environment
3. **Verify Deepseek client initialization** in LLM judge

## Verification

After fix:
```bash
cd eval
.\run-eval.ps1 run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/llm-judge-fix-verification.json --summary
```

**Expected**:
- Config should show: `"apiKey": "sk-..."` (not empty)
- LLM judge checks should run (may pass or fail, but should not error)
- `what_to_do_now` check should evaluate RQ-ORAL-01 properly

## Impact

**Blocking**: Without LLM judge, we cannot:
- Verify `what_to_do_now` fix (concrete steps evaluation)
- Verify `emergency_guidance` fix
- Get accurate scores for any LLM-judged checks
- Complete full batch testing (100 cases)

## Allowed Paths

- `eval/config/loader.ts` - Config loading logic
- `eval/runner/llm-judge.ts` - LLM judge initialization
- `eval/run-eval.ps1` - Environment setup script
- `eval/config/secrets-manager.ts` - Secret Manager integration
- `docs/ops/handoffs/**` - For status updates

## Related Handoffs

- `docs/ops/handoffs/2026-01-19-tests-eval-author-verification-results.md` - Verification results showing the issue
- `docs/ops/handoffs/2026-01-19-tests-eval-author-batch-testing.md` - Original batch testing plan
