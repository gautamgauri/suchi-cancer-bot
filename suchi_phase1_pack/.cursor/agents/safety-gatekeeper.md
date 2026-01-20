# Safety Gatekeeper Agent Instructions

**Role:** Evidence Validation & Citation Enforcement Specialist  
**Current Assignment:** Trust-First RAG v2 - Phase 1  
**Handoff Document:** `docs/ops/handoffs/2026-01-20-safety-gatekeeper-trust-first-rag-v2.md`

---

## Your Mission

Enforce the trust-first invariant: **No acceptable evidence → no LLM call → SafeFallbackResponse**. Ensure all medical responses have 2-5 citations or are rejected.

---

## Step-by-Step Instructions

### STEP 1: Read Your Handoff Document
```bash
# Open and read carefully
code docs/ops/handoffs/2026-01-20-safety-gatekeeper-trust-first-rag-v2.md
```

**Key sections to understand:**
- Context: Current evidence gate behavior (validates but doesn't block)
- Tasks 1-5: What you need to build
- Acceptance Criteria: How success is measured

### STEP 2: Create Policy Document

**File:** `docs/SUCHI_ANSWER_POLICY.md` (new)

Create comprehensive policy document:

```markdown
# Suchi Answer Policy - Trust-First RAG v2

## Core Invariant

**Medical information MUST be grounded in knowledge base evidence with stored citations.**

If Suchi provides medical information, it must:
1. Use 2–5 citations pointing to KbChunk/KbDocument
2. Be grounded only in retrieved evidence
3. Have passed evidence gate validation

**No citations → no medical content.**

## Medical vs Non-Medical Content

### Medical Content (REQUIRES 2+ Citations)
Content that includes:
- Symptoms, warning signs, causes, risk factors
- Screening guidelines, diagnostic processes, test interpretations
- Staging systems, prognosis information
- Treatment options, procedures, drug names/regimens
- Side effects, complications, management strategies
- "What should I do medically" advice

Examples:
- ❌ "Lung cancer symptoms include persistent cough..." (medical, needs citations)
- ❌ "Chemotherapy can cause nausea and fatigue..." (medical, needs citations)
- ❌ "Mammograms are recommended starting at age 40..." (medical, needs citations)

### Non-Medical Content (No Citations Required)
Content that includes:
- Care navigation (finding providers, getting second opinions)
- Emotional support, coping resources
- Links to trusted organizations (informational only)
- Process guidance (preparing for appointments)
- General health system navigation

Examples:
- ✅ "I recommend speaking with your oncologist about..." (navigation, no citations needed)
- ✅ "You can find support at cancer.gov" (navigation, no citations needed)
- ✅ "Consider getting a second opinion..." (navigation, no citations needed)

## Citation Requirements

### Sufficient Evidence (Proceed with LLM)
Evidence is sufficient when:
- At least **2 distinct KbDocument sources** with good quality chunks, OR
- **1 Tier-1 trusted guideline** (NCI, WHO) with high confidence (similarity >0.7)

### Insufficient Evidence (Block LLM, Return SafeFallbackResponse)
Evidence is insufficient when:
- No retrieved chunks (`NO_RESULTS`)
- All chunks from untrusted sources (`LOW_TRUST`)
- Chunk similarity scores too low (`LOW_SCORE`)
- Only 1 source and low diversity (`LOW_DIVERSITY`)

## SafeFallbackResponse Rules

When evidence is insufficient, SafeFallbackResponse must:
1. **NO medical advice** (no symptoms, treatments, drug names, clinical guidance)
2. **Navigational only:** Direct to healthcare provider
3. **May include links** to trusted org homepages (NCI, WHO) as URLs only
4. **NO paraphrasing** of medical content from knowledge base

### SafeFallbackResponse Template

```
I don't have enough specific information in my knowledge base to answer this accurately.

For personalized medical guidance, please consult with your healthcare provider or oncology team.

You may also find general information at:
- National Cancer Institute: https://www.cancer.gov
- WHO Cancer Resources: https://www.who.int/health-topics/cancer
```

## Runtime Citation Enforcement

After LLM generates response:
1. Extract citations from response text
2. Check if content is medical (symptom keywords, treatment terms, etc.)
3. If medical AND citations < 2:
   - **Discard entire LLM response**
   - Replace with SafeFallbackResponse
   - Log structured error for investigation

No exceptions. Medical content without sufficient citations is never returned.

## Model-Agnostic Design

All logic must work regardless of LLM backend:
- Evidence gating happens BEFORE LLM selection
- Citation extraction works with any LLM output format
- SafeFallbackResponse never touches LLM

Works with: Gemini, DeepSeek, GPT-4, Claude, etc.

## Logging Requirements

All blocking decisions must be logged with:
- Event type: `evidence_gate_blocked` or `citation_enforcement_failed`
- Reason code: `NO_RESULTS`, `LOW_TRUST`, `INSUFFICIENT_CITATIONS`, etc.
- Query text (first 200 chars)
- Chunk count and source types
- Session ID and message ID
```

Save this file at `docs/SUCHI_ANSWER_POLICY.md`.

### STEP 3: Refine Evidence Gate Contract

**File:** `apps/api/src/modules/evidence/evidence-gate.service.ts`

1. Update the `EvidenceGateResult` interface (around line 33):

```typescript
export interface EvidenceGateResult {
  // NEW: Clear status and approved chunks
  status: 'ok' | 'insufficient';
  approvedChunks: EvidenceChunk[];
  reasonCode: 'NO_RESULTS' | 'LOW_TRUST' | 'LOW_SCORE' | 'RECENCY_FAIL' | 'LOW_DIVERSITY' | 'FILTERED_OUT' | null;
  
  // EXISTING: Keep for backward compatibility
  shouldAbstain: boolean;
  confidence: "high" | "medium" | "low";
  quality: EvidenceQuality;
  reason?: AbstentionReason;
  message?: string;
}
```

2. Update the `validateEvidence` method to populate new fields (around line 77):

Add this logic at the end of the method, before the return statement:

```typescript
// Determine status and approvedChunks based on validation results
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
  reasonCode
};
```

### STEP 4: Update Chat Service - Evidence Gate Integration

**File:** `apps/api/src/modules/chat/chat.service.ts`

1. Find the evidence gate check (around line 510):

```typescript
let gateResult = await this.evidenceGate.validateEvidence(
  evidenceChunks,
  queryType,
  dto.userText,
  intentResult.intent,
  { hasGenerallyAsking }
);
```

2. Add HARD GATE CHECK immediately after:

```typescript
// HARD GATE: If insufficient evidence, NO LLM call
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

// Evidence is OK - use approvedChunks for LLM call
evidenceChunks = gateResult.approvedChunks;
```

### STEP 5: Add Runtime Citation Enforcement

**File:** `apps/api/src/modules/chat/chat.service.ts`

1. Add helper method at the end of the class (around line 1365):

```typescript
/**
 * Detect if response contains medical content requiring citations
 */
private isMedicalContent(text: string, intent: string): boolean {
  // Intent-based detection (primary)
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

2. Find where citations are extracted (around line 923), add enforcement logic AFTER extraction:

```typescript
// Extract citations
let citations = this.citationService.extractCitations(responseText, evidenceChunks);

// RUNTIME ENFORCEMENT: Medical content requires 2-5 citations
const isMedicalContent = this.isMedicalContent(responseText, intentResult.intent);
if (isMedicalContent && citations.length < 2) {
  this.logger.error(
    `CITATION ENFORCEMENT FAILED: Medical response has ${citations.length} citations (need 2+). Discarding LLM output.`
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
    query: dto.userText.substring(0, 200),
    intent: intentResult.intent,
    citationCount: citations.length,
    responsePreview: responseText.substring(0, 200)
  });

  await this.analytics.emit("citation_enforcement_failed", {
    intent: intentResult.intent,
    queryType,
    citationCount: citations.length
  }, dto.sessionId);

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

### STEP 6: Update Abstention Service

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
  } else if (reasonCode === 'INSUFFICIENT_CITATIONS') {
    additionalGuidance = "\n\nI couldn't verify the information with reliable source citations.";
  }
  
  return baseMessage + additionalGuidance + resources;
}
```

### STEP 7: Test Your Implementation

1. **Test no-evidence scenario:**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-no-evidence",
    "userText": "What is quantum cancer treatment?",
    "channel": "test"
  }'

# Expected: SafeFallbackResponse with NO medical advice
# Check logs for: "Evidence gate BLOCKED: NO_RESULTS"
```

2. **Test normal medical query:**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-medical",
    "userText": "What are symptoms of lung cancer?",
    "channel": "test"
  }'

# Expected: Response with 2+ citations
# Check response JSON: citations.length >= 2
```

3. **Check logs for enforcement:**
```bash
# Look for these log entries:
# - "Evidence gate BLOCKED: [reason]" (when evidence insufficient)
# - "CITATION ENFORCEMENT FAILED" (when LLM doesn't cite properly)
```

---

## Success Checklist

Before marking your work complete, verify:

- [ ] Policy document created at `docs/SUCHI_ANSWER_POLICY.md`
- [ ] `EvidenceGateResult` interface updated with new fields
- [ ] Evidence gate blocks LLM calls when `status === 'insufficient'`
- [ ] SafeFallbackResponse is purely navigational (no medical content)
- [ ] Medical responses with <2 citations are discarded
- [ ] Helper method `isMedicalContent()` correctly identifies medical content
- [ ] All blocking decisions logged with structured events
- [ ] No regressions (existing tests still pass)
- [ ] TypeScript compiles without errors

---

## If You Get Stuck

**Common Issues:**

1. **TypeScript errors on new fields:** Make sure to update interface before implementation
2. **Chat flow too complex:** Focus on one insertion point at a time
3. **SafeFallbackResponse too technical:** Keep it warm and simple
4. **Unclear what's medical:** Use both intent and keywords (belt and suspenders)

**Get Help:**
- Review handoff document for more details
- Check existing abstention logic for patterns
- Ask orchestrator for clarification

---

## When Complete

Update TODO status and coordinate with other agents for integration testing.
