# Plan: Fix Funding Bot Output — Content Quality & Depth

## Reference Document
**Gully Goal Proposal** (manually written by Gautam) — a Reliance Foundation ESA grant proposal for Football-for-Development programming across Diksha Foundation's KHEL centers + Empowering Futures.

This is the quality bar. The bot's output should read like this document.

---

## Gap Analysis: Manual Proposal vs Bot Output

### What the manual proposal does that the bot doesn't:

| # | Quality Dimension | Manual Proposal Example | What Bot Would Produce | Root Cause |
|---|------------------|------------------------|----------------------|------------|
| 1 | **Funder-specific framing** | Names "Reliance Foundation", "ESA", mentions "ESA branding in all materials and signage" | Generic "the funder" language, no acknowledgment of specific program | Section writer prompt has no instruction to name and tailor to the specific funder |
| 2 | **Program-specific methodology** | 3 paragraphs on Football3 "three halves" structure, 40×20m pitches, fair-play scoring, "used by 70+ organizations globally" | Generic "sports activities" or "football sessions" with no methodology depth | Evidence chunks truncated to 800 chars; framework method cards lack enough detail |
| 3 | **Numbers woven into narrative** | "771 learners (511 KHEL centre learners + 260 Empowering Futures girls)" — decomposed naturally | "The program targets 476 students" as a standalone bullet, often inconsistent across sections | Activity facts injected as raw JSON; no instruction to decompose totals |
| 4 | **Theory of Change as a flowing sentence** | "If marginalized children... are provided with structured, safe football-for-development programming... then they will develop improved physical skills..." | Structured table: Inputs → Activities → Outputs → Outcomes → Impact | Program design prompt produces JSON table format, not narrative |
| 5 | **Budget as simple readable table** | Clean 10-line table: "Football training workshop... 1,20,000" with Indian comma format | JSON code block that must be parsed and rendered; amounts in international format | Budget guidance forces JSON output format |
| 6 | **Concrete sustainability mechanisms** | 5 named mechanisms: Youth-Led, Existing Infrastructure, Community Ownership, Diversified Funding Base, Institutional Learning — each with 1 paragraph | Generic "will seek additional funding", "build local capacity" | Sustainability guidance is the weakest section-type in SECTION_TYPE_GUIDANCE |
| 7 | **Board member details** | Full board with qualifications: "Saurabh Kumar (Treasurer) - Co-founder and COO at Sparklehood; Angel investor" | Not included — org profile only has "Dedicated educators and youth fellows" | Org profile (org-profile.ts) lacks board/leadership data |
| 8 | **Compliance checklist** | Specific registration numbers, audit dates, FCRA filing dates, auditor contact | Not generated — no section type guidance for compliance | No compliance section type in SECTION_TYPE_GUIDANCE |
| 9 | **Capability framework alignment table** | Maps each of 10 capabilities to specific program activities | Framework intelligence produces capability-aligned MEL indicators but not a mapping table | Framework intelligence service doesn't generate a capability↔activity mapping |
| 10 | **Community voice** | "The Executive Director plays weekly football with students" — personal, authentic | Impersonal third-person descriptions | No voice/tone instruction in section writer prompt |

---

## Root Causes (Updated with Evidence)

| # | Root Cause | Location | Impact | Evidence |
|---|-----------|----------|--------|----------|
| 1 | **No voice/tone instruction** | `section-writer.prompt.ts:6-55` | Bot writes in impersonal third person, bullet-heavy style | Manual proposal uses "we", active voice, narrative paragraphs |
| 2 | **Evidence chunks truncated to 800 chars** | `section-writer.service.ts:42` | Methodology sections lack depth (Football3 "three halves" needs >800 chars to explain) | Manual proposal has 3 paragraphs on methodology alone |
| 3 | **Activity facts injected as raw JSON** | `proposal.service.ts:521` | Numbers appear awkwardly, not decomposed (e.g., "771 = 511 + 260") | Manual proposal weaves decomposed numbers into sentences |
| 4 | **Org profile missing key data** | `org-profile.ts` | No board members, no annual budget, no funding partners list, no registration details | Manual proposal has full board (7 members), funding partners, compliance checklist |
| 5 | **No section-type guidance for compliance, capability-mapping, or sustainability detail** | `section-writer.prompt.ts:133-298` | These sections are either missing or thin | Manual proposal has rich compliance checklist + 5 sustainability mechanisms + capability table |
| 6 | **Theory of Change forced into structured format** | `program-design.prompt.ts` | ToC is always a JSON table, never a narrative sentence | Manual proposal has a powerful single-sentence ToC |
| 7 | **Budget format is JSON-first** | `section-writer.prompt.ts:168-196` | Budget requires JSON parsing; Indian number format (15,00,000) not used | Manual proposal uses a simple markdown table with Indian comma format |
| 8 | **Model is deepseek-chat** | `proposal.service.ts:188-191` | Cheaper model produces more formulaic prose | Manual proposal quality requires stronger LLM |
| 9 | **Section-type guidance is checklist-style** | `section-writer.prompt.ts:133-298` | Bot outputs checkbox-style content, not narrative | Manual proposal reads as flowing prose with data woven in |

---

## Implementation Plan (7 Steps)

### Step 1: Add Voice & Tone Instructions to Section Writer Prompt
**File:** `section-writer.prompt.ts` (SECTION_WRITER_SYSTEM_PROMPT)
**Risk:** Low (prompt-only change)

Add a WRITING STYLE block right after the existing CITATION RULES:

```
WRITING STYLE (CRITICAL — this determines whether the output reads as a real proposal or a bot draft):
- Write in FIRST PERSON PLURAL: "We", "Our team", "Diksha Foundation proposes..."
- Lead each section with a 1-2 sentence hook that states the IMPACT, not the process
  GOOD: "Gully Goal will bring structured football-for-development programming to 771 children and adolescent girls across Bihar, using the globally proven Football3 methodology."
  BAD: "This section describes the project activities and implementation plan."
- Use ACTIVE VOICE: "We train 9 Young Leader mediators" — NOT "9 Young Leader mediators are trained"
- WEAVE numbers into narrative: "Our 3 KHEL centers in Patna, Bihta, and Sarairanjan currently serve 511 learners, while the Empowering Futures program reaches 260 adolescent girls" — NOT a standalone bullet "Direct beneficiaries: 771"
- DECOMPOSE totals: When a total combines sub-populations, always show the breakdown in prose (e.g., "771 beneficiaries — 511 KHEL learners + 260 EF girls")
- Flow: Context → Action → Evidence → Outcome within each paragraph
- Keep paragraphs 3-4 sentences max. Use subheadings for readability.
- NEVER produce bullet-only sections. Funders read narrative prose. Use bullets ONLY for: deliverable lists, tables, timelines, enumerations.
- Name the FUNDER explicitly: "In alignment with [Funder Name]'s focus on [theme]..." — do NOT write "the funder"
- Bihar-specific framing: reference NEP 2020, Bihar Khel Niti, local geography BY NAME
- AVOID hollow phrases: "holistic approach", "sustainable impact", "transformative change" — replace with SPECIFIC descriptions of what actually happens
- When describing methodology, explain HOW it works in at least 2-3 sentences, not just the name
```

### Step 2: Increase Evidence Chunk Size
**File:** `section-writer.service.ts:42`
**Risk:** Low

Change `chunk.content.substring(0, 800)` → `chunk.content.substring(0, 2000)`

The Gully Goal proposal has 3 paragraphs describing Football3 methodology alone. At 800 chars, the LLM only sees a fragment of methodology documents. 2000 chars provides enough for the LLM to understand and explain a method.

### Step 3: Convert Activity Facts from JSON to Narrative
**File:** `proposal.service.ts:519-525`
**Risk:** Medium

Replace:
```typescript
orgCtx += `\n\nACTIVITY FACTS...\n${JSON.stringify(activityFacts, null, 2)}`;
```

With a helper that produces readable narrative like:
```
ACTIVITY FACTS (weave these into your narrative — do NOT dump as raw data):
Diksha Foundation currently serves 476 students across 3 KHEL centers:
- KHEL Patna (Rukanpura): 147 students
- KHEL Bihta (Sita Ram Ashram): 150 students
- KHEL Sarairanjan: 179 students (est. August 2024)

Additionally, the Empowering Futures program reaches approximately 260 adolescent girls across 6 urban settlements in Patna.

Program activities include: Supplementary education (daily), Digital literacy via Khan Academy (3x/week), Football and sports (Saturday sessions), SEE Learning social-emotional sessions (2x/week), Civic engagement through Bal Sansad.

Latest metrics: Average attendance 82%, 45 active Khan Academy students, 120 SEL sessions delivered last quarter.
```

### Step 4: Enrich Org Profile with Missing Data
**File:** `org-profile.ts`
**Risk:** Medium

The current profile is missing critical data that the manual proposal includes. Add:
- **Board of Directors** (7 members with qualifications — from the Gully Goal doc)
- **Annual operating budget** (104.56 lakhs FY 2024-25)
- **Current funding partners** (Azim Premji Foundation, Feeding India, etc.)
- **Past partners** (JP Morgan Chase, PRAVAH, Asha for Education, etc.)
- **Registration details** with actual numbers (PAN, FCRA, CSR-1)
- **Leadership team** names and qualifications (Gautam Gauri, Shivam Mishra, Nisha Kumari)
- **Total historical reach** (2,000+ students graduated since 2010)

Also rewrite the profile from bullets → narrative prose paragraphs, since the LLM mirrors the input format.

### Step 5: Add Missing Section-Type Guidance
**File:** `section-writer.prompt.ts` (SECTION_TYPE_GUIDANCE)
**Risk:** Low

Add guidance for 3 section types the manual proposal has but the bot currently lacks:

**a) `compliance` section type:**
```
REQUIRED for this section:
- Full compliance checklist table with columns: Particulars | Yes/No | Remarks
- Registration details with actual certificate numbers
- Tax filing status and dates
- FCRA status and latest return filing
- CSR registration status
- Audit details including external auditor name and firm
- Bank mandate and address proof status
```

**b) `capabilityAlignment` section type:**
```
REQUIRED for this section:
- Map each of the 10 Core Capabilities to specific program activities
- Table format: Capability | How This Program Builds It
- Each cell should have 1-2 sentences explaining the SPECIFIC mechanism
```

**c) Strengthen `sustainability` guidance** with the 5-mechanism model from the manual proposal:
```
Structure sustainability around these 5 mechanisms:
1. Youth/Community-Led Sustainability (who takes ownership after the grant?)
2. Existing Infrastructure (what resources continue without new funding?)
3. Community Ownership (how do families and communities invest?)
4. Diversified Funding Base (what other funders? What CSR/government alignment?)
5. Institutional Learning (how is the model captured for replication?)
Each mechanism needs a concrete paragraph, not a vague aspiration.
```

### Step 6: Improve Theory of Change Format
**File:** `section-writer.prompt.ts` (`projectDesign` guidance)
**Risk:** Low

Add instruction to produce ToC as BOTH a narrative sentence AND a structured breakdown:

```
THEORY OF CHANGE FORMAT:
First, write the Theory of Change as a single flowing conditional statement:
"If [target population] in [geography] are provided with [intervention description], then they will develop [outcomes], leading to [impact]."

Then provide the structured breakdown:
- Inputs: ...
- Activities: ...
- Outputs: ...
- Outcomes: ...
- Impact: ...
```

### Step 7: Make LLM Model Configurable
**File:** `proposal.service.ts:186-192`
**Risk:** Low

Add environment variable `PROPOSAL_WRITER_MODEL` (default: `deepseek-chat`) so the writer model can be upgraded without code changes. The narrative quality gap between deepseek-chat and a stronger model is significant for proposal writing.

```typescript
const modelConfig: ProposalRunModelConfig = {
  planner: process.env.PROPOSAL_PLANNER_MODEL || "deepseek-chat",
  writer: process.env.PROPOSAL_WRITER_MODEL || "deepseek-chat",
  reviewer: process.env.PROPOSAL_REVIEWER_MODEL || "deepseek-chat",
  retriever: "hybrid",
};
```

---

## Files Modified (Summary)

| File | Change Type | Steps |
|------|------------|-------|
| `apps/funding-api/src/modules/proposal/prompts/section-writer.prompt.ts` | Major: voice/tone + section guidance + ToC format | 1, 5, 6 |
| `apps/funding-api/src/modules/proposal/services/section-writer.service.ts` | Small: chunk size increase | 2 |
| `apps/funding-api/src/modules/proposal/proposal.service.ts` | Medium: narrative activity facts + configurable model | 3, 7 |
| `apps/funding-api/src/modules/proposal/prompts/org-profile.ts` | Medium: enrich with board, partners, narrative rewrite | 4 |

## Implementation Order (Priority)
1. **Step 1** (voice/tone) — highest ROI, pure prompt change
2. **Step 4** (org profile) — second highest, gives LLM the data it needs
3. **Step 5** (section-type guidance) — fills structural gaps
4. **Step 2** (chunk size) — easy win for methodology depth
5. **Step 3** (narrative activity facts) — improves number integration
6. **Step 6** (ToC format) — targeted improvement for project design
7. **Step 7** (model config) — enables quality upgrades without deploys

## Non-Goals (Out of Scope)
- Eval harness infrastructure fixes
- Frontend/web app changes
- Database schema changes
- Citation integrity pipeline changes
- New feature additions (e.g., auto-compliance generation)

## Risk Assessment
- **Low risk:** Steps 1, 2, 5, 6, 7 — prompt/config only, easy to revert
- **Medium risk:** Steps 3, 4 — change input format; test with a real proposal run after
- All changes are backward-compatible and don't affect API contracts
