# Suchi Review Copilot — PRD

**Version:** 1.0
**Date:** 2026-03-20
**Owner:** SCCF Engineering
**Status:** Draft (not yet implemented; autoresearch quality engine is the active quality loop as of Mar 2026)

For implementation and operations details of the current codepath, see `docs/REVIEW_COPILOT_RUNBOOK.md`.

---

## 1. Purpose

Build an automated review layer that inspects every Suchi bot response **before** it reaches the user, catching safety violations, grounding failures, citation gaps, tone problems, and policy breaches — then either blocks, repairs, or flags them for human review.

## 2. Problem Statement

Suchi operates in a **safety-critical medical information domain**. Current quality assurance relies on:

1. **Post-hoc eval runs** — catch regressions after deployment, not before the user sees them.
2. **Manual admin review** — does not scale; misses edge cases in real-time.
3. **Static safety rules** — the `safety.rules.ts` engine handles known patterns (emergency, diagnosis requests) but cannot catch subtle failures like:
   - An LLM hallucinating a drug name that passes citation format checks but references the wrong chunk.
   - A response that is technically grounded but uses alarming tone for a newly diagnosed patient.
   - A citation that points to a valid document but quotes content from a different section.
   - Over-escalation that sends every ambiguous query to "consult your doctor" without attempting to help.

**Without a review copilot, safety failures are discovered by users, not by the system.**

## 3. Vision

Every Suchi response passes through a lightweight, policy-governed review layer that:

- **Blocks** responses that violate hard safety rules (zero tolerance).
- **Repairs** responses with fixable issues (missing disclaimer, wrong citation format, readability too high).
- **Flags** responses with ambiguous issues for async human review.
- **Passes** clean responses with zero added latency.

## 4. Goals

| # | Goal | Success Metric |
|---|------|---------------|
| G1 | Catch 100% of hard safety violations before user delivery | 0 safety escapes in production |
| G2 | Auto-repair fixable issues without human intervention | ≥80% of flagged issues auto-repaired |
| G3 | Add <300ms p95 latency to the response pipeline | Measured via Cloud Run metrics |
| G4 | Reduce human review queue to ambiguous cases only | ≥70% reduction in manual review volume |
| G5 | Provide structured review traces for audit/compliance | Every response has a ReviewRecord |

## 5. Non-Goals

- **Replacing the safety module** — the existing `SafetyService` + evidence gate remain the first line of defense. The review copilot is a second pass.
- **Rewriting responses from scratch** — repairs are surgical patches, not regeneration.
- **Real-time human-in-the-loop** — human review is async; the copilot decides block/repair/pass synchronously.
- **Evaluating retrieval quality** — RAG retrieval is upstream; the copilot reviews the *assembled response*.
- **Multi-language review** — MVP is English only. Hindi/regional follows Phase 2 localization.

## 6. User Roles & Jobs To Be Done

### 6.1 The System (Primary "User")

The review copilot runs as an interceptor in the response pipeline. Its JTBD:

- **When** a response is generated, **I want to** verify it meets all safety and quality policies **so that** no unsafe content reaches the user.

### 6.2 Clinical Reviewer (Human)

- **When** the copilot flags an ambiguous response, **I want to** see the original response, the flag reason, and suggested repair **so that** I can approve, modify, or reject efficiently.

### 6.3 Suchi Admin / Engineer

- **When** reviewing system health, **I want to** see review metrics (block rate, repair rate, flag rate, false positive rate) **so that** I can tune policies and improve the pipeline.

### 6.4 Patient / Caregiver (Indirect)

- **When** I ask Suchi a question, **I want to** receive a response I can trust **so that** I feel safe acting on the information.

## 7. Suchi-Specific Failure Taxonomy

These failure types are specific to a medical information bot and differ significantly from generic chatbot review.

### 7.1 Hard Failures (Block — Never Deliver)

| ID | Failure Type | Description | Detection Method |
|----|-------------|-------------|-----------------|
| HF-1 | **Ungrounded medical claim** | Medical content with 0 valid citations | Citation count check against answer policy |
| HF-2 | **Diagnosis language** | "You have cancer", "This is malignant" | Regex patterns from `safety.rules.ts` |
| HF-3 | **Dosing / prescription** | Specific drug doses, "take X mg" | Keyword + pattern detection |
| HF-4 | **Fabricated citation** | Citation ID doesn't match any retrieved chunk | Citation-to-chunk cross-reference |
| HF-5 | **Wrong-document citation** | Citation points to real doc but wrong content | Semantic similarity between cited chunk and claim |
| HF-6 | **Emergency bypass** | Response to emergency symptoms without escalation | Emergency keyword detection + escalation check |
| HF-7 | **Contraindicated advice** | Advice that conflicts with safety contract hard-NO areas | Rule-based check against `SUCHI_SAFETY_CONTRACT.md` §Hard NO |

### 7.2 Soft Failures (Repair — Fix and Deliver)

| ID | Failure Type | Description | Repair Action |
|----|-------------|-------------|--------------|
| SF-1 | **Missing disclaimer** | No "consult your doctor" / "not medical advice" | Append standard disclaimer from `safety.templates.ts` |
| SF-2 | **Citation format error** | Malformed `[citation:docId:chunkId]` | Reformat or strip invalid citation |
| SF-3 | **Readability too high** | Flesch-Kincaid > Grade 8 | Simplify vocabulary (LLM rewrite with constraint) |
| SF-4 | **Missing section headers** | No structure (Warning signs / Questions to ask) | Insert suggested headers from rubric |
| SF-5 | **Tone mismatch** | Clinical/cold tone for emotional query | LLM tone adjustment with empathy rubric |
| SF-6 | **Excessive length** | Response >800 words for simple query | Truncate with "For more detail, ask a follow-up" |

### 7.3 Ambiguous Failures (Flag — Queue for Human Review)

| ID | Failure Type | Description | Why Ambiguous |
|----|-------------|-------------|--------------|
| AF-1 | **Over-escalation** | Every query gets "consult your doctor" without attempting to help | Borderline between safe and unhelpful |
| AF-2 | **Under-escalation** | Symptoms that *might* be emergency but aren't in the emergency keyword list | Novel symptom combinations |
| AF-3 | **Source conflict** | Two trusted sources disagree | Policy says present both, but reviewer should verify |
| AF-4 | **Stale content** | Source within recency window but close to expiry | Judgment call on whether to flag staleness |
| AF-5 | **Cultural sensitivity** | Content may be appropriate globally but insensitive in Indian context | Requires cultural review |
| AF-6 | **Implicit diagnosis** | Response doesn't say "you have X" but implies it through phrasing | Subtle — needs human judgment |

## 8. Review Pipeline Architecture

```
User Query
    │
    ▼
┌──────────────┐
│ SafetyService │  ← Existing: emergency, refusal, hard-NO
│ (First Pass)  │
└──────┬───────┘
       │ (if safe)
       ▼
┌──────────────┐
│ RAG Pipeline  │  ← Evidence gate + retrieval + LLM generation
└──────┬───────┘
       │ (response generated)
       ▼
┌──────────────────────┐
│  REVIEW COPILOT       │  ← NEW: Second pass
│                        │
│  1. Hard-failure scan  │  → Block + SafeFallbackResponse
│  2. Soft-failure scan  │  → Auto-repair + deliver
│  3. Ambiguous scan     │  → Flag + deliver (with review queue entry)
│  4. Pass               │  → Deliver unchanged
│                        │
│  Output: ReviewRecord  │
└──────────┬─────────────┘
           │
           ▼
       User Response
```

### 8.1 Execution Order

1. **Hard checks first** — if any hard failure, block immediately. No further checks needed.
2. **Soft checks second** — accumulate all repairs, apply atomically.
3. **Ambiguous checks last** — flag but still deliver (user shouldn't wait for human review).
4. **ReviewRecord written** for every response, regardless of outcome.

### 8.2 Latency Budget

| Check Category | Budget | Method |
|---------------|--------|--------|
| Hard failures | <50ms | Deterministic: regex, DB lookups, string matching |
| Soft failures | <100ms | Mostly deterministic; readability is compute-only |
| Ambiguous failures | <150ms | May use lightweight LLM call (Gemini Flash) for tone/empathy |
| **Total** | **<300ms p95** | Parallel where possible |

## 9. Patch Planning & Approval Bands

### 9.1 Auto-Approved Patches (No Human Required)

| Patch Type | Condition | Confidence Threshold |
|-----------|-----------|---------------------|
| Append disclaimer | Disclaimer missing AND response contains medical content | Always (deterministic) |
| Fix citation format | Regex match on malformed citation | Always (deterministic) |
| Truncate length | Word count > 800 | Always (deterministic) |
| Insert section headers | Response lacks structure AND rubric requires it | ≥0.9 confidence |

### 9.2 LLM-Assisted Patches (Auto-Applied with Audit Trail)

| Patch Type | Condition | Guardrails |
|-----------|-----------|-----------|
| Simplify readability | FK grade > 8 | LLM rewrites; diff must not change medical facts |
| Adjust tone | Empathy score < 1.0 on emotional query | LLM rewrites opening; must preserve all citations |
| Rephrase implicit diagnosis | AF-6 flagged | LLM rephrases; must add "consult your doctor" |

**Constraint:** LLM-assisted patches must preserve:
- All citation IDs (no citation added or removed)
- All medical facts (semantic equivalence check)
- Response length within ±20%

### 9.3 Human-Required Patches

| Patch Type | Condition | SLA |
|-----------|-----------|-----|
| Source conflict resolution | Two trusted sources disagree | 24h review |
| Cultural sensitivity fix | AF-5 flagged | 48h review |
| Novel emergency pattern | AF-2 flagged | 4h review (urgent) |

## 10. Data Model

### 10.1 ReviewRecord

```prisma
model ReviewRecord {
  id            String   @id @default(uuid())
  messageId     String   @unique
  sessionId     String

  // Verdict
  verdict       ReviewVerdict  // PASS | REPAIRED | BLOCKED | FLAGGED

  // Failure details
  hardFailures  Json?    // Array of {id, type, detail}
  softFailures  Json?    // Array of {id, type, detail, repair}
  ambiguousFlags Json?   // Array of {id, type, detail, reason}

  // Patches applied
  patchesApplied Json?   // Array of {type, before, after, confidence}

  // Original vs delivered
  originalResponse String? @db.Text  // Pre-repair response (null if PASS)

  // Timing
  reviewLatencyMs Int

  // Human review (if flagged)
  humanReviewStatus  HumanReviewStatus?  // PENDING | APPROVED | REJECTED | MODIFIED
  humanReviewerId    String?
  humanReviewNote    String?
  humanReviewedAt    DateTime?

  createdAt     DateTime @default(now())

  message       Message  @relation(fields: [messageId], references: [id])
}

enum ReviewVerdict {
  PASS
  REPAIRED
  BLOCKED
  FLAGGED
}

enum HumanReviewStatus {
  PENDING
  APPROVED
  REJECTED
  MODIFIED
}
```

### 10.2 ReviewPolicy

```prisma
model ReviewPolicy {
  id          String   @id @default(uuid())
  policyCode  String   @unique  // e.g., "HF-1", "SF-3"
  category    String   // HARD | SOFT | AMBIGUOUS
  name        String
  description String
  enabled     Boolean  @default(true)
  config      Json?    // Policy-specific thresholds/patterns

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## 11. API Endpoints

All under `/v1/review/`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/review/records` | List review records with filters (verdict, date range, session) |
| GET | `/v1/review/records/:id` | Get single review record with full detail |
| GET | `/v1/review/queue` | Flagged responses pending human review |
| PATCH | `/v1/review/queue/:id` | Submit human review decision (approve/reject/modify) |
| GET | `/v1/review/metrics` | Aggregated metrics: block rate, repair rate, flag rate, latency |
| GET | `/v1/review/policies` | List all review policies |
| PATCH | `/v1/review/policies/:id` | Enable/disable or tune a policy |

## 12. Integration with Existing Modules

### 12.1 Chat Module (`chat.service.ts`)

Insert review copilot call after LLM response generation, before response delivery:

```typescript
// In chat.service.ts handleMessage()
const llmResponse = await this.ragService.generateResponse(query, evidence);
const reviewResult = await this.reviewService.review(llmResponse, context);

switch (reviewResult.verdict) {
  case 'BLOCKED':
    return this.buildSafeFallbackResponse(reviewResult);
  case 'REPAIRED':
    return this.buildResponse(reviewResult.repairedResponse, reviewResult);
  case 'FLAGGED':
    await this.reviewService.enqueueForHumanReview(reviewResult);
    return this.buildResponse(llmResponse, reviewResult); // deliver but flag
  case 'PASS':
    return this.buildResponse(llmResponse, reviewResult);
}
```

### 12.2 Safety Module

The review copilot **complements** SafetyService — it does not replace it:

- `SafetyService` runs **before** RAG (blocks dangerous queries)
- Review Copilot runs **after** LLM generation (catches dangerous responses)

### 12.3 Eval Framework

Extend eval rubrics to include review copilot metrics:

- **Review escape rate:** % of eval cases where the copilot should have caught an issue but didn't.
- **False positive rate:** % of eval cases where the copilot flagged/blocked a valid response.
- **Repair accuracy:** % of auto-repairs that maintain semantic equivalence.

## 13. Before/After Comparison

### Example 1: Missing Disclaimer

**Before (current):**
> Breast cancer screening typically begins at age 40 with mammograms [citation:doc_breast_screening:chunk_001]. Women with BRCA mutations may start earlier [citation:doc_brca_risk:chunk_003].

**After (with copilot repair SF-1):**
> Breast cancer screening typically begins at age 40 with mammograms [citation:doc_breast_screening:chunk_001]. Women with BRCA mutations may start earlier [citation:doc_brca_risk:chunk_003].
>
> *Please consult with your healthcare provider for personalized screening recommendations.*

### Example 2: Fabricated Citation Blocked

**Before (current):** Delivered to user with a citation ID that doesn't match any retrieved chunk.

**After (with copilot block HF-4):** Blocked. SafeFallbackResponse returned. ReviewRecord logged with `hardFailures: [{id: "HF-4", type: "fabricated_citation", detail: "citation:doc_fake:chunk_999 not in retrieved set"}]`.

### Example 3: Over-Escalation Flagged

**Before (current):**
> I recommend consulting your healthcare provider about this.
*(For a simple "what is chemotherapy?" question)*

**After (with copilot flag AF-1):** Response delivered (it's not unsafe), but flagged for review: `ambiguousFlags: [{id: "AF-1", type: "over_escalation", detail: "SafeFallbackResponse returned for answerable general-info query"}]`.

## 14. Rollout Phases

### Phase 0: Shadow Mode (Week 1-2)

- Review copilot runs on every response but **takes no action**.
- All ReviewRecords written to DB.
- Dashboard shows what *would* have been blocked/repaired/flagged.
- Goal: Calibrate thresholds, measure false positive rate.

### Phase 1: Hard Blocks Only (Week 3-4)

- Enable blocking for hard failures (HF-1 through HF-7).
- Soft and ambiguous remain shadow-only.
- Goal: Validate zero false positives on hard blocks.

### Phase 2: Auto-Repair (Week 5-6)

- Enable deterministic auto-repairs (disclaimer, citation format, truncation).
- LLM-assisted repairs remain shadow.
- Goal: Validate repair accuracy ≥95%.

### Phase 3: Full Review (Week 7-8)

- Enable all checks including LLM-assisted repairs and ambiguous flagging.
- Human review queue active.
- Goal: Full pipeline operational with <300ms p95 latency.

### Phase 4: Continuous Tuning (Ongoing)

- Weekly review of false positive/negative rates.
- Policy tuning based on human review feedback.
- New failure types added as discovered.

## 15. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| False positives blocking valid responses | Users get SafeFallbackResponse for good answers | Shadow mode first; conservative thresholds; human review escape hatch |
| Added latency degrades UX | Users wait longer for responses | 300ms budget; parallel checks; skip LLM-assisted checks if budget exceeded |
| LLM-assisted repair changes meaning | Medical facts altered during tone/readability fix | Semantic equivalence check; citation preservation constraint; audit trail |
| Review copilot itself hallucinating | Copilot flags/repairs incorrectly | Deterministic checks preferred; LLM checks use constrained prompts |
| Human review queue grows unbounded | Reviewers overwhelmed | Auto-close after 7 days if no safety impact; tune AF thresholds to reduce volume |
| Circular dependency with safety module | Conflicting block decisions | Clear ownership: SafetyService owns query safety; ReviewCopilot owns response safety |

## 16. MVP Definition

The MVP (Phase 1 delivery) includes:

- [ ] `ReviewService` with hard-failure checks (HF-1 through HF-7)
- [ ] `ReviewRecord` Prisma model + migration
- [ ] Integration point in `chat.service.ts`
- [ ] Shadow mode toggle (env var `REVIEW_COPILOT_MODE=shadow|active`)
- [ ] `/v1/review/records` and `/v1/review/metrics` endpoints
- [ ] 10+ eval test cases covering each hard-failure type
- [ ] Dashboard metrics: block rate, review latency, failure type distribution

**Not in MVP:** LLM-assisted repairs, human review queue UI, ambiguous flagging, readability rewrites.

## 17. Success Criteria

| Criteria | Target | Measurement |
|----------|--------|-------------|
| Safety escape rate | 0% | No hard failures reach users in production |
| False positive rate (hard blocks) | <2% | Measured in shadow mode before activation |
| Auto-repair accuracy | ≥95% | Semantic equivalence check on repaired responses |
| Review latency p95 | <300ms | Cloud Run request metrics |
| Human review queue size | <20 items/day | ReviewRecord count with PENDING status |

---

*This PRD is tailored to Suchi's safety-critical medical information domain. Generic chatbot review approaches are insufficient here — every check in this document maps to a real failure mode observed or anticipated in cancer information delivery.*
