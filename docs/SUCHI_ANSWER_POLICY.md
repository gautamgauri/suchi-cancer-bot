# Suchi Answer Policy - Trust-First RAG v2

**Last Updated:** 2026-01-20  
**Version:** 2.0

---

## Core Invariant

**Medical information MUST be grounded in knowledge base evidence with stored citations.**

If Suchi provides medical information, it must:
1. Use **2–5 citations** pointing to KbChunk/KbDocument
2. Be grounded **only in retrieved evidence**
3. Have **passed evidence gate validation**

### The Rule: No Citations → No Medical Content

Medical content without citations must never be returned to users. When evidence is insufficient, Suchi returns a SafeFallbackResponse (navigational guidance only).

---

## Medical vs Non-Medical Content

### Medical Content (REQUIRES 2+ Citations)

Content that includes any of the following:

#### Clinical Information
- **Symptoms & Warning Signs:** "persistent cough," "blood in stool," "unexplained weight loss"
- **Causes & Risk Factors:** "smoking increases risk," "BRCA mutations," "HPV infection"
- **Diagnostic Information:** "biopsy confirms diagnosis," "CT scan shows," "staging process"
- **Prognosis & Staging:** "stage 3 means," "5-year survival rate," "disease progression"

#### Treatment Information
- **Treatment Options:** "surgery," "chemotherapy," "radiation therapy," "immunotherapy"
- **Procedures:** "lumpectomy," "mastectomy," "colonoscopy," "port placement"
- **Drug Names & Regimens:** "Tamoxifen," "FOLFOX," "Herceptin," "dosage schedules"
- **Side Effects & Management:** "nausea from chemo," "radiation burns," "managing fatigue"

#### Medical Advice
- **Screening Recommendations:** "mammogram at age 40," "colonoscopy every 10 years"
- **"What Should I Do Medically":** Any guidance on when/how to seek medical care for symptoms

**Examples (all require citations):**
- ❌ "Lung cancer symptoms include persistent cough, shortness of breath..."
- ❌ "Chemotherapy can cause nausea, fatigue, and hair loss..."
- ❌ "Mammograms are recommended starting at age 40..."
- ❌ "Stage 3 cancer means the disease has spread to lymph nodes..."

---

### Non-Medical Content (No Citations Required)

Content that is purely navigational, supportive, or procedural:

#### Navigation & Process Guidance
- **Finding Providers:** "I recommend speaking with your oncologist," "consider getting a second opinion"
- **Appointment Preparation:** "bring your medical records," "write down questions for your doctor"
- **Healthcare System Navigation:** "ask about financial assistance," "understand your insurance coverage"

#### Support Resources
- **Emotional Support:** "it's normal to feel anxious," "many patients find support groups helpful"
- **Caregiver Guidance:** "caregivers can help by," "self-care for caregivers"
- **Resource Links:** "You can find information at cancer.gov" (link only, no paraphrasing)

**Examples (no citations needed):**
- ✅ "I recommend speaking with your oncologist about these symptoms."
- ✅ "You can find support groups at cancer.gov."
- ✅ "Consider getting a second opinion from a cancer center."

---

## Citation Requirements

### Sufficient Evidence (Proceed with LLM)

Evidence is sufficient when:
- **At least 2 distinct KbDocument sources** with good quality chunks (similarity >0.5), OR
- **1 Tier-1 trusted guideline** (NCI, WHO, NCG) with high confidence (similarity >0.7)

**Evidence Quality Checks:**
1. Minimum chunk count (varies by query type)
2. Source trustworthiness (all chunks from trusted sources)
3. Source diversity (multiple independent sources preferred)
4. Recency (for time-sensitive topics like treatment guidelines)

### Insufficient Evidence (Block LLM, Return SafeFallbackResponse)

Evidence is insufficient when:
- **NO_RESULTS:** No retrieved chunks match the query
- **LOW_TRUST:** All chunks from untrusted/unverified sources
- **LOW_SCORE:** Chunk similarity scores too low (<0.3)
- **LOW_DIVERSITY:** Only 1 source and low confidence
- **RECENCY_FAIL:** Content outdated for time-sensitive query
- **FILTERED_OUT:** All chunks filtered by safety rules

**Action:** No LLM call. Return SafeFallbackResponse immediately.

---

## SafeFallbackResponse Rules

When evidence is insufficient, SafeFallbackResponse must:

### ✅ Do Include
- Clear statement that KB lacks specific information
- Referral to healthcare provider for personalized guidance
- Links to trusted organization homepages (NCI, WHO, ACS)
- Warm, empathetic tone acknowledging the user's need

### ❌ Do NOT Include
- Any medical advice (symptoms, treatments, drug names, clinical guidance)
- Paraphrased content from knowledge base chunks
- Generic health tips or recommendations
- Diagnostic suggestions or symptom interpretations

### SafeFallbackResponse Template

```
I don't have enough specific information in my knowledge base to answer this accurately.

For personalized medical guidance, please consult with your healthcare provider or oncology team.

You may also find general information at:
- National Cancer Institute: https://www.cancer.gov
- WHO Cancer Resources: https://www.who.int/health-topics/cancer
```

**Reason-Specific Additions:**

- **NO_RESULTS:** "This topic may require more specialized medical knowledge than I currently have access to."
- **LOW_TRUST:** "I can only provide information from verified medical sources, and I don't have sufficient trusted sources for this query."
- **INSUFFICIENT_CITATIONS:** "I couldn't verify the information with reliable source citations."

---

## Runtime Citation Enforcement

After LLM generates a response:

1. **Extract Citations:** Parse response text for citation markers
2. **Check Content Type:** Determine if response contains medical content
3. **Enforce Minimum:** If medical AND citations < 2:
   - **Discard entire LLM response**
   - Replace with SafeFallbackResponse
   - Log structured error for investigation
   - Increment citation_enforcement_failed metric

**No exceptions.** Medical content without sufficient citations is never returned.

### Medical Content Detection

Content is classified as "medical" if:
- **Intent-based:** Query intent is INFORMATIONAL_GENERAL, INFORMATIONAL_SYMPTOMS, INFORMATIONAL_TREATMENT, INFORMATIONAL_SIDE_EFFECTS
- **Keyword-based:** Response contains medical keywords (symptom, treatment, drug names, side effects, diagnosis, etc.)

---

## Model-Agnostic Design

All policy enforcement must work regardless of LLM backend:

- **Evidence gating** happens BEFORE LLM selection
- **Citation extraction** works with any LLM output format
- **SafeFallbackResponse** never touches LLM

**Supported LLMs:** Gemini, DeepSeek, GPT-4, Claude, or any other model

---

## Logging & Observability

All blocking decisions must be logged with structured data:

### Evidence Gate Blocked
```json
{
  "event": "evidence_gate_blocked",
  "reasonCode": "NO_RESULTS",
  "reason": "No relevant information found in knowledge base",
  "queryType": "symptoms",
  "chunkCount": 0,
  "sessionId": "...",
  "query": "first 200 chars"
}
```

### Citation Enforcement Failed
```json
{
  "event": "citation_enforcement_failed",
  "sessionId": "...",
  "messageId": "...",
  "query": "first 200 chars",
  "intent": "INFORMATIONAL_SYMPTOMS",
  "citationCount": 0,
  "responsePreview": "first 200 chars"
}
```

---

## Exceptions & Edge Cases

### When 0-1 Citations Are Acceptable

- **Pure Navigation:** "I recommend seeing an oncologist" (no medical facts)
- **Emotional Support:** "It's normal to feel anxious" (no clinical advice)
- **Process Guidance:** "Bring your reports to the appointment" (no medical content)

### When Citations May Be Lower Quality

- **General Education:** User explicitly asks "generally speaking" or "in general"
- **Non-Personal Questions:** "How is cancer diagnosed?" (not "Am I having symptoms?")
- **Follow-up Clarifications:** Building on previous cited response

**However:** Even in these cases, if specific medical facts are stated, citations are required.

---

## Compliance & Audit

### For Auditors
- All medical responses have 2-5 citations linking to KbChunk/KbDocument
- All citations are verifiable in database (MessageCitation table)
- All abstention decisions logged with reason codes
- SafeFallbackResponse never contains medical advice

### For Developers
- Test suite validates citation enforcement (`eval/hybrid_retrieval_scenarios.json`)
- Structured logging enables monitoring and alerting
- Evidence gate metrics track rejection rates by reason code

---

## Version History

- **v2.0** (2026-01-20): Trust-First RAG v2 - Hard evidence gating, runtime citation enforcement
- **v1.0** (2025-XX-XX): Initial policy with soft evidence checks

---

## Questions or Clarifications?

For policy questions: Contact medical team or compliance  
For technical implementation: See `docs/ops/handoffs/2026-01-20-safety-gatekeeper-trust-first-rag-v2.md`
