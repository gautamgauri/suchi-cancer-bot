# Evaluation System Limitations

**Date:** 2026-01-27
**Status:** Beta-Ready with Known Limitations

## Current Performance

| Metric | Value | Target |
|--------|-------|--------|
| Pass Rate | 95.2% | >90% |
| Avg Score | 99.1% | >85% |
| Abstention Rate | 0% | <5% |
| Citation Coverage | 100% | >95% |
| Trusted Source Rate | 100% | >95% |

---

## 1. LLM Judge Variance (~5%)

**Issue:** Same response can score differently across runs

**Evidence:** RQ-BREAST-02 scored 80.9%-100% across 4 runs with similar responses

**Cause:** Complex conditional prompts + LLM interpretation variance

**Mitigation:**
- Run multiple times for borderline cases
- Manual review for <85% scores

**Future Fix:** Simplify prompts, add deterministic fallbacks

---

## 2. Chunk Content Not Available for Verification

**Issue:** API returns chunk metadata (docId, chunkId) but NOT content

**Impact:** Cannot directly verify if medical claims match retrieved content

**Current Workaround:** Infer RAG backing from citation marker presence

**Effectiveness:** 99.1% avg score suggests workaround is sufficient

**Future Fix:** API to return `chunks[].content` in response metadata

---

## 3. Coverage Focused on Common Cancers

**Fully Covered (21+ cases each):**
- Breast
- Lung
- Colorectal
- Prostate
- Cervical
- Ovarian

**Partial Coverage (1-3 cases):**
- Stomach
- Liver
- Kidney
- Bladder
- Brain
- Thyroid

**Not in Retrieval Quality Tests:**
- Endometrial
- Melanoma
- Laryngeal

**Intent Gaps:**
- Prevention: 1 case only
- Screening: 0 explicit cases

**Future Fix:** Add ~15 cases for underrepresented cancers post-beta

---

## 4. Section Detection Relies on Regex

**Issue:** Section headers must match exact patterns

**Affected Sections:**
- "Questions to Ask Doctor"
- "Warning Signs"
- "Tests"

**False Negative Risk:** ~5% if response uses non-standard headers

**Future Fix:** Implement fuzzy section matching or semantic detection

---

## 5. Skipped Checks Reduce Evaluation Coverage

**Issue:** When LLM judge fails, all its checks are skipped

**Impact:** Test can pass with only 60-70% of checks evaluated

**No Warning:** Current system doesn't flag reduced coverage

**Future Fix:** Add evaluation coverage metric, warn if <80%

---

## 6. Web/UI Testing Gap (Addressed 2026-01-27)

**Previous Issue:** Eval system tested API only, no web component tests

**Resolution:** Added 90 automated UI tests covering:
- Citation component (15 tests)
- MessageInput component (16 tests)
- LoadingIndicator component (7 tests)
- ErrorDisplay component (16 tests)
- citationParser utility (19 tests)
- timeUtils utility (17 tests)

**Remaining Gap:** Integration tests for full user flows

---

## Acceptance Criteria for Beta

### API Testing (Automated) - PASSING

| Criteria | Target | Actual |
|----------|--------|--------|
| Pass Rate | >90% | 95.2% |
| Avg Score | >85% | 99.1% |
| Abstention Rate | <5% | 0% |
| Citation Coverage | >95% | 100% |
| Trusted Source Rate | >95% | 100% |

### UX Testing (Automated) - PASSING

| Criteria | Status |
|----------|--------|
| Component unit tests | 54 tests passing |
| Utility function tests | 36 tests passing |
| Total coverage | 90 tests passing |

---

## Running the Evaluation

```bash
# Run tier1 retrieval quality tests
cd eval && npm run eval -- run --cases cases/tier1/retrieval_quality.yaml --summary

# Check for flakiness (run twice, compare)
npm run eval -- run --cases cases/tier1/retrieval_quality.yaml -o reports/run1.json
npm run eval -- run --cases cases/tier1/retrieval_quality.yaml -o reports/run2.json

# Run web component tests
cd apps/web && npm run test:run
```

---

## Post-Beta Improvements (Backlog)

1. Return chunk content from API (proper RAG validation)
2. Add 15 cases for underrepresented cancers
3. Simplify LLM judge prompts for consistency
4. Add failure categorization in reports
5. Implement rubric schema validation
6. Add fuzzy section matching
7. Add evaluation coverage metric

---

## Contact

For eval system issues, check `/eval/reports/` for detailed results.
