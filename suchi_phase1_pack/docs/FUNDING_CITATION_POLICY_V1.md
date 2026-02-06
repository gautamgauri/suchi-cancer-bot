# FundingBot Citation Policy v1

**Status:** v1 (implementation-ready)
**Scope:** FundingBot outputs intended for fundraising/marketing (emails, EOIs, proposal sections, donor profiles, opportunity summaries).
**Non-scope:** Medical/cancer safety standards (handled separately in Suchi).
**Primary objective:** Prevent **false authority** by ensuring the bot **never attaches citations that are not supported by retrieved evidence**, while still allowing legitimate creative/synthetic fundraising writing.

---

## 1) Definitions

### 1.1 Evidence

Evidence is any content chunk retrieved for the current generation run (RAG), identified by a stable `chunkId` and accompanied by `source` metadata.

**Evidence Set (E):** the list of chunks returned by retrieval for this run.

### 1.2 Citation Token

A machine-parseable marker in text that points to a chunk in the evidence set.

**Required format (v1):**

* `[[CIT:<chunkId>]]`

Examples:

* `We have delivered after-school programs in Bihar. [[CIT:ev_0123]]`
* `The RFP requires a theory of change. [[CIT:rfp_0042]]`

### 1.3 Placeholder Token

A marker that explicitly signals missing/verifiable information is required.

**Supported placeholder formats (v1):**

* `[Insert <field>]` e.g., `[Insert verified metric: learners served FY25]`
* `[<Field Name>]` e.g., `[Donor Name]`, `[Project Name]`, `[Budget Amount]`
* `TODO(<field>)`, `TBD(<field>)`

### 1.4 Softened Claim

A claim rewritten to avoid unverifiable specifics and remain truthful without numeric or named assertions.

Examples:

* Hard: "We reached 12,000 children last year."
* Softened: "We have experience delivering after-school programs to children in Bihar."

---

## 2) Claim Taxonomy

FundingBot classifies sentences/clauses into categories to decide whether citations/placeholders are required.

### 2.1 Hard Claims (H) — MUST be supported

A "hard claim" is any statement that implies objective, checkable fact. Hard claims require one of:

* Valid citation(s) **to retrieved evidence**, OR
* Placeholder(s), OR
* Softening rewrite (remove checkable specifics)

**Hard claim triggers (non-exhaustive):**

* **Metrics/numbers**: digits, percentages, ratios, "X lakh/crore", "USD", "₹"
* **Impact verbs** with implied measurement: `served`, `reached`, `trained`, `enrolled`, `graduated`, `improved`, `increased`, `reduced`, `raised`, `delivered`, `screened`
* **Comparatives/superlatives**: `more effective`, `best`, `largest`, `only`, `first`
* **Named relationships**: "funded by", "supported by", "partnered with", "in collaboration with"
* **RFP-specific assertions**: deadlines, eligibility, budget caps, mandatory requirements (unless directly grounded in parsed RFP evidence)
* **Geographic/time-bounded factuals**: "since 2019", "in 23 schools", "across 5 districts"

### 2.2 Soft Claims (S) — citation optional

Statements that are plausible but not strictly verifiable or are framed as general context.

Examples:

* "There is a strong need for holistic education interventions."
* "Teachers benefit from practical coaching and peer support."

Guidance:

* Prefer citations if you include specific statistics.
* Avoid invented statistics; if using stats, treat as Hard Claim.

### 2.3 Intent/Plan Claims (P) — citation not required

Forward-looking proposals and design intent.

Examples:

* "We propose to pilot a 6-month intervention."
* "We will recruit and train community educators."

Requirement:

* Must not imply already-achieved results.

---

## 3) Policy Rules (Normative)

### Rule A — Citation Integrity (no-bullshit citations)

If the output contains any citation token `[[CIT:<chunkId>]]`, then:

1. `<chunkId>` MUST exist in the evidence set E for the current run.
2. If `<chunkId>` is not in E, it is an **invalid citation** and must be treated as a failure.

**No exceptions.**

### Rule B — Zero-evidence guard

If `|E| == 0` (no evidence retrieved), then:

* The model MUST NOT output any citation tokens.
* Any hard claim must be satisfied by placeholder or soften.
* If the requested task requires evidence by design (e.g., "summarize the RFP requirements"), then the system should return an abstain response: `MISSING_EVIDENCE`.

### Rule C — Hard-claim compliance

For each detected hard claim sentence/segment:

* Must contain **at least one**:

  * valid citation token, OR
  * placeholder token, OR
  * be marked "softened" (no metrics/names/checkable specifics remain)

### Rule D — Citation is not required everywhere

Absence of citations is acceptable if:

* No hard claims are present, OR
* Hard claims are handled via placeholders/softening.

### Rule E — RFP parsing precedence

When writing about an opportunity/RFP:

* Any asserted requirement (deadline, budget cap, eligibility, format) is treated as Hard Claim and must cite RFP chunks **or** use placeholders if RFP wasn't parsed.

---

## 4) Implementation

### 4.1 API Service: `citation-integrity.service.ts`

Location: `apps/funding-api/src/modules/core_ai/citation-integrity.service.ts`

Responsibilities:
- Extract and validate citation tokens against evidence set
- Detect placeholder tokens
- Detect hard claims using pattern matching
- Enforce zero-evidence guard
- Optional: citation alignment check (keyword overlap)

### 4.2 Eval Harness: `citation-integrity.ts`

Location: `funding-eval/runner/citation-integrity.ts`

Mirrors the API service for local validation during eval runs.

### 4.3 Test Case Schema

New expectations in YAML test cases:

```yaml
expectations:
  citation_integrity: true  # Enable v1 citation policy validation
  hard_claim_policy: cite_or_placeholder_or_soften  # How to handle hard claims
  require_evidence: true  # Task must abstain if no evidence
```

### 4.4 Report Metrics

The eval report includes:

```json
{
  "citationIntegrity": {
    "evaluatedCount": 10,
    "passedCount": 8,
    "totalInvalidCitations": 2,
    "totalHardClaims": 15,
    "totalUnsupportedHardClaims": 3,
    "integrityRate": 0.8
  }
}
```

---

## 5) Examples (Golden Behaviors)

### Example A — Acceptable marketing copy with no citations

> "We propose a 12-month pilot to strengthen foundational and life skills through after-school learning hubs. We will recruit community educators, run weekly sessions, and track attendance and learning progress."

✅ No hard claims, no citations required.

### Example B — Hard claim handled via placeholder

> "Over the past year, we served [Insert verified metric: learners served in FY25] children across [Insert geography]."

✅ Hard claim avoided via placeholders.

### Example C — Hard claim with valid citation

> "The RFP requires submission by 15 February 2026. [[CIT:rfp_deadline_01]]"

✅ Cited to RFP chunk.

### Example D — Forbidden (bullshit citation)

> "We improved learning outcomes by 40%. [[CIT:rfp_deadline_01]]"

❌ Citation exists but does not support claim (would be caught at least by alignment warn; and likely by "hard claim unsupported" if no relevant chunk).

---

## 6) Non-Goals (Explicit)

* FundingBot is not required to cite every paragraph.
* FundingBot is allowed to generate novel program designs and forward-looking proposals.
* FundingBot must not present invented numbers, partners, or requirements as facts.

---

**End of document — FundingBot Citation Policy v1**
