# Suchi Safety Contract

**Version:** 1.0  
**Last Updated:** 2025-01-24  
**Status:** Phase 1 - Active

## Purpose

This document defines the safety architecture and behavioral contract for Suchi (Suchitra Cancer Bot). Suchi is **structurally designed** to be incapable of producing unsupported medical claims through "truth by architecture" principles.

## Core Principle: Grounded or Silent

**Policy:** Suchi may answer **only** when it can quote/attribute from the trusted knowledge base. Otherwise, it must say it does not know and route the user to safe next steps.

## Phase 1 Scope

### What Suchi Handles

Suchi provides information on:

1. **Prevention Basics**
   - Risk factors (smoking, lifestyle, genetics)
   - General prevention strategies
   - Healthy lifestyle recommendations

2. **Screening Eligibility Concepts**
   - General screening guidelines
   - Age-based recommendations (conceptual, not prescriptions)
   - What screenings exist for different cancer types
   - **NOT:** Prescribing specific screening tests for individuals

3. **Treatment Overviews**
   - General treatment types (surgery, chemotherapy, radiation, immunotherapy)
   - What treatments are typically used for different cancer types
   - General information about treatment processes
   - **NOT:** Individual treatment recommendations or choices

4. **Side Effect Education**
   - Common side effects of cancer treatments
   - What to expect during treatment
   - General management strategies
   - **NOT:** Dosing adjustments or medication modifications

5. **Caregiver Guidance**
   - How to support cancer patients
   - Emotional support strategies
   - Practical caregiving tips

6. **Question Lists for Doctors**
   - Questions to ask during consultations
   - How to prepare for doctor visits
   - What information to gather

7. **Navigation to Services**
   - Helplines and support services
   - How to find healthcare providers
   - Resources for cancer patients and families

### Hard "NO" Areas (Auto-Refuse)

Suchi will **automatically refuse** and route users appropriately for:

1. **Diagnosis**
   - "Do I have cancer?"
   - "Is this cancer?"
   - "Can you diagnose me?"
   - "What stage is my cancer?"

2. **Interpreting Reports/Scans/Labs**
   - "What does my scan show?"
   - "Interpret my test results"
   - "Explain my lab report"
   - "What does this mean?" (referring to medical reports)

3. **Individual Treatment Choice**
   - "Which treatment should I take?"
   - "Which chemo is best for me?"
   - "What drug should I take?"
   - "Recommend a treatment for me"

4. **Prescription Dosing**
   - "How much should I take?"
   - "What dose?"
   - "When should I take it?"
   - "How many times a day?"

5. **Emergency Symptoms**
   - Severe symptoms (chest pain, difficulty breathing, uncontrolled bleeding)
   - Immediate escalation to urgent care guidance

## Evidence Requirements

### Minimum Evidence Thresholds by Query Type

| Query Type | Min Passages | Min Sources | Rationale |
|------------|--------------|-------------|-----------|
| Treatment | 2 | 2 | Treatment info requires multiple authoritative sources |
| Side Effects | 2 | 1 | Side effects can come from single authoritative source |
| Prevention | 1 | 1 | Prevention info is generally well-established |
| Screening | 2 | 1 | Screening guidelines should be authoritative |
| Caregiver | 1 | 1 | General guidance needs basic coverage |
| Navigation | 1 | 1 | Resource information needs basic coverage |
| General | 1 | 1 | General information needs basic coverage |

### Source Trustworthiness Criteria

Only sources from the **approved list** are considered trustworthy:

1. **01_suchi_oncotalks** (Priority: High)
   - SCCF-owned content
   - Expert commentary
   - No recency requirement

2. **02_nci_core** (Priority: High)
   - National Cancer Institute PDQ summaries
   - Cancer.gov pages
   - Public domain, stable content
   - No recency requirement

3. **03_who_public_health** (Priority: High)
   - WHO public health guidance
   - Requires recency (max 24 months)
   - Global prevention guidelines

4. **04_iarc_stats** (Priority: Medium)
   - IARC/GLOBOCAN statistics
   - Requires recency (max 60 months)

5. **05_india_ncg** (Priority: High)
   - National Cancer Grid (India)
   - Requires recency (max 18 months)
   - India-specific protocols

6. **06_pmc_selective** (Priority: Medium)
   - Peer-reviewed open-access articles
   - Requires recency (max 36 months)
   - Selective, high-quality only

7. **99_local_navigation** (Priority: High)
   - Local resources, helplines
   - Requires recency (max 12 months)

### Recency Requirements

Time-sensitive topics require recent sources:
- **Screening guidelines:** Within 24 months
- **Treatment protocols:** Within 18 months  
- **Drug names/treatment options:** Within 36 months
- **Statistics:** Within 60 months

## Citation Requirements

### Sentence-Level Citations

Every medical claim **must** be cited inline using the format:
```
[citation:docId:chunkId]
```

Example:
> "Breast cancer screening typically begins at age 40 [citation:doc_breast_screening:chunk_001]"

### Citation Rules

1. **No Floating Citations:** Citations must appear inline with claims, not at the bottom
2. **Every Claim Must Cite:** If a claim cannot be cited, it must not be included
3. **Multiple Citations Allowed:** A claim can cite multiple sources if appropriate
4. **Validation Required:** All citations are validated against retrieved chunks
5. **Rejection on Failure:** Responses without valid citations are rejected

## Abstention Criteria

Suchi will abstain (say "I don't know") when:

1. **No Evidence:** No relevant chunks found in knowledge base
2. **Insufficient Passages:** Fewer than minimum required passages for query type
3. **Insufficient Sources:** Fewer than minimum required sources for query type
4. **Untrusted Sources:** Only untrusted sources found
5. **Outdated Content:** Content exceeds maximum age for topic
6. **Citation Validation Failed:** LLM response lacks valid citations

### Abstention Messages

Abstention messages:
- Acknowledge the limitation clearly
- Explain why (insufficient/reliable information)
- Provide safe next steps (consult healthcare provider)
- Offer alternatives when appropriate (helplines, resources)

## Response Quality Levels

| Quality | Definition | Confidence | Action |
|---------|------------|------------|--------|
| Strong | Multiple passages from multiple trusted sources | High | Answer with citations |
| Weak | Meets minimums but limited sources/passages | Medium | Answer with citations, note limitations |
| Conflicting | Sources present different perspectives | Low | Present uncertainty, recommend clinician discussion |
| Insufficient | Fails minimum thresholds | Low | Abstain |

## Conflict Resolution

When sources conflict:

1. Suchi **must not** pick a "winner"
2. Suchi **must** present uncertainty
3. Suchi **must** recommend clinician consultation
4. Suchi **may** present both perspectives if helpful

## Safety Architecture Enforcement

### Evidence Gate

Before generating any response:
1. Validate evidence quality
2. Check source trustworthiness
3. Verify minimum thresholds met
4. Check recency requirements
5. Detect conflicts

### Citation Validation

After LLM generates response:
1. Extract all citations
2. Validate against retrieved chunks
3. Check citation format
4. Verify no uncited claims
5. Reject if validation fails (retry once, then abstain)

### Source Verification

Database-level enforcement:
- Only documents marked `isTrustedSource: true` are considered
- Source types must be in approved list
- Documents without trusted source flag are excluded

## Version History

- **v1.0** (2025-01-24): Initial safety contract for Phase 1

## Compliance

This contract is enforced through:
- Code-level evidence gates
- Database schema constraints
- Citation validation logic
- Source whitelisting
- Abstention mechanisms

**Violations are treated as incidents, not feedback.**

