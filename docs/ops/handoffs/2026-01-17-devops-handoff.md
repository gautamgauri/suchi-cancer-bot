# Handoff: Timeout & LLM Config Issues → @devops-gcp-deployer

**From:** @tests-eval-author  
**To:** @devops-gcp-deployer  
**Date:** 2026-01-17  
**Priority:** Critical (timeouts), Medium (LLM config)

## Problem Summary

### Issue 1: Timeout Errors (Critical)
15 out of 21 eval tests are timing out at the 60-second limit. This prevents proper evaluation of the system.

### Issue 2: LLM Judge Not Configured (Medium)
LLM judge is not initialized, causing all LLM-based checks to fail.

## Evidence

### Timeout Errors
**Affected Cases (15 total):**
- RQ-PROSTATE-01, RQ-CERVICAL-01, RQ-OVARIAN-01
- RQ-LEUKEMIA-01, RQ-PANCREAS-01, RQ-BREAST-02
- RQ-COLORECTAL-02, RQ-PROSTATE-02, RQ-CERVICAL-02
- RQ-STOMACH-01, RQ-LIVER-01, RQ-BRAIN-01
- RQ-THYROID-01, RQ-KIDNEY-01, RQ-BLADDER-01

**Error Message:**
```
Error: Failed to send message: timeout of 60000ms exceeded
```

### LLM Judge Errors
**Affected Checks:**
- `immediate_value`
- `next_steps`
- `tests_coverage`
- `no_unsupported_medical_claims`
- `urgency_timeline`
- `doctor_questions`
- `rag_backed_content`

**Error Message:**
```
OpenAI client not initialized. Provide OPENAI_API_KEY in config.
```

**Full Report:** `eval/reports/tier1-report.json`

## Expected Behavior

### Timeout Issue
- API should respond within 60s timeout, OR
- Timeout should be increased for eval runs to accommodate Cloud Run cold starts
- Cloud Run should be optimized to reduce cold start times

### LLM Config Issue
- LLM judge should be configured with Deepseek or OpenAI API key
- LLM checks should run successfully
- Configuration should use Secret Manager (recommended) or environment variables

## Allowed Paths

- `cloudbuild*.yaml`
- `docs/**`
- `eval/**` (only if needed for CI wiring or env vars, not rubric logic)

## Forbidden Paths

- `apps/api/src/**` (unless explicitly required for deployment integration)

## Investigation Steps

### For Timeout Issue:
1. Check Cloud Run cold start times
2. Review API response times in logs
3. Consider increasing eval timeout in `eval/runner/api-client.ts`
4. Check if Cloud Run needs warmup or min-instances configuration

### For LLM Config:
1. Check `eval/config/loader.ts` for LLM provider configuration
2. Verify Secret Manager setup for Deepseek API key
3. Check environment variable configuration
4. Review `eval/runner/llm-judge.ts` initialization

## Definition of Done

### Timeout Fix:
- Eval tests complete without timeout errors
- Either timeout increased OR Cloud Run optimized
- No regression in API performance

### LLM Config Fix:
- LLM judge successfully initialized
- LLM checks run without "not initialized" errors
- Configuration uses secure method (Secret Manager preferred)

## Verification

After fix, @tests-eval-author will re-run:
```bash
cd eval && npm run eval:tier1
```

Expected: 
- No timeout errors
- LLM checks run successfully
- Tests complete within reasonable time

## Notes

- Timeout issue is blocking 71% of tests (15/21)
- LLM config issue affects semantic evaluation quality
- Both issues should be addressed to enable proper evaluation
