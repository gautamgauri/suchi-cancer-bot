# Handoff: Missing Required Sections in Responses

**Date**: 2026-01-19  
**Assigned To**: @safety-gatekeeper  
**Priority**: High  
**Status**: Open

## Problem Summary

Two test cases are failing the `section_presence_min` check because responses are missing required sections:

- **RQ-BREAST-01**: Only 1/4 required sections found (`questions_for_doctor`)
- **RQ-LUNG-01**: Only 2/4 required sections found (`tests_to_expect`, `questions_for_doctor`)

**Requirement**: At least 3 out of 4 sections must be present:
- `warning_signs`
- `tests_to_expect`
- `when_to_seek_care_timeline`
- `questions_for_doctor`

## Root Cause Analysis

The `explainModeFrame` function in `apps/api/src/modules/chat/response-templates.ts` only conditionally adds sections based on `queryType`:

1. **For symptoms queries**: Adds `warning_signs` and `when_to_seek_care_timeline`, but NOT `tests_to_expect`
2. **For diagnosis/screening queries**: Adds `tests_to_expect`, but NOT `warning_signs` or `when_to_seek_care_timeline`

The eval requires ALL informational queries to include at least 3 of the 4 sections, regardless of query type.

## Test Case Details

### RQ-BREAST-01 (Symptoms Query)
- **Query Type**: `symptoms`
- **Sections Found**: `questions_for_doctor` only
- **Missing**: `warning_signs`, `tests_to_expect`, `when_to_seek_care_timeline`
- **Response Excerpt**: 
  ```
  **Important:** This information is for general educational purposes...
  - A lump in or near your breast can be a symptom...
  **Questions to Ask Your Doctor:**
  • Can you explain this in more detail?
  ```

### RQ-LUNG-01 (Diagnosis Query)
- **Query Type**: `diagnosis` or `screening`
- **Sections Found**: `tests_to_expect`, `questions_for_doctor`
- **Missing**: `warning_signs`, `when_to_seek_care_timeline`
- **Response Excerpt**:
  ```
  **Important:** This information is for general educational purposes...
  - Non-small cell lung cancer is usually diagnosed with tests...
  **Questions to Ask Your Doctor:**
  • What do these test results mean?
  ```

## Section Detection Patterns

The eval uses these regex patterns to detect sections (from `eval/runner/deterministic-checker.ts`):

- **warning_signs**: `/warning signs?/i`, `/signs? to watch/i`, `/symptoms? to watch/i`, `/red flags?/i`
- **tests_to_expect**: `/tests? (doctors?|clinicians?|may|will) (use|perform|order|do)/i`, `/diagnostic (tests?|methods?|procedures?)/i`, `/tests? to expect/i`
- **when_to_seek_care_timeline**: `/when to seek (care|medical attention|help)/i`, `/when should/i`
- **questions_for_doctor**: `/questions? (to ask|for|you should ask)/i`, `/ask (your |the )?doctor/i`

## Required Fix

Update `explainModeFrame` in `apps/api/src/modules/chat/response-templates.ts` to ensure ALL informational queries include at least 3 of the 4 required sections:

1. **For symptoms queries**: Add `tests_to_expect` section
2. **For diagnosis/screening queries**: Add `warning_signs` and `when_to_seek_care_timeline` sections
3. **For general queries**: Include all 4 sections

## Allowed Paths

- `apps/api/src/modules/chat/response-templates.ts`
- `apps/api/src/modules/chat/chat.service.ts` (if template invocation needs changes)

## Verification

After fix, verify with:
```bash
cd eval && npm run eval -- run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/tier1-sample-report.json --summary
```

Expected: `section_presence_min` check should pass for RQ-BREAST-01 and RQ-LUNG-01.
