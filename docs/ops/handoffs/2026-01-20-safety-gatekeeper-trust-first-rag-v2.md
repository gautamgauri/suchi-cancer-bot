# Trust-First RAG v2 - Safety & Evidence Gate Workstream

**Date:** 2026-01-20  
**Agent:** @safety-gatekeeper  
**Scope:** Phase 1 - Evidence-based gating + citation enforcement  
**Priority:** CRITICAL - Core trust-first invariant enforcement

---

## Objective

Enforce **no acceptable evidence → no LLM call → SafeFallbackResponse** invariant throughout the chat pipeline. Ensure all medical responses have 2-5 citations or are rejected.

---

## Context

Current `EvidenceGateService` validates evidence quality but doesn't block LLM calls on insufficient evidence. `ChatService` sometimes calls LLM even when evidence is weak.

**Phase 1 Goal:** Make the evidence gate a hard blocker:
- Insufficient evidence → NO LLM call → SafeFallbackResponse
- Medical response without 2-5 citations → discard → SafeFallbackResponse
- All decisions logged with structured reasoning

---

## Tasks

### 1. Create Policy Document

**File:** `docs/SUCHI_ANSWER_POLICY.md` (new)

Document the trust-first rules:

```markdown
# Suchi Answer Policy - Trust-First RAG v2

## Core Invariant

**Medical information MUST be grounded in knowledge base evidence with stored citations.**

## Medical vs Non-Medical

### Medical Content (Requires Citations)
- Symptoms, causes, risk factors
- Screening guidelines, diagnostic processes
- Staging systems, prognosis information
- Treatment options, procedures, drug names/regimens
- Side effects, complications, management strategies
- "What should I do medically" advice

### Non-Medical Content (No Citations Required)
- Care navigation (find a doctor, second opinion)
- Emotional support, coping resources
- Links to trusted organizations (informational only)
- Process guidance (how to prepare for appointments)
- General health system navigation

## Citation Requirements

### Sufficient Evidence (2-5 citations)
- At least 2 distinct KbDocument sources, OR
- 1 Tier-1 trusted guideline with high confidence (similarity >0.7)

### Insufficient Evidence (0 citations)
- No citations → SafeFallbackResponse
- Medical content must be discarded if <2 citations

## SafeFallbackResponse Rules

When evidence is insufficient:
1. **No medical advice** (no symptoms, treatments, drug names)
2. **Navigational only:** "Please consult your healthcare provider for accurate information"
3. **May include links** to trusted org homepages (NCI, WHO, etc.)
4. **No paraphrasing** of medical content from KB

Example:
```
I don't have enough specific information in my knowledge base to answer this accurately. 

For personalized medical guidance, please consult with your healthcare provider or oncology team.

You may also find general information at:
- National Cancer Institute: https://www.cancer.gov
- WHO Cancer Resources: https://www.who.int/health-topics/cancer
```

## Model-Agnostic Design

All logic must work regardless of LLM backend (Gemini, DeepSeek, etc.). Evidence gating happens BEFORE LLM selection.
```

### 2. Refine Evidence Gate Contract

**File:** `apps/api/src/modules/evidence/evidence-gate.service.ts`

Update `validateEvidence` to return structured result:

```typescript
export interface EvidenceGateResult {
  status: 'ok' | 'insufficient';
  approvedChunks: EvidenceChunk[];
  reasonCode: 'NO_RESULTS' | 'LOW_TRUST' | 'LOW_SCORE' | 'RECENCY_FAIL' | 'LOW_DIVERSITY' | 'FILTERED_OUT' | null;
  reason: string;
  // Existing fields
  shouldAbstain: boolean;
  confidence: "high" | "medium" | "low";
  quality: EvidenceQuality;
}
```

Update validation logic:

```typescript
async validateEvidence(
  chunks: EvidenceChunk[], 
  queryType: QueryType, 
  userText?: string,
  intent?: string,
  conversationContext?: { hasGenerallyAsking?: boolean }
): Promise<EvidenceGateResult> {
  // Base validation (existing logic preserved)
  const baseResult = await this.performBaseValidation(chunks, queryType, userText, intent, conversationContext);
  
  // NEW: Determine status and approvedChunks
  let status: 'ok' | 'insufficient' = 'ok';
  let approvedChunks = chunks;
  let reasonCode: EvidenceGateResult['reasonCode'] = null;
  
  if (!chunks || chunks.length === 0) {
    status = 'insufficient';
    approvedChunks = [];
    reasonCode = 'NO_RESULTS';
  } else if (baseResult.shouldAbstain && baseResult.reason === 'untrusted_sources') {
    status = 'insufficient';
    approvedChunks = [];
    reasonCode = 'LOW_TRUST';
  } else if (baseResult.shouldAbstain && baseResult.reason === 'insufficient_passages') {
    status = 'insufficient';
    approvedChunks = [];
    reasonCode = 'LOW_SCORE';
  } else if (baseResult.quality === 'insufficient') {
    status = 'insufficient';
    approvedChunks = [];
    reasonCode = 'LOW_DIVERSITY';
  } else {
    // Evidence is acceptable
    status = 'ok';
    approvedChunks = chunks;
    reasonCode = null;
  }
  
  return {
    ...baseResult,
    status,
    approvedChunks,
    reasonCode,
    reason: baseResult.message || baseResult.reason || 'Evidence validation complete'
  };
}
```

### 3. Update Chat Service - Evidence Gate Integration

**File:** `apps/api/src/modules/chat/chat.service.ts`

Update main flow around line 509-585 (after RAG retrieval, before LLM call):

```typescript
// 6. Evidence gate check (with intent and conversation context)
let gateResult = await this.evidenceGate.validateEvidence(
  evidenceChunks,
  queryType,
  dto.userText,
  intentResult.intent,
  { hasGenerallyAsking }
);

// 6a. HARD GATE: If insufficient evidence, NO LLM call
if (gateResult.status === 'insufficient') {
  this.logger.warn(`Evidence gate BLOCKED: ${gateResult.reasonCode} - ${gateResult.reason}`);
  
  // Generate SafeFallbackResponse (no medical content)
  const safeFallback = this.abstention.generateSafeFallbackResponse(
    gateResult.reasonCode || 'NO_RESULTS',
    queryType
  );
  
  const assistant = await this.prisma.message.create({
    data: {
      sessionId: dto.sessionId,
      role: "assistant",
      text: safeFallback,
      safetyClassification: "normal",
      kbDocIds: [], // No KB docs used
      latencyMs: Date.now() - started,
      evidenceQuality: 'insufficient',
      evidenceGatePassed: false,
      abstentionReason: gateResult.reasonCode || 'no_evidence',
      citationCount: 0 // No citations
    }
  });

  // Log structured event
  await this.analytics.emit("evidence_gate_blocked", {
    reasonCode: gateResult.reasonCode,
    reason: gateResult.reason,
    queryType,
    chunkCount: evidenceChunks.length
  }, dto.sessionId);

  return {
    sessionId: dto.sessionId,
    messageId: assistant.id,
    responseText: assistant.text,
    safety: { classification: "normal" as const, actions: [] },
    abstentionReason: gateResult.reasonCode || 'insufficient_evidence'
  };
}

// Evidence is OK - proceed with LLM call using approvedChunks
const approvedChunks = gateResult.approvedChunks;
```

### 4. Runtime Citation Enforcement

**File:** `apps/api/src/modules/chat/chat.service.ts`

After LLM generates response and citations are extracted (around line 923-950):

```typescript
// Extract citations
let citations = this.citationService.extractCitations(responseText, evidenceChunks);

// RUNTIME ENFORCEMENT: Medical content requires 2-5 citations
const isMedicalContent = this.isMedicalContent(responseText, intentResult.intent);
if (isMedicalContent && citations.length < 2) {
  this.logger.error(
    `CITATION ENFORCEMENT FAILED: Medical response has ${citations.length} citations (need 2+). Discarding.`
  );
  
  // Discard LLM response, replace with SafeFallbackResponse
  const safeFallback = this.abstention.generateSafeFallbackResponse(
    'INSUFFICIENT_CITATIONS',
    queryType
  );
  
  const assistant = await this.prisma.message.create({
    data: {
      sessionId: dto.sessionId,
      role: "assistant",
      text: safeFallback,
      safetyClassification: "normal",
      kbDocIds: [],
      latencyMs: Date.now() - started,
      evidenceQuality: gateResult.quality,
      evidenceGatePassed: true, // Gate passed, but citation enforcement failed
      abstentionReason: 'citation_validation_failed',
      citationCount: 0
    }
  });

  // Log structured error
  this.logger.error({
    event: 'citation_enforcement_failed',
    sessionId: dto.sessionId,
    messageId: assistant.id,
    query: dto.userText,
    intent: intentResult.intent,
    citationCount: citations.length,
    responsePreview: responseText.substring(0, 200)
  });

  return {
    sessionId: dto.sessionId,
    messageId: assistant.id,
    responseText: assistant.text,
    safety: { classification: "normal" as const, actions: [] },
    abstentionReason: 'citation_validation_failed'
  };
}

// Proceed with normal flow (citations.length >= 2 or non-medical content)
```

Add helper method:

```typescript
/**
 * Detect if response contains medical content requiring citations
 */
private isMedicalContent(text: string, intent: string): boolean {
  // Intent-based detection
  const medicalIntents = [
    'INFORMATIONAL_GENERAL',
    'INFORMATIONAL_SYMPTOMS',
    'INFORMATIONAL_TREATMENT',
    'INFORMATIONAL_SIDE_EFFECTS'
  ];
  
  if (medicalIntents.includes(intent)) {
    return true;
  }
  
  // Keyword-based detection (backup)
  const medicalKeywords = [
    /\b(symptom|sign|cause|risk factor|diagnosis|staging|prognosis)\b/i,
    /\b(treatment|therapy|surgery|radiation|chemotherapy|immunotherapy)\b/i,
    /\b(side effect|adverse|toxicity|complication|management)\b/i,
    /\b(screening|test|biopsy|scan|imaging|biomarker)\b/i,
    /\b(drug|medication|dosage|regimen|protocol)\b/i
  ];
  
  return medicalKeywords.some(pattern => pattern.test(text));
}
```

### 5. Update Abstention Service

**File:** `apps/api/src/modules/abstention/abstention.service.ts`

Add new method:

```typescript
/**
 * Generate SafeFallbackResponse with NO medical content
 * Purely navigational + clinician referral
 */
generateSafeFallbackResponse(
  reasonCode: string,
  queryType: string
): string {
  const baseMessage = 
    "I don't have enough specific information in my knowledge base to answer this accurately.\n\n" +
    "For personalized medical guidance, please consult with your healthcare provider or oncology team.";
  
  const resources = 
    "\n\nYou may also find general information at:\n" +
    "- National Cancer Institute: https://www.cancer.gov\n" +
    "- WHO Cancer Resources: https://www.who.int/health-topics/cancer";
  
  // Optional: Add reason-specific guidance
  let additionalGuidance = "";
  if (reasonCode === 'NO_RESULTS') {
    additionalGuidance = "\n\nThis topic may require more specialized medical knowledge than I currently have access to.";
  } else if (reasonCode === 'LOW_TRUST') {
    additionalGuidance = "\n\nI can only provide information from verified medical sources, and I don't have sufficient trusted sources for this query.";
  }
  
  return baseMessage + additionalGuidance + resources;
}
```

---

## Testing

### Test Case 1: No Evidence Available

```bash
# Query with no KB matches
curl -X POST http://localhost:3000/chat \
  -d '{"sessionId":"test-001", "userText":"What is quantum cancer treatment?", "channel":"test"}'

# Expected: SafeFallbackResponse with NO medical advice
# Check logs for "Evidence gate BLOCKED: NO_RESULTS"
```

### Test Case 2: Medical Response Without Citations

```bash
# Query that returns KB matches but LLM fails to cite
# (Simulate by temporarily breaking citation extraction)

# Expected: Response discarded, SafeFallbackResponse returned
# Check logs for "CITATION ENFORCEMENT FAILED"
```

### Test Case 3: Valid Medical Response

```bash
# Query with good KB matches
curl -X POST http://localhost:3000/chat \
  -d '{"sessionId":"test-002", "userText":"What are symptoms of lung cancer?", "channel":"test"}'

# Expected: Response with 2-5 citations
# Check response JSON for citations array length >= 2
```

---

## Acceptance Criteria

✅ Policy document created at `docs/SUCHI_ANSWER_POLICY.md`  
✅ `EvidenceGateResult` includes `status`, `approvedChunks`, `reasonCode`  
✅ `ChatService` never calls LLM when `status === 'insufficient'`  
✅ SafeFallbackResponse is purely navigational (no medical advice)  
✅ Medical responses with <2 citations are discarded  
✅ All blocking decisions logged with structured reasoning  
✅ Existing functionality preserved (no regressions in eval tests)

---

## Files to Modify

1. **NEW:** `docs/SUCHI_ANSWER_POLICY.md`
2. **EDIT:** `apps/api/src/modules/evidence/evidence-gate.service.ts` (update interface + method)
3. **EDIT:** `apps/api/src/modules/chat/chat.service.ts` (add gate check, citation enforcement)
4. **EDIT:** `apps/api/src/modules/abstention/abstention.service.ts` (add `generateSafeFallbackResponse`)

---

## Coordination Points

- **@retrieval-engineer:** Ensure `EvidenceChunk[]` from hybrid search works with gate validation
- **@tests-eval-author:** Create eval cases for no-evidence scenarios

---

## Questions / Blockers

- **SafeFallbackResponse tone?** Currently formal; should it be warmer/more empathetic?
- **Citation threshold exceptions?** Any intents that need <2 citations?
- **Structured logging format?** JSON logs for evidence_gate_blocked events?

---

## Notes

- Keep existing clarifying question logic for weak (but not insufficient) evidence
- SafeFallbackResponse should NOT include any KB content paraphrasing
- Model-agnostic: No LLM-specific logic (works with Gemini, DeepSeek, etc.)
