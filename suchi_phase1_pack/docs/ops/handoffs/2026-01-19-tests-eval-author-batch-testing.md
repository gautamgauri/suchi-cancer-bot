# Handoff: Run Batch Evaluation Tests (100 Cases)

**Date**: 2026-01-19  
**Assigned To**: @tests-eval-author  
**Priority**: High  
**Status**: Open

## Task Summary

Run comprehensive evaluation tests for all 100 test cases in batches to verify the urgent response template fix and overall system performance.

## Context

We just deployed:
1. **Urgent response template fix** - Added concrete immediate steps and locale-aware emergency numbers (112/108 for India, 911 for others)
2. **Deterministic extractor** - For informational queries to improve test coverage

## Test Files Available

1. **`cases/tier1/common_cancers_20_mode_matrix.yaml`** - 100 cases (20 cancers × 5 modes)
2. **`cases/tier1/retrieval_quality_sample.yaml`** - 3 cases (quick verification)
3. **`cases/tier1/retrieval_quality.yaml`** - 15 cases (retrieval quality focused)

## Recommended Approach

### Step 1: Quick Verification (3 cases)
Run the sample first to verify urgent response fix:
```powershell
cd eval
.\run-eval.ps1 run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/urgent-fix-verification.json --summary
```

**Expected**: RQ-ORAL-01 should show improvement in `what_to_do_now` check (should pass now with concrete steps).

### Step 2: Full Batch Testing (100 cases)
Run all 100 cases:
```powershell
cd eval
.\run-batch-simple.ps1
```

**Expected Duration**: 30-60 minutes  
**Output**: `reports/batch-1-{timestamp}.json`

## Key Metrics to Monitor

1. **RQ-ORAL-01 (Urgent Case)**:
   - ✅ `what_to_do_now`: Should pass (concrete immediate steps)
   - ✅ `emergency_guidance`: Should pass
   - ✅ Score should improve from 69.1%

2. **Overall Performance**:
   - Average score across all 100 cases
   - Timeout rate (should be < 5%)
   - Citation coverage (should be > 80%)

3. **Deterministic Extractor Impact**:
   - `tests_coverage` scores (should be higher)
   - `warning_signs_coverage` scores (should be higher)
   - `no_unsupported_medical_claims` (should pass more often)

## Batch Scripts Available

- `eval/run-batch-simple.ps1` - Runs all 100 cases at once
- `eval/run-eval.ps1` - Standard eval runner with Secret Manager setup
- `eval/run-batches.ps1` - Batch runner by cancer type (has syntax issues, use simple version)

## Configuration

The scripts automatically:
- Load Deepseek API key from Secret Manager
- Set `GOOGLE_CLOUD_PROJECT = "gen-lang-client-0202543132"`
- Set `EVAL_LLM_PROVIDER = "deepseek"`
- Configure API URL: `https://suchi-api-lxiveognla-uc.a.run.app/v1`

## Expected Issues to Route

After running tests, route issues to appropriate agents:

1. **Citation Coverage Issues** → `@retrieval-engineer`
   - If citation coverage < 80%
   - If citation integrity failures

2. **Response Format Issues** → `@safety-gatekeeper`
   - Missing disclaimers
   - Missing required sections
   - Content quality issues

3. **Timeout/Performance Issues** → `@devops-gcp-deployer`
   - 504 timeouts
   - Slow response times
   - API errors

4. **Eval Framework Issues** → Keep with `@tests-eval-author`
   - LLM judge failures
   - Configuration issues
   - Report generation problems

## Deliverables

1. **Quick Verification Report**: `reports/urgent-fix-verification.json`
   - Focus on RQ-ORAL-01 results
   - Summary of urgent response improvements

2. **Full Batch Report**: `reports/batch-1-{timestamp}.json`
   - Complete results for all 100 cases
   - Summary statistics
   - Failed test details

3. **Analysis Summary**:
   - Overall pass rate
   - Key improvements from urgent template fix
   - Key improvements from deterministic extractor
   - Issues identified for routing

## Allowed Paths

- `eval/**` - All eval framework files
- `docs/ops/handoffs/**` - For creating new handoffs
- `eval/reports/**` - For report files

## Related Handoffs

- `docs/ops/handoffs/2026-01-19-devops-deploy-urgent-template-fix.md` - Deployment completed
- `docs/ops/handoffs/2026-01-19-safety-gatekeeper-urgent-concrete-steps.md` - Original analysis
