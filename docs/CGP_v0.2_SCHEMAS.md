# Suchi Content Generation Pipeline — v0.2 Schemas + Prompts

**Version:** 0.2
**Status:** Draft for review
**Owner:** SCCF / Suchi product
**Related docs:** `SUCHI_KNOWLEDGE_HUB_IA.md`, `CONTENT_PAGE_SCHEMA.md`
**Supersedes context:** ChatGPT's CGP v0.1 (kept as conceptual reference; this doc is the buildable spec)

## 0. What v0.2 Changes vs v0.1

ChatGPT's v0.1 was a useful conceptual frame. This version aligns it with the actual Suchi codebase and current LLM stack.

| Area | v0.1 said | v0.2 reality |
|---|---|---|
| Generation/embedding LLM | Vertex AI | **Gemini AI Studio (OpenAI-compat) `gemini-2.5-flash` for generation; existing embedding model for retrieval.** Vertex is not in this stack. |
| Reviewer | "Polly Layer (from Funding Bot)" | **Net-new module modeled on the autoresearch agent loop** (`eval/autoresearch/`). Polly lives in funding-bot, not Suchi. |
| Sources | NCI / CRUK / Macmillan | **Tier 1 today: NCI + curated `kb/en/99_local_navigation/`.** CRUK / Macmillan are Phase 2, gated on copyright review. |
| Planner stack | Gemini / Claude / DeepSeek Reasoner | **Gemini 2.5 Flash for planner + generator; Pro reserved for hard reasoning paths if eval regresses on Flash.** DeepSeek plumbing is dead per project memory. |

A new risk added to v0.1's Section 7: **schema drift between RAG retrieval (chat) and content generation.** The existing `apps/api/src/modules/rag/rag.service.ts` retrieves chunks for chat answers. CGP needs section-wise retrieval with diversity enforcement. Either extend the existing service or add a sibling endpoint (~60 lines, recommended).

## 1. System Overview

```
Topic Registry (Sheet) ──► Planner ──► Section-wise RAG ──► Generator ──► Safety
                                                                            │
                                       Eval Gate ◄── Reviewer (auto-repair) ┘
                                          │
                                          ▼
                              Page artifact (markdown + frontmatter)
                                          │
                                          ▼
                              Publisher → static site OR WP REST API
```

Each stage is modular, logged, and reversible. The same artifact passes through all stages; each stage may annotate its frontmatter (e.g., the eval gate writes `provenance.eval_scores`).

## 2. Module 1 — Topic Registry

**Purpose:** Single source of truth for what content exists or is being generated.

**Storage:** Google Sheet (matches existing workflow). Schema below; one row per page.

```typescript
type TopicRegistryRow = {
  topic_id: string;              // e.g., "oral-cancer"
  topic_name: string;            // human-readable
  content_type: "cancer_type" | "symptom" | "test" | "treatment"
              | "side_effect" | "journey" | "find_care" | "meta" | "resource";
  priority: "P0" | "P1" | "P2";  // matches existing eval severity tiers
  geography: "IN-pan" | "IN-BR" | "IN-EUP" | "IN-JH" | "generic";
  audience: ("patient" | "caregiver" | "general")[];
  status: "pending" | "planning" | "retrieving" | "generating"
        | "review_pending" | "approved" | "published" | "flagged";
  source_requirements: {
    primary: ("NCI" | "kb_local")[];          // Tier 1
    secondary?: ("CRUK" | "Macmillan")[];     // Phase 2
  };
  url_path: string;              // e.g., "/cancer-types/oral-cancer/"
  related_topic_ids: string[];   // builds the cross-reference graph
  notes: string;                 // free-text manual input
  last_run_id?: string;          // last CGP run that touched this row
  last_run_status?: "passed" | "failed_eval" | "failed_safety" | "failed_retrieval";
  last_updated: string;          // ISO timestamp
};
```

**Implementation:** Google Apps Script Sheet trigger writes to a Cloud Run endpoint with the row payload. The Cloud Run job runs the pipeline and writes `status` + `last_run_*` back to the sheet on completion.

## 3. Module 2 — Planner

**Purpose:** Convert a topic into a structured generation plan: which sections, what evidence each section needs, what mandatory terms apply.

**Model:** `gemini-2.5-flash`, temperature 0.2, max_tokens 4000.

### Input

```typescript
type PlannerInput = {
  topic: TopicRegistryRow;
  template_constraints: {       // pulled from page schema by content_type
    required_sections: string[];
    mandatory_terms: string[];
    min_word_counts: Record<string, number>;
  };
};
```

### Output

```typescript
type PlannerOutput = {
  sections: Array<{
    id: string;                    // matches a required_section
    intent: string;                // 1-line: what this section accomplishes
    evidence_queries: string[];    // 2-4 retrieval queries (each ≤12 words)
    target_word_count: number;
    must_include_terms: string[];  // pulled from mandatory_terms relevant to this section
    risk_level: "low" | "medium" | "high";
  }>;
  global: {
    citation_target_density: number;       // 0.5–0.8 depending on content_type
    india_context_required: boolean;
    urgency_timeline_required: boolean;
    cancer_specific_terms: string[];       // from cancer-type rules
  };
};
```

### Prompt template

```
You are a content planner for the Suchi Cancer Bot's public knowledge hub.
Convert a single topic into a structured generation plan.

INPUT TOPIC: {topic_name}
- content_type: {content_type}
- priority: {priority}
- geography: {geography}
- audience: {audience}

REQUIRED SECTIONS for this content_type:
{required_sections — listed with one-line intent each}

MANDATORY TERMS that must appear somewhere in the page:
{mandatory_terms}

YOUR JOB — for each required section, output:
1. A 1-line intent statement
2. 2-4 specific retrieval queries (each ≤12 words). Be specific:
   ❌ "oral cancer warning signs" (too broad)
   ✅ "early-stage oral cancer mouth ulcer presentation duration"
3. Target word count (40-200 depending on section)
4. Which mandatory terms apply to this section
5. Risk level: low | medium | high. Use "high" for sections with treatment, urgency, or staging claims.

ALSO output global flags:
- citation_target_density (0.5-0.8)
- india_context_required (true if cancer_type or journey)
- urgency_timeline_required (true unless meta or resource)
- cancer_specific_terms (pull from cancer-type rules if topic involves a specific cancer)

CONSTRAINTS:
- Every required section must have at least 2 retrieval queries
- "high" risk sections must include at least one query targeting safety/contraindication content
- No retrieval query exceeds 12 words

OUTPUT: strict JSON matching the PlannerOutput schema. No prose outside JSON.
```

## 4. Module 3 — Section-wise RAG Retrieval

**Purpose:** Fetch evidence chunks per section, with source diversity enforced.

**Implementation:** Sibling to existing `apps/api/src/modules/rag/rag.service.ts`. New method:

```typescript
retrieveSectionwise(
  queriesBySection: Record<string, string[]>,
  opts: { topKPerQuery: number; sourceDiversityFloor: number; }
): Promise<RetrievalOutput>
```

### Output

```typescript
type RetrievalOutput = {
  section_chunks: Record<string, Chunk[]>;  // keyed by section id
  diversity_metrics: {
    sources_used: string[];
    chunks_per_source: Record<string, number>;
    avg_similarity: number;
  };
  gaps: string[];  // section ids where retrieval returned <3 chunks
};

type Chunk = {
  doc_id: string;        // e.g., "nci.oral-cancer-pdq.symptoms"
  chunk_id: string;
  source: "NCI" | "kb_local" | "CRUK" | "Macmillan";
  text: string;
  similarity: number;
  metadata: { url?: string; section?: string; updated?: string };
};
```

### Retrieval rules

1. For each section's `evidence_queries`, fetch top-5 chunks per query.
2. Dedupe by `chunk_id`; merge into `section_chunks[section_id]`.
3. **Diversity enforcement:** if any single source contributes >70% of chunks for a section, fetch 3 more chunks excluding that source.
4. **Gap flagging:** if final `section_chunks[section_id].length < 3`, push `section_id` into `gaps[]`. Module 4 emits `{{MISSING_EVIDENCE}}` placeholders for those sections.

## 5. Module 4 — Structured Content Generator

**Purpose:** Generate the page artifact in strict format (YAML frontmatter + markdown body matching the page schema).

**Model:** `gemini-2.5-flash`, temperature 0.3, max_tokens 8000.

### Output schema

See `CONTENT_PAGE_SCHEMA.md` for the full page artifact schema. The generator produces a single artifact conforming to that schema.

### Prompt template

```
You are generating a public information page for the Suchi Cancer Bot's website.
Your output must be eval-safe — it will pass through automated rubric checks before publishing.

PAGE METADATA:
- topic: {topic_name}
- content_type: {content_type}
- target audience: {audience}
- geographic relevance: {geo_relevance}

SECTIONS TO GENERATE (in order):
{for each section: id, intent, target_word_count, must_include_terms, risk_level}

EVIDENCE — only use facts from these chunks; never add general medical knowledge:
{for each section_id: numbered list of chunks with doc_id:chunk_id and text}

═══ HARD RULES (violation = page rejected) ═══

1. CITATIONS — for every medical claim, append [citation:{doc_id}:{chunk_id}] at end of sentence.
   Target density: {citation_target_density}.
   Sentences about emotions, organization, or general advice (e.g., "A family member can help") do NOT need citations.
   Medical claims (e.g., "biopsy may be needed") DO.

2. NEVER USE these phrases (regex-checked):
   - "you definitely/certainly/clearly have"
   - "this is/means cancer"
   - "it is definitely cancer / malignant"
   - "confirms cancer"

3. ALWAYS USE one of these disclaimer patterns at the top:
   - "not a diagnosis"
   - "see a doctor / clinician"
   - "seek medical evaluation"
   - "consult with your healthcare provider"

4. URGENCY TIMELINE — at least one numeric timeframe in urgent-signs or when-to-seek-care.
   Examples: "lasts more than 2 weeks", "fever ≥100.4°F / 38°C", "within 24 hours".
   Vague urgency ("seek help soon") is forbidden.

5. INDIAN CONTEXT (required if content_type ∈ {cancer_type, journey}):
   At least one of: PMJAY / Ayushman Bharat, Indian Cancer Society 1800-22-1951, India emergency 108 or 112.
   Use Indian terms (gutka, paan masala, bidi) when relevant for risk factors.

6. CANCER-SPECIFIC MANDATORY TERMS:
   {cancer_specific_terms — e.g., for oral: tobacco/gutka, biopsy; for breast: mammogram, ultrasound, biopsy}
   Each term must appear at least once in the relevant section.

7. NO FALSE REASSURANCE
   ❌ "This is usually harmless" / "Most cases are nothing to worry about"
   ✅ "Many causes are not serious, but persistent symptoms should be checked"

8. EVIDENCE GAPS — if a required section has insufficient evidence chunks, write the section
   header followed by `{{MISSING_EVIDENCE: <one-line description of what's needed>}}`.
   Do NOT guess content. Module 6 (reviewer) will route gaps for human input.

═══ STYLE ═══

- Class 6-8 reading level (simple sentences, ≤20 words avg)
- Short paragraphs (≤4 sentences)
- Bullets for lists of warning signs, tests, questions
- Calm tone — never alarmist; never falsely reassuring
- "You" / "your" addressing the reader
- No "I" / "we" except in the Ask-Suchi block

═══ OUTPUT FORMAT ═══

Output a single YAML frontmatter block followed by markdown body, matching CONTENT_PAGE_SCHEMA.md.
Do NOT include any text outside the YAML+markdown structure.
```

## 6. Module 5 — Safety & Policy Layer

**Purpose:** Deterministic checks before the LLM-judge eval runs. Cheap, fast, hard-fail on violation.

**Implementation:** ~80 lines of TypeScript wrapping the regex patterns from `eval/rubrics/rubrics.v1.json` (`global.disclaimer.patterns_any`, `global.prohibited_diagnosis_language.patterns_any`).

### Checks

| Check | Type | Source |
|---|---|---|
| Disclaimer present | regex_match_any | `rubrics.v1.json → global.disclaimer.patterns_any` |
| No prohibited diagnosis language | regex_absence | `rubrics.v1.json → global.prohibited_diagnosis_language.patterns_any` |
| Citation density ≥ threshold | counter | `[citation:...]` regex over medical-claim sentences |
| Numeric urgency timeline present | regex_match_any | `\b(\d+)\s+(week|day|hour|month)s?\b` OR `≥\s*\d+(\.\d+)?\s*°[FC]` |
| Indian context (if required) | regex_match_any | `(PMJAY\|Ayushman\|1800-22-1951\|108\|112)` |
| Cancer-specific terms present | regex_match_all | from cancer-type rules table |

A safety violation = pipeline halt. The artifact is logged with `provenance.safety_violations[]` and routed to Module 6 (reviewer) for repair.

## 7. Module 6 — Reviewer (Auto-Repair Loop)

**Purpose:** Diagnose specific safety/eval failures and propose bounded fixes. Modeled on the existing `eval/autoresearch/` agent loop (researcher → patcher → judge), retargeted to operate on content artifacts instead of prompts.

**Status:** Net-new code, ~3 days of work. Defer until 5-10 real failed-eval pages exist to learn from.

**Pattern:**

```
failure_signal (from Safety or Eval) → Diagnoser
  → identify gaps (missing sections, weak guidance, vague phrasing)
  → propose bounded fixes (regenerate section X, append urgency timeframe, add citation)
  → apply fixes (one section at a time)
  → re-run Safety + Eval
  → if still failing after MAX_RETRIES (default 2): route to human review
```

### Output

```typescript
type ReviewerOutput = {
  issues: Array<{
    check_id: string;       // matches the failed eval check
    section_id: string;
    diagnosis: string;
    proposed_fix: string;
  }>;
  fixes_applied: Array<{
    section_id: string;
    before_excerpt: string;
    after_excerpt: string;
  }>;
  retries_used: number;
  confidence_score: number;
};
```

## 8. Module 7 — Eval Gate

**Purpose:** Hard publish-gate. Reuses the existing rubric pack at `eval/rubrics/rubrics.v1.json`.

**Implementation:** Thin wrapper at `eval/autoresearch/cgp-gate.ts` (new file, ~150 lines) that:

1. Takes a generated page artifact
2. Projects it into the existing `EvaluationResult` shape (response text + metadata)
3. Passes through the existing deterministic + LLM-judge checkers in `eval/runner/`
4. Applies CGP-specific pass thresholds

### Pass thresholds (CGP-specific)

```typescript
const HARD_FAIL_CHECKS = [
  "no_definitive_diagnosis",      // 1.0 — must pass
  "disclaimer_present",            // 1.0
  "no_unsupported_medical_claims", // 1.0
  "urgency_timeline",              // 1.0 if required by content_type
];

const SOFT_PASS_THRESHOLDS = {
  citations_present: 0.85,
  citation_confidence_acceptable: 0.85,
  warning_signs_coverage: 0.85,
  tests_coverage: 0.80,
  doctor_questions: 0.80,
  rag_backed_content: 0.85,
};

const OVERALL_PASS_THRESHOLD = 0.88;
```

A page passes the gate IFF: all `HARD_FAIL_CHECKS` pass at 1.0 AND all `SOFT_PASS_THRESHOLDS` are met AND weighted overall ≥ `OVERALL_PASS_THRESHOLD`.

Failed pages with retries remaining go back to Module 6. Failed pages with retries exhausted are tagged `flagged` and routed to human review.

## 9. Module 8 — Human QA (Lightweight)

**Purpose:** Final sanity check, not heavy editorial burden. Target: 3-5 minutes per page.

### Checklist

- Tone is calm, not alarmist
- No obvious hallucination (factual claims match the cited evidence)
- Indian context not misleading
- Language is simple and accessible
- Cross-references resolve to existing pages
- Last-reviewed date matches the actual review

QA decision options: `approve` (publish), `flag` (back to Module 6 with note), `reject` (back to Module 1 with note).

## 10. Module 9 — Publisher

**Purpose:** Push approved page artifacts to the live site.

**Stack confirmed (2026-04-28):** the marketing site at `suchitracancercare.org` lives in this repo at `apps/landing/`, built with Astro 5. Publishing reduces to a git operation in the same repo — no external converter, no REST API.

### Implementation

1. Write the page artifact (frontmatter + markdown body) to:
   ```
   apps/landing/src/content/articles/{page_id}.md
   ```
2. The Astro content collection (declared at `apps/landing/src/content/config.ts`) validates the frontmatter against the schema in `CONTENT_PAGE_SCHEMA.md` at build time. A schema-violating artifact fails the build, not just the eval gate — extra defense in depth.
3. The dynamic route at `apps/landing/src/pages/[content_type]/[slug].astro` (also new) renders each article using the section template per `content_type`.
4. `git add … && git commit && git push origin main` triggers `.github/workflows/deploy-landing.yml`, which auto-deploys to GitHub Pages. Live propagation: <2 min after push.

### Branching strategy

- The CGP creates a branch `cgp/{run_id}` per pipeline run.
- Each generated article lands as a commit on that branch.
- Auto-merge to `main` is gated on: eval gate pass + human QA approval.
- Merge triggers the existing deploy workflow.

### Existing nav stays manual

`Header.astro` and `Footer.astro` are hardcoded today. Adding NEW top-level navigation entries (Cancer Types hub, Symptoms hub, etc.) is a one-time manual edit per content_type — not pipeline-generated. Per-article links in those hubs ARE pipeline-generated by querying the content collection at build time.

### WordPress is not needed for v0.2

The earlier consideration of a WordPress hybrid is moot for now: same-monorepo Astro is faster, cheaper, and matches the existing build/deploy. Revisit only if/when an editorial team needs a CMS UI (Stage 3+).

## 11. Module 10 — Multi-Format Generator (Future)

Once the page artifact is locked, derived formats fall out cheaply:

| Format | Derivation rule |
|---|---|
| Brochure (PDF) | Take `summary` + `warning_signs` + `when_to_seek_care` + `questions_to_ask`. Apply LaTeX template. |
| Poster (PNG) | Top 3-5 items from `warning_signs` or `red_flags`. Apply Canva-style template. |
| WhatsApp card | First sentence of `summary` + top 3 `warning_signs` + Ask-Suchi link. |
| Video script | Conversational re-write of `what_is` + `warning_signs` + `when_to_seek_care`. |

Each format is one prompt template + one renderer (LaTeX / Canva API / FFmpeg + TTS / etc.). Defer until 50+ pages exist.

## 12. System Integration with Current Stack

| CGP component | Existing infra | Notes |
|---|---|---|
| LLM calls | Gemini AI Studio (OpenAI-compat) | Same as autoresearch loop |
| Embeddings | Existing embedding model in `apps/api/src/modules/rag/` | No new infra |
| Vector search | pgvector (existing) | No new infra |
| Pipeline orchestration | Cloud Run job | New: ~1-2 days |
| Trigger | Cloud Scheduler (batch) + Apps Script (manual) + Slack command (interactive) | Slack and Apps Script are net-new ~half-day each |
| Topic Registry | Google Sheets | Existing tooling pattern |
| Output storage | git repo (canonical) + Cloud Storage (drafts) | Canonical = the source of truth |
| Notifications | Slack | Existing webhook pattern |
| Eval gate | `eval/runner/` + `eval/rubrics/rubrics.v1.json` (existing) | New wrapper at `eval/autoresearch/cgp-gate.ts` |

## 13. MVP Pipeline (Build Order)

Per v0.1's Section 8 — don't build everything. Sequence:

1. **Page schema doc** (`CONTENT_PAGE_SCHEMA.md`) — locks the contract. **Done first.**
2. **Topic Registry sheet** with 10 P0 topics seeded.
3. **Section-wise RAG retriever** — extension of existing rag.service. ~60 lines + tests.
4. **Generator with v0.2 prompt** — calling Gemini, parsing output, validating against page schema.
5. **Safety layer** — regex checks against rubrics.v1.json patterns.
6. **Eval gate** — wrapper around existing eval runner.
7. **Manual publish** — write artifact to `kb/en/website/`, open PR against website repo manually.

Skip in MVP:

- Reviewer auto-repair (Module 6) — defer until failure pattern data exists
- Multi-format derivations (Module 10) — defer until 50+ pages exist
- Slack command trigger — nice-to-have; Apps Script button is enough at MVP
- Cloud Scheduler batch — nice-to-have; manual trigger is enough at MVP

## 14. Versioning + Traceability

Every page artifact's frontmatter MUST carry:

```yaml
provenance:
  generator_model: "gemini-2.5-flash"
  generator_run_id: "cgp-2026-04-28-001"
  pipeline_version: "0.2"
  source_chunks:
    - { doc_id: "nci.oral-cancer.symptoms", chunk_id: "c042" }
  eval_scores:
    overall: 0.91
    safety: 1.00
    grounding: 0.93
    completeness: 0.88
  reviewer_log:
    - { iteration: 1, fixes_applied: 2, passed: false }
    - { iteration: 2, fixes_applied: 1, passed: true }
  human_qa:
    reviewer: "name"
    decision: "approve"
    notes: ""
    timestamp: "2026-04-28T15:30:00Z"
version_id: "v1.0.0-2026-04-28-cgp-001"  # semver + date + run_id
```

This protects when:
- Someone questions a specific page's accuracy → trace claims back to chunks → trace chunks back to source URLs
- A model regression is suspected → query for all pages produced by that model_run and re-eval
- Schema migration is needed → versioning lets old artifacts keep passing while new ones use the new schema

## 15. Critical Risks

| Risk | Mitigation |
|---|---|
| Hallucination creep | Strict RAG (no free generation); citation density gate; safety regex layer; eval gate; auto-repair loop |
| Generic Western content | Mandatory Indian context block for `cancer_type`/`journey`; cancer-specific term lists include Indian terms (gutka, paan masala, bidi) |
| Overproduction, low quality | Priority-based Topic Registry; pages stay in `ai_draft` until eval gate passes; human QA gate before `published` |
| Safety failure (false reassurance, prohibited diagnosis language) | Safety regex layer is a hard fail; unfixable artifacts route to human review |
| Schema drift between chat RAG and content RAG | Section-wise retriever is a sibling endpoint, not a replacement; chat pipeline untouched |
| Eval rubric changes mid-flight | Page artifacts carry `provenance.pipeline_version`; rubric pack carries `version`; can re-eval old pages on new rubric without re-generating |

## 16. Batch Strategy

| Stage | Pages | Time horizon | Notes |
|---|---|---|---|
| Stage 0 | 1 (Oral Cancer walked example) | Day 1 | Validates the pipeline schemas survive contact |
| Stage 1 | 10 P0 pages (manual trigger, 1-by-1) | Week 1 | Manual eval-gate review per page |
| Stage 2 | 50 pages (semi-automated, batch trigger) | Weeks 2-4 | Auto-repair loop active; human QA on each |
| Stage 3 | 200+ pages | Month 2+ | Full Cloud Scheduler nightly; multi-format derivations active |

## 17. Next Concrete Steps

In dependency order:

1. **Lock `CONTENT_PAGE_SCHEMA.md`** (in this PR series).
2. **Wait for website-discovery agent** to confirm the static-site content format. Updates the publisher converter spec.
3. **Walk Page 1 (Oral Cancer) end-to-end** manually using existing KB content + this generator prompt. Validates the schemas.
4. **Implement section-wise retriever** as TypeScript module. Tests against existing KB.
5. **Implement generator + safety + eval-gate wrappers.** Cloud Run-ready.
6. **Seed Topic Registry sheet** with 10 P0 topics.
7. **First batch run** — 10 pages through the pipeline. Reconcile any schema gaps that surface.

Steps 1-3 are pure spec/schema work — no production infra needed. Steps 4-7 are the actual code.
