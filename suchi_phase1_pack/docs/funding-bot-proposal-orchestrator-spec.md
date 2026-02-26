# Funding Bot: Proposal Orchestrator Spec

> "Gautam-style" proposal pipeline — the bot should earn the right to write.

## 1) End-to-End Pipeline (Gated State Machine)

### Stage A — Opportunity Ingestion + Extraction

**Input:** URL / PDF / email forward / RFP text
**Bot does:**
- Extract funder, geography, themes, eligibility, timeline, budget norms, required sections, evaluation expectations
- Normalize into a structured "Opportunity Brief"

**Output:** `OpportunityBrief`

### Stage B — Fit to Existing Diksha Program(s)

**Bot does:**
- Match opportunity themes to **Program Registry** (KHEL centres, Empowering Futures, etc.)
- Check if delivery footprint + target group + activities already exist
- Output a short "fit narrative" and a score

**Output:** `ProgramFitAssessment` (top 1-3 programs + why)

### Stage C — Fit to Strategic Plan + "Strategic Gap" Detection

Key insight: *some strategic interests don't yet have proposals/funding.*

**Bot does:**
- Map opportunity to **Strategic Plan priorities**
- If it matches a priority that currently lacks a proposal "blueprint", flag: **Strategic Gap Opportunity**
- Suggest whether to (a) reuse existing program, (b) extend an existing program, or (c) design a new program line consistent with strategy

**Output:** `StrategyAlignment` (+ `GapFlag` + recommended route)

### Stage D — Gmail Memory: Find Prior Proposals on Similar Topics

**Bot does (read-only):**
- Search Gmail for past submissions, concept notes, budgets, and donor comms on the same theme
- Extract reusable blocks: problem framing, Diksha positioning, past indicators, standard budgets, annexures
- Produce a "reuse map" (what to copy, what to update)

**Output:** `ProposalMemoryPack` (citations to message IDs / Drive links in internal system)

### Stage E — Global "What Works" Scan + Bihar Synthesis

**Bot does:**
- Web search for globally significant approaches to the problem (program models, meta-evidence, flagship initiatives)
- Extract 3-5 approaches with: theory of change gist, delivery model, cost drivers, evidence strength
- Then: "Bihar realism pass" — what survives contact with Bihar constraints

**Output:** `EvidenceApproachPack` + `BiharAdaptationNotes`

### Stage F — Framework Mapping (Multiple Intelligences + Capabilities)

**Bot does:**
- Convert proposed outcomes into:
  - **MI coverage** (which intelligences are intentionally developed; how)
  - **Capabilities coverage** (which capabilities are advanced; indicators; safeguards)
- Detect "framework gaps" (e.g., over-indexing on cognitive outcomes, weak agency/safety)

**Output:** `FrameworkAlignmentMatrix`

### Stage G — Budget Shaping (Hard Constraint: Rs 30-50L/year/funder)

**Bot does:**
- Build budget skeleton aligned to opportunity norms but forced into band: **Rs 30-50 lakhs per year per funder**
- Run budget sanity checks:
  - Unit-cost reasonableness
  - Staffing ratios
  - Activity-to-cost coherence
  - Overhead caps (as per funder rules)

**Output:** `BudgetEnvelope` + `BudgetChecks`

### Stage H — Proposal Blueprint + Section Drafting (only now)

**Bot does:**
- Produce blueprint: section outline + key claims + evidence anchors + Bihar adaptation logic + monitoring plan + budget narrative
- Then draft sections

**Output:** `ProposalBlueprint` -> `DraftProposalV1`

---

## 2) Scoring Rubric (Go / Maybe / No)

**Fit Score (0-100)**

| Dimension | Weight |
|---|---|
| Program fit | 0-25 |
| Strategic alignment | 0-20 |
| Strategic gap value (bonus for unfunded priority) | 0-10 |
| Evidence strength | 0-15 |
| Bihar feasibility | 0-15 |
| Budget fit to Rs 30-50L/year | 0-15 |

**Decision Rule:**
- **>=75**: Proceed to blueprint + drafting
- **60-74**: Proceed only if one fixable weakness (e.g., partners, feasibility, budget)
- **<60**: Park it (and log why)

---

## 3) Required Data Assets

1. **Program Registry (structured)**
   - Program name, geographies, target groups, activity menu, delivery cadence, staffing model, cost drivers, existing indicators, safeguarding practices

2. **Strategic Plan Index (structured)**
   - Priorities -> sub-priorities -> "already funded?" -> "has proposal blueprint?" -> "evidence base notes"

3. **Framework Libraries**
   - MI -> example activities -> outputs -> indicators
   - Capabilities (Diksha model) -> definitions -> indicators -> "do no harm" safeguards

4. **Budget Templates**
   - Standard cost heads + typical unit costs + overhead policy ranges

---

## 4) New Features (Buildable)

### Slack Commands
- `/opportunity ingest <url|doc>` -> creates OpportunityBrief
- `/opportunity assess <id>` -> runs Stages B-G, returns Fit Score + Go/No-Go
- `/proposal blueprint <opp_id>` -> generates ProposalBlueprint
- `/proposal draft <opp_id> <section|all>` -> drafts sections with citations
- `/budget shape <opp_id> <30|40|50>` -> forces envelope + runs checks
- `/history find <topic keywords>` -> Gmail + Drive memory pack

### DB Tables / Sheets Tabs
- Opportunities
- Fit Assessments
- Strategic Gaps
- Evidence Packs
- Framework Mapping
- Budgets (with check columns + pass/fail flags)
- Proposal Versions + status

### Quality Gates (Non-Negotiable)
- No drafting if missing: eligibility + budget band feasibility + basic program match
- No "global best practices" without at least 2 credible sources (stored as links/snippets internally)
- No budget output without unit-cost assumptions visible

---

## 5) Implementation Slices

### Slice 1 (High Leverage, Low Complexity)
- Ingest opportunity
- Fit scoring (program + strategy)
- Gmail memory pack
- Budget envelope to Rs 30-50L/year
- **Output:** Blueprint + budget + "what to reuse" map

### Slice 2 (Adds Intelligence)
- Web evidence scan + Bihar adaptation synthesis
- MI + Capabilities mapping matrices
- Draft sections with traceability (which claim came from where)

---

## Guiding Principle

> The bot should behave like Gautam on a deadline — disciplined, evidence-aware, Bihar-realistic, and allergic to budgets that look like they were guessed in an elevator.
