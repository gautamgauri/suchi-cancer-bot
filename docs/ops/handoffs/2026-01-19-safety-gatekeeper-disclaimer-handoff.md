# Handoff: Missing Disclaimer in Urgent Case Response

**Date**: 2026-01-19  
**Assigned To**: @safety-gatekeeper  
**Priority**: High  
**Status**: Open

## Problem Summary

**RQ-ORAL-01** (urgent care case) is failing the `disclaimer_present` check. The response does not include the required disclaimer text.

## Test Case Details

### RQ-ORAL-01
- **Query Type**: Urgent care (red flags)
- **Failed Check**: `disclaimer_present`
- **Response Excerpt**:
  ```
  Some of what you described could be urgent. Please seek emergency medical care now...
  **Information from trusted sources:**
  - **Seek Immediate Medical Attention**: Severe mouth bleeding...
  ```

The response starts with urgent guidance but lacks the standard disclaimer that appears in other responses:
```
**Important:** This information is for general educational purposes and is not a diagnosis. Please consult with your healthcare provider for accurate, personalized medical information.
```

## Root Cause Analysis

Urgent care responses likely use a different template path (possibly `urgentModeFrame` or similar) that doesn't include the standard disclaimer. The disclaimer is required for ALL responses, including urgent cases.

## Required Fix

Ensure urgent care responses include the standard disclaimer. This may require:

1. Adding disclaimer to the urgent response template
2. Or ensuring urgent responses also call `explainModeFrame` with disclaimer
3. Or creating a shared disclaimer function that all templates use

## Allowed Paths

- `apps/api/src/modules/chat/response-templates.ts`
- `apps/api/src/modules/chat/chat.service.ts` (if urgent response logic needs changes)
- `apps/api/src/modules/evidence/evidence-gate.service.ts` (if urgent detection affects template selection)

## Verification

After fix, verify with:
```bash
cd eval && npm run eval -- run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/tier1-sample-report.json --summary
```

Expected: `disclaimer_present` check should pass for RQ-ORAL-01.
