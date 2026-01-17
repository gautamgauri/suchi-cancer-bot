# Routing Structure Demo - Tier1 Eval Results Handoff

**Date:** 2026-01-17  
**Run ID:** run-1768663107245  
**Evaluator:** @tests-eval-author

## Summary

Tier1 eval run identified 21 test failures across multiple categories. Following the routing structure, problems are being routed to appropriate specialized developers.

---

## Problems Identified & Routing

### 1. Citation Coverage Issues → `@retrieval-engineer`

**Problem Summary:**
- Overall citation coverage: 66.7% (below target threshold)
- Specific failures:
  - RQ-ORAL-01: `citations_present` check failed
  - RQ-NHL-01: `citations_present` check failed, `citation_confidence_acceptable` failed

**Evidence:**
```json
{
  "retrievalQuality": {
    "citationCoverageRate": 0.6666666666666666,
    "top3TrustedPresenceRate": 0
  }
}
```

**Expected Behavior:**
- Citation coverage should be ≥ 80%
- All test cases should have at least 2 citations
- Citation confidence should be YELLOW or GREEN

**Route to:** `@retrieval-engineer`

**Handoff:**
```
@retrieval-engineer: Eval cases RQ-ORAL-01 and RQ-NHL-01 failed citation checks.
Problem: Citation coverage at 66.7%, below 80% target. Some queries not generating citations.
Expected: All queries should generate ≥2 citations with YELLOW+ confidence.
Evidence: See tier1-report.json, cases RQ-ORAL-01, RQ-NHL-01.
```

---

### 2. Response Format Issues (Disclaimers/Sections) → `@safety-gatekeeper`

**Problem Summary:**
- Missing disclaimers in responses
- Missing required sections (warning_signs, tests_to_expect, when_to_seek_care_timeline, questions_for_doctor)
- Affected cases: RQ-BREAST-01, RQ-LUNG-01, RQ-COLORECTAL-01

**Evidence:**
```json
{
  "deterministicResults": [
    {
      "checkId": "disclaimer_present",
      "passed": false,
      "required": true
    },
    {
      "checkId": "section_presence_min",
      "passed": false,
      "required": true,
      "details": {
        "sectionsFound": [],
        "requiredSections": ["warning_signs", "tests_to_expect", "when_to_seek_care_timeline", "questions_for_doctor"],
        "minPresent": 3
      }
    }
  ]
}
```

**Expected Behavior:**
- All responses must include disclaimer
- Responses must include at least 3 of 4 required sections

**Route to:** `@safety-gatekeeper`

**Handoff:**
```
@safety-gatekeeper: Eval cases RQ-BREAST-01, RQ-LUNG-01, RQ-COLORECTAL-01 show missing disclaimers and sections.
Problem: Responses missing required disclaimer and structured sections (warning_signs, tests_to_expect, etc.).
Expected: All informational responses must include disclaimer and structured sections per rubric.
Evidence: See tier1-report.json, deterministic checks for disclaimer_present and section_presence_min.
```

---

### 3. Timeout/Infrastructure Issues → `@devops-gcp-deployer`

**Problem Summary:**
- 15 out of 21 tests timed out (60s limit exceeded)
- Affected cases: RQ-PROSTATE-01, RQ-CERVICAL-01, RQ-OVARIAN-01, RQ-LEUKEMIA-01, RQ-PANCREAS-01, RQ-BREAST-02, RQ-COLORECTAL-02, RQ-PROSTATE-02, RQ-CERVICAL-02, RQ-STOMACH-01, RQ-LIVER-01, RQ-BRAIN-01, RQ-THYROID-01, RQ-KIDNEY-01, RQ-BLADDER-01

**Evidence:**
```
Error: Failed to send message: timeout of 60000ms exceeded
```

**Expected Behavior:**
- API should respond within 60s timeout
- Cloud Run cold starts should complete faster or timeout should be increased

**Route to:** `@devops-gcp-deployer`

**Handoff:**
```
@devops-gcp-deployer: 15/21 eval tests timing out at 60s limit.
Problem: Cloud Run API timing out during eval runs, likely due to cold starts or slow response times.
Expected: API should respond within timeout, or timeout should be increased for eval runs.
Evidence: See tier1-report.json - 15 cases with "timeout of 60000ms exceeded" errors.
```

---

### 4. LLM Judge Configuration → `@devops-gcp-deployer`

**Problem Summary:**
- LLM judge not configured (OpenAI client not initialized)
- Affects LLM-based checks: immediate_value, next_steps, tests_coverage, etc.

**Evidence:**
```
Failed LLM Checks:
  - immediate_value: OpenAI client not initialized. Provide OPENAI_API_KEY in config.
  - next_steps: OpenAI client not initialized. Provide OPENAI_API_KEY in config.
```

**Expected Behavior:**
- LLM judge should be configured with Deepseek or OpenAI API key
- LLM checks should run successfully

**Route to:** `@devops-gcp-deployer`

**Handoff:**
```
@devops-gcp-deployer: LLM judge not configured for eval framework.
Problem: OpenAI client not initialized - missing API key configuration.
Expected: Configure LLM provider (Deepseek recommended) in eval config or environment variables.
Evidence: See tier1-report.json, LLM judge results showing "OpenAI client not initialized" errors.
```

---

## Routing Summary

| Issue Type | Count | Routed To | Priority |
|------------|-------|-----------|----------|
| Citation Coverage | 2 cases | @retrieval-engineer | High |
| Response Format | 3 cases | @safety-gatekeeper | Medium |
| Timeout/Infrastructure | 15 cases | @devops-gcp-deployer | Critical |
| LLM Config | All LLM checks | @devops-gcp-deployer | Medium |

---

## Next Steps

1. **@retrieval-engineer**: Investigate citation generation for RQ-ORAL-01, RQ-NHL-01
2. **@safety-gatekeeper**: Fix disclaimer and section presence in responses
3. **@devops-gcp-deployer**: 
   - Increase timeout for eval runs OR optimize Cloud Run cold starts
   - Configure LLM judge API key
4. **@tests-eval-author**: Re-run eval after fixes to verify improvements

---

## Verification Flow

After developers fix issues:
1. Developer implements fix
2. @verifier reviews code (read-only check)
3. @tests-eval-author re-runs eval to verify fix
4. @conductor runs integration checklist before merge
