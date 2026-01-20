# Deterministic Extraction Layer: System Flow & Expected Gains

## Problem Statement

**Before**: LLM was asked to both **discover facts** and **compose answers** in one pass, leading to:
- Inconsistent extraction (2 tests when 5+ exist in RAG chunks)
- Prompt brittleness (same prompt, different results)
- Early safety defaults ("I don't have enough information" when info exists)
- Under-extraction failures in eval (`tests_coverage`, `warning_signs_coverage`)

## Solution: Extract → Generate → Enforce

We split responsibilities:
- **Extractor**: Deterministically discovers facts from RAG chunks (pattern matching)
- **LLM**: Composes natural language prose (with checklist guidance)
- **Enforcer**: Ensures completeness contract is met (post-processing fallback)

## System Flow

### Visual Flow Diagram

```mermaid
flowchart TD
    A[User Query] --> B[RAG Retrieval]
    B --> C[Evidence Chunks<br/>5 tests, 5 signs, timeline]
    
    C --> D[STEP 1: Deterministic Extraction]
    D --> E[Pattern Match:<br/>CT, MRI, biopsy, mammogram, ultrasound<br/>lump, discharge, dimpling, weight loss, fatigue<br/>timeline: 2-4 weeks]
    E --> F[StructuredInfo<br/>diagnosticTests: 5<br/>warningSigns: 5<br/>timeline: found]
    
    F --> G[STEP 2: Checklist Generation]
    G --> H[formatForPrompt<br/>DIAGNOSTIC TESTS FOUND:<br/>- CT scan [citation:...]<br/>- MRI [citation:...]<br/>...<br/>You must cover every item]
    
    H --> I[STEP 3: LLM Generation]
    I --> J[LLM sees:<br/>- Reference chunks<br/>- Pre-extracted checklist]
    J --> K[LLM Response:<br/>Tests: CT, MRI, biopsy,<br/>mammogram, ultrasound]
    
    K --> L[STEP 4: Completeness Check]
    L --> M{Meets Policy?}
    M -->|Yes| N[Final Response<br/>Complete ✅]
    M -->|No| O[STEP 5: Fallback]
    O --> P[Insert Missing Items<br/>with Citations]
    P --> N
    
    style D fill:#e1f5ff
    style G fill:#e1f5ff
    style L fill:#e1f5ff
    style O fill:#ffe1e1
    style N fill:#e1ffe1
```

### Before (LLM-Only Generation)

```
User Query
    ↓
RAG Retrieval (chunks with 5 tests, 5 signs)
    ↓
LLM Prompt: "Extract ALL tests and signs from chunks"
    ↓
LLM Response: "Tests: CT scan, biopsy" (only 2 of 5) ❌
    ↓
Response Validator: Checks for ungrounded entities
    ↓
Final Response (incomplete)
```

**Issues**:
- LLM inconsistently extracts (sometimes 2, sometimes 4, rarely all 5)
- No guarantee of completeness
- Eval fails: `tests_coverage` score low

### After (Extract → Generate → Enforce)

```
User Query
    ↓
RAG Retrieval (chunks with 5 tests, 5 signs)
    ↓
┌─────────────────────────────────────────┐
│ STEP 1: DETERMINISTIC EXTRACTION        │
│ - Pattern match: CT, MRI, biopsy,      │
│   mammogram, ultrasound                 │
│ - Pattern match: lump, discharge,       │
│   dimpling, weight loss, fatigue        │
│ - Extract timeline: "2-4 weeks"        │
│ Output: StructuredInfo (all entities)  │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ STEP 2: CHECKLIST GENERATION           │
│ formatForPrompt(extraction) →          │
│ "DIAGNOSTIC TESTS FOUND:               │
│  - CT scan [citation:doc1:chunk1]      │
│  - MRI [citation:doc1:chunk1]          │
│  - Biopsy [citation:doc1:chunk1]      │
│  - Mammogram [citation:doc1:chunk1]    │
│  - Ultrasound [citation:doc1:chunk1]  │
│ You must cover every checklist item"   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ STEP 3: LLM GENERATION (with checklist)│
│ LLM sees:                               │
│ - Reference chunks (full text)         │
│ - Pre-extracted checklist (5 tests)     │
│ LLM generates prose covering checklist │
│ Output: "Tests: CT scan, MRI, biopsy,  │
│          mammogram, ultrasound" ✅      │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ STEP 4: COMPLETENESS CHECK             │
│ checkCompleteness(response, extraction) │
│ - Found: 5 tests ✅                     │
│ - Required: 4 tests (policy)            │
│ - Meets policy: YES                    │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ STEP 5: FALLBACK (if needed)            │
│ If LLM only mentioned 2 tests:           │
│ - Generate fallback section             │
│ - Insert: "Additional tests: MRI,       │
│   mammogram, ultrasound [citations]"    │
│ - Ensures policy is met                 │
└─────────────────────────────────────────┘
    ↓
Final Response (complete, all tests included)
```

## Expected Gains

### 1. Consistency (Deterministic Coverage)

**Before**: 
- Same RAG chunks → different LLM outputs
- Sometimes 2 tests, sometimes 4, rarely all 5

**After**:
- Same RAG chunks → same extraction (pattern matching)
- LLM guided by checklist → more consistent coverage
- Fallback ensures minimum requirements always met

**Metric**: Coefficient of variation in `tests_coverage` should decrease

### 2. Completeness (Contract-Based)

**Before**:
- No guarantee of minimum coverage
- Eval fails: "only 2 tests when 4+ required"

**After**:
- CompletenessPolicy per query type:
  - `diagnosis`: 4 tests, 4 signs, timeline required
  - `symptoms`: 2 tests, 5 signs, timeline required
  - `general`: 2 tests, 2 signs, timeline optional
- Post-processing enforces contract

**Metric**: `tests_coverage` and `warning_signs_coverage` should consistently meet policy

### 3. Better Eval Scores

**Before** (from eval reports):
- `tests_coverage`: 0.67 (2 tests when 3+ required)
- `warning_signs_coverage`: 0 (missing signs)
- `urgency_timeline`: 0 (missing timeline)

**After** (expected):
- `tests_coverage`: 0.8+ (4+ tests consistently)
- `warning_signs_coverage`: 0.8+ (5+ signs consistently)
- `urgency_timeline`: 0.8+ (timeline included when in sources)

### 4. Cost Reduction

**Before**:
- LLM token usage: High (LLM must discover + compose)
- Retries: More common (inconsistent results)

**After**:
- LLM token usage: Lower (checklist is concise, LLM just composes)
- Retries: Less common (deterministic extraction, fallback handles gaps)

**Metric**: Token usage per response should decrease ~10-15%

### 5. Observability

**Before**:
- Debug logs only
- No visibility into extraction vs generation vs enforcement

**After**:
- Structured logs with:
  - `extracted: { tests: 5, signs: 5, timeline: true }`
  - `coverage: { tests: { found: 4, required: 4 } }`
  - `fallbackInserted: false`
  - `meetsPolicy: true`

**Metric**: Can track fallback trigger rates over time

### 6. Testability

**Before**:
- Hard to test (LLM output is non-deterministic)
- Eval is only reliable test

**After**:
- Unit tests for extractor (deterministic)
- Integration tests for pipeline (mock LLM, verify fallback)
- Property tests (same chunks → same extraction)

**Metric**: Test coverage increases, faster feedback loop

## Real-World Example

### Scenario: "What tests are used for breast cancer diagnosis?"

**RAG Chunks Retrieved**:
- Chunk 1: "Diagnosis requires clinical exam, mammogram, ultrasound, and biopsy."
- Chunk 2: "Additional tests include MRI and PET scan for staging."

**Before (LLM-Only)**:
```
LLM Response:
"Tests Doctors May Use:
- Mammogram [citation:doc1:chunk1]
- Biopsy [citation:doc1:chunk1]"

Eval Result: tests_coverage = 0.4 (2/5) ❌
```

**After (Extract → Generate → Enforce)**:
```
Step 1: Extractor finds 5 tests (clinical exam, mammogram, ultrasound, biopsy, MRI)
Step 2: Checklist: "Cover: clinical exam, mammogram, ultrasound, biopsy, MRI"
Step 3: LLM generates: "Tests: clinical exam, mammogram, ultrasound, biopsy, MRI"
Step 4: Completeness check: 5 found, 4 required ✅
Step 5: No fallback needed

Final Response:
"Tests Doctors May Use:
- Clinical exam [citation:doc1:chunk1]
- Mammogram [citation:doc1:chunk1]
- Ultrasound [citation:doc1:chunk1]
- Biopsy [citation:doc1:chunk1]
- MRI [citation:doc2:chunk2]"

Eval Result: tests_coverage = 1.0 (5/5) ✅
```

## Fallback Scenario

**If LLM under-extracts** (only mentions 2 tests):
```
Step 4: Completeness check: 2 found, 4 required ❌
Step 5: Fallback inserts:
"Additional tests your doctor may recommend:
- Ultrasound [citation:doc1:chunk1]
- MRI [citation:doc2:chunk2]"

Final Response: Still meets policy ✅
```

## Key Design Principles

1. **Separation of Concerns**:
   - Extractor: Fact discovery (deterministic)
   - LLM: Prose composition (probabilistic, but guided)
   - Enforcer: Contract fulfillment (deterministic)

2. **Fail-Safe**:
   - If LLM fails, fallback ensures policy is met
   - If extractor fails, LLM can still generate (graceful degradation)

3. **Observability**:
   - Structured logs show where failures occur
   - Can track if fallback triggers decrease over time (LLM improving)

4. **Testability**:
   - Deterministic components are easily testable
   - Integration tests verify full pipeline

## Success Metrics

After deployment, we should see:

1. **Eval Scores**:
   - `tests_coverage`: 0.8+ (up from 0.67)
   - `warning_signs_coverage`: 0.8+ (up from 0)
   - `urgency_timeline`: 0.8+ (up from 0)

2. **Consistency**:
   - Same chunks → same extraction (100% deterministic)
   - LLM coverage variance decreases

3. **Fallback Rate**:
   - Initial: ~30-40% (LLM still learning)
   - Target: <10% (LLM improves with checklist guidance)

4. **Cost**:
   - Token usage: -10-15% per response
   - Retries: -20-30%

5. **Observability**:
   - Structured logs in Cloud Logging
   - Can query: "fallbackInserted:true" to see failure patterns
