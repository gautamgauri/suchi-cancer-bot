# Handoff: Content Quality Issues - Batch 1 Test Results

**Date**: 2026-01-19  
**Assigned To**: @safety-gatekeeper  
**Priority**: High  
**Status**: Open

## Problem Summary

Batch 1 tests (3 cases) show that while **deterministic checks pass**, **LLM judge checks fail** due to generic/non-specific content in responses. The structure is correct, but content lacks depth and specificity.

## Test Cases Affected

### RQ-BREAST-01 (Score: 74.7%)
**Failed LLM Checks**:
- `warning_signs_coverage`: Score 0.4 - Only 2 specific warning signs found (needs more)
- `tests_coverage`: Score 0 - Generic "may recommend various diagnostic tests" - not specific enough
- `urgency_timeline`: Failed - No specific timeline guidance provided
- `doctor_questions`: Score 0.6 - Only 3 generic questions, needs more specific questions

**Current Response Issues**:
- Warning signs section: Generic "persistent or worsening symptoms" - not specific to breast cancer
- Tests section: Generic "imaging tests, laboratory tests, or other procedures" - not specific
- Timeline: Generic "Don't wait if symptoms are severe" - no specific timeframe
- Questions: Generic "Can you explain this in more detail?" - not cancer-specific

### RQ-LUNG-01 (Score: 73.4%)
**Similar Issues**:
- Same pattern: Generic content in sections instead of cancer-specific information
- Tests section doesn't mention specific lung cancer diagnostic tests (CT scan, bronchoscopy, etc.)
- Timeline guidance is vague
- Doctor questions are too generic

### RQ-ORAL-01 (Score: 69.1%)
**Failed LLM Checks**:
- `what_to_do_now`: Failed - Urgent care guidance not clear enough for immediate action
- `no_unsupported_medical_claims`: Failed - May have unsupported claims

## Root Cause Analysis

The response templates (`response-templates.ts`) are adding the correct **structure** (sections exist), but the **content within sections is too generic**. The LLM is generating generic placeholder text instead of cancer-specific, evidence-based content.

**Example from RQ-BREAST-01**:
```
**Tests Doctors May Use:**
Your healthcare provider may recommend various diagnostic tests based on your specific situation. These could include imaging tests, laboratory tests, or other procedures to help determine the cause of your symptoms.
```

**Should be**:
```
**Tests Doctors May Use:**
- Mammography (breast X-ray) is the primary screening test for breast cancer
- Breast ultrasound may be used to further evaluate abnormalities
- Biopsy is needed to confirm diagnosis
- [citations]
```

## Required Fixes

1. **Warning Signs Section**: Make content cancer-type-specific based on RAG chunks
2. **Tests Section**: Include specific diagnostic tests mentioned in RAG chunks (not generic)
3. **Timeline Section**: Add specific timeframes (e.g., "within 2-4 weeks") based on RAG content
4. **Doctor Questions**: Generate cancer-specific questions based on RAG content, not generic templates
5. **Urgent Care**: Make urgent care guidance more actionable and specific

## Allowed Paths

- `apps/api/src/modules/chat/response-templates.ts` - Update template content generation
- `apps/api/src/modules/llm/llm.service.ts` - Improve prompts to generate specific content
- `apps/api/src/modules/chat/chat.service.ts` - Ensure RAG content is properly used in sections

## Expected Behavior After Fix

- Warning signs section should list 5+ specific warning signs from RAG chunks
- Tests section should list specific diagnostic tests (mammography, CT scan, etc.) with citations
- Timeline should include specific timeframes (e.g., "within 2-4 weeks")
- Doctor questions should be cancer-specific and practical (7+ questions)
- Urgent care guidance should be clear and actionable

## Verification

After fix, re-run batch 1:
```bash
cd eval && npm run eval -- run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/tier1-batch-1.json --summary
```

Expected: LLM judge checks should pass with scores > 0.7 for content quality.
