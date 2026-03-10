# RAG Cross-Pollination Analysis: Suchi Cancer Bot → Funding Bot

> **Purpose**: Identify transferable RAG patterns from the Suchi Cancer Bot that can improve the Funding Bot's evidence retrieval, reranking, and citation quality.
>
> **Date**: 2026-03-01

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Side-by-Side Architecture Comparison](#2-side-by-side-architecture-comparison)
3. [Gap Analysis: What the Funding Bot Lacks](#3-gap-analysis-what-the-funding-bot-lacks)
4. [Transferable Patterns (Prioritized)](#4-transferable-patterns-prioritized)
   - P0: Hybrid Search (Vector + FTS)
   - P0: Cross-Encoder Reranking with Intent-Based Gating
   - P1: Multi-Query Retrieval with RRF Scoring
   - P1: Query Expansion with Domain Synonyms
   - P1: Retrieval Confidence Gating (Strengthen Existing)
   - P2: Query Decomposition for Multi-Faceted Proposals
   - P2: Trusted Source Boosting
   - P2: Retrieval-with-Expansion Retry
   - P3: Result Diversification
   - P3: Dynamic Hybrid Weights
5. [Implementation Roadmap](#5-implementation-roadmap)
6. [Funding-Specific Domain Adaptations](#6-funding-specific-domain-adaptations)
7. [Estimated Impact](#7-estimated-impact)
8. [Files Reference](#8-files-reference)

---

## 1. Executive Summary

The Suchi Cancer Bot has a **multi-stage RAG pipeline** with 8 distinct retrieval enhancement techniques, developed for high-stakes medical Q&A. The Funding Bot currently uses a **single-stage vector retrieval** with corpus routing and policy-tier filtering. Transplanting 4–6 key patterns from the Cancer Bot can materially improve the Funding Bot's proposal quality — particularly for evidence depth, citation coverage, and retrieval relevance.

### Key Findings

| Dimension | Cancer Bot | Funding Bot | Gap |
|-----------|-----------|-------------|-----|
| **Search type** | Hybrid (vector + FTS), dynamic weights | Vector-only (pgvector cosine) + keyword fallback | **Critical** |
| **Reranking** | Cross-encoder (Voyage/Cohere/Jina) with intent gating | None | **Critical** |
| **Query expansion** | 6 synonym maps + abbreviation expansion | LLM-generated queries only | **High** |
| **Multi-query retrieval** | 3 parallel queries + RRF fusion | Single query per section | **High** |
| **Retrieval confidence** | Evidence gate (HIGH/MEDIUM/LOW) → response routing | Basic confidence scoring (high/medium/low) | Moderate |
| **Trusted source boost** | Multiplicative boost (1.5x/1.25x/1.1x) by source priority | Quality-tier filtering (A/B/C) but no post-retrieval boosting | Moderate |
| **Query decomposition** | Rule-based signal detection → multi-intent retrieval | N/A (each section gets separate query batch) | Moderate |
| **Result diversification** | Round-robin by document source | None | Low |
| **Cross-lingual** | Hindi↔English dictionary-based parallel queries | Not applicable | N/A |
| **Retrieval retry** | Expansion/retry when initial results thin | None | Low |

### Top 4 Recommendations (Immediate Impact)

1. **Add Full-Text Search** to create true hybrid retrieval (vector + lexical)
2. **Add cross-encoder reranking** with section-type gating (skip for boilerplate sections)
3. **Add multi-query retrieval** with RRF scoring for each proposal section
4. **Add domain-specific query expansion** for fundraising terminology

---

## 2. Side-by-Side Architecture Comparison

### Cancer Bot Retrieval Pipeline

```
User Query
  │
  ├─→ [1] Emergency Fast-Path (regex, sub-1ms)
  │     └─→ Skip RAG entirely for crisis/self-harm
  │
  ├─→ [2] Cross-Cancer Topic Detection
  │     └─→ Multi-cancer diversified retrieval (smoking, HPV, obesity)
  │
  ├─→ [3] Query Expansion (rule-based, zero LLM cost)
  │     ├─→ Symptom synonyms (bloating → abdominal distension)
  │     ├─→ Treatment synonyms (chemo → chemotherapy)
  │     ├─→ Medical abbreviations (PSA → prostate-specific antigen)
  │     ├─→ Cancer type synonyms (colon → colorectal)
  │     ├─→ Navigation synonyms (Patna hospitals → Mahavir Cancer Sansthan)
  │     └─→ Risk factor synonyms
  │
  ├─→ [4] Multi-Query Retrieval (top 3 query variants, parallel)
  │     └─→ RRF-lite scoring: boost chunks found by multiple queries
  │
  ├─→ [5] Hybrid Search
  │     ├─→ Vector: pgvector cosine distance
  │     ├─→ FTS: PostgreSQL websearch_to_tsquery + ts_rank_cd
  │     └─→ Dynamic weights: short queries 80/20 vec/lex, long queries 55/45
  │
  ├─→ [6] Cross-Encoder Reranking (Voyage/Cohere/Jina)
  │     └─→ Intent-based gating: skip for low-stakes, always for high-stakes
  │
  ├─→ [7] Trusted Source Reranking
  │     ├─→ High-priority (NCI, NCG): 1.50x boost
  │     ├─→ Medium-priority (IARC, PMC): 1.25x boost
  │     └─→ Untrusted: 0.95x penalty
  │
  └─→ [8] Evidence Gate → Response Type Decision
        ├─→ HIGH confidence → Answer directly
        ├─→ MEDIUM → Answer with hedging
        ├─→ LOW → Ask clarifying question
        └─→ INSUFFICIENT → Abstain with Safe-but-Helpful guidance
```

### Funding Bot Retrieval Pipeline (Current)

```
Proposal Section
  │
  ├─→ [1] LLM Query Generator (5-10 queries per section)
  │     └─→ Funder themes, must-answer list, evidence types → JSON array
  │
  ├─→ [2] Corpus Router (deterministic, per section type)
  │     └─→ budget → [diksha_internal, donor_funder]
  │     └─→ objectives → [diksha_internal, theory_frameworks]
  │     └─→ etc.
  │
  ├─→ [3] pgvector Cosine Search (single-stage)
  │     ├─→ HNSW index scan with 5x overselect
  │     ├─→ Post-filter: quality tier, org isolation, corpus, docType, capabilities
  │     └─→ Keyword fallback only when embedding fails
  │
  ├─→ [4] Retrieval Confidence Scoring
  │     ├─→ HIGH: avgScore ≥ 0.50, ≥ 3 chunks, ≥ 2 unique docs
  │     ├─→ MEDIUM: avgScore ≥ 0.35, ≥ 2 chunks
  │     └─→ LOW: below thresholds
  │
  └─→ [5] Section Writer → Citation Repair → QA Reviewer
```

### Key Architectural Differences

| Aspect | Cancer Bot | Funding Bot |
|--------|-----------|-------------|
| **Query origin** | User natural language | LLM-generated from section spec |
| **Search engine** | Hybrid (vector + FTS) | Vector only (with keyword fallback) |
| **Result improvement** | Cross-encoder reranking + trust boost | None post-retrieval |
| **Multi-query** | Built-in with RRF fusion | Queries generated but executed independently |
| **Confidence routing** | Gates response type (answer/hedge/abstain) | Informs writer prompt, no hard gate |
| **Corpus partitioning** | Source-type filtering + intent preferences | Corpus + docType + capability filtering |

---

## 3. Gap Analysis: What the Funding Bot Lacks

### Gap 1: No Lexical/Full-Text Search Component (CRITICAL)

**What's missing**: The Funding Bot relies entirely on vector similarity. If the embedding model doesn't capture a specific proper noun, metric, or acronym, it's invisible to retrieval.

**Why it matters for proposals**:
- Funder names ("UNICEF", "Azim Premji Foundation") are proper nouns that vectors handle poorly
- Specific metrics ("85% attendance rate", "INR 2.3 crore") are lost in vector space
- Program names ("KHEL", "SPARK", "Project Sunshine") need exact match
- Budget line items ("travel", "equipment", "stipends") benefit from keyword precision

**Cancer Bot solution**: PostgreSQL `websearch_to_tsquery` with `ts_rank_cd` scoring, combined with vector via weighted sum.

**Funding Bot adaptation**: Add FTS to the existing pgvector SQL query using a CTE-based approach. The Funding Bot already uses raw SQL (`$queryRawUnsafe`), so adding a `fts_matches` CTE alongside the existing `top_vectors` CTE is straightforward.

### Gap 2: No Post-Retrieval Reranking (CRITICAL)

**What's missing**: Retrieved chunks are returned in raw cosine similarity order. No cross-encoder validates semantic relevance.

**Why it matters for proposals**:
- A chunk about "KHEL sports program" might rank above "KHEL learning outcomes" by vector similarity alone, even when the section is about outcomes
- Budget sections need precise financial data, not topically similar narrative
- The proposal's 8-stage pipeline invests heavily in generation but uses raw retrieval results

**Cancer Bot solution**: Voyage AI reranking ($0.05/1M tokens) with intent-based gating to avoid unnecessary API calls.

**Funding Bot adaptation**: Add reranking after pgvector retrieval, gated by section type. Always rerank for `budget`, `objectives`, `monitoring` (high-evidence sections). Skip for `team`, `sustainability` (narrative-heavy, less evidence-dependent).

### Gap 3: No Multi-Query Fusion (HIGH)

**What's missing**: The LLM generates 5-10 queries per section, but each is executed independently. There's no fusion scoring across queries.

**Why it matters**:
- A chunk found by 3 out of 5 queries is likely more relevant than one found by 1 query
- Currently all queries compete rather than corroborate each other
- The `plan.md` gap analysis noted "evidence depth" as a top-3 issue

**Cancer Bot solution**: Multi-query retrieval with RRF-lite scoring: `finalScore = maxScore * (1.0 + (queryCount - 1) * 0.15)` for chunks found by multiple queries.

### Gap 4: No Domain-Specific Query Expansion (HIGH)

**What's missing**: The Funding Bot relies entirely on the LLM to generate the right query terms. There's no systematic expansion of fundraising terminology.

**Why it matters**:
- A query about "program outcomes" should also search for "impact indicators", "M&E results", "ToC outputs"
- A query about "budget" should also search for "cost estimates", "financial projections", "expenditure"
- A query about "beneficiaries" should also search for "target population", "participants", "stakeholders"
- The LLM query generator sometimes misses important synonyms, especially for domain-specific Diksha terminology

**Cancer Bot solution**: Static synonym maps keyed by category (symptoms, treatments, abbreviations, etc.), applied at zero LLM cost.

### Gap 5: No Trusted Source Boosting (MODERATE)

**What's missing**: The Funding Bot has quality tiers (A/B/C) for document filtering, but no post-retrieval score boosting based on source trustworthiness.

**Why it matters**:
- Tier A (vetted, citable) documents should rank higher than Tier B (supporting) documents when both match
- Currently, a Tier B document with slightly higher cosine similarity beats a Tier A document
- The `plan.md` noted "evidence depth" and the need for 2000+ char chunks from authoritative sources

**Cancer Bot solution**: Multiplicative trust boost applied after hybrid scoring: high-priority 1.50x, medium 1.25x, low 1.10x.

### Gap 6: No Retrieval-with-Retry for Thin Results (LOW)

**What's missing**: If retrieval returns few chunks or low-scoring chunks, there's no automatic expansion/retry.

**Cancer Bot solution**: `retrieveWithExpansion()` adds diagnostic/screening expansion terms and retries when initial results < minChunks.

---

## 4. Transferable Patterns (Prioritized)

### P0-A: Hybrid Search (Vector + FTS)

**Source**: `apps/api/src/modules/rag/rag.service.ts` lines 200-280

**What to transplant**:
Add a `fts_matches` CTE to the existing pgvector query in `retrieval.service.ts`. The Funding Bot already uses raw SQL, making this a surgical addition.

**Proposed SQL structure**:
```sql
WITH top_vectors AS (
  -- Existing HNSW vector search (unchanged)
  SELECT ce."chunkId",
         1 - (ce."embedding" <=> $1::vector) AS vec_score
  FROM "ChunkEmbedding" ce
  WHERE ce."embedding" IS NOT NULL
  ORDER BY ce."embedding" <=> $1::vector
  LIMIT $2::int
),
fts_matches AS (
  -- NEW: Full-text search using PostgreSQL tsquery
  SELECT dc."id" AS "chunkId",
         ts_rank_cd(to_tsvector('simple', dc."content"), websearch_to_tsquery('simple', $16::text)) AS fts_score
  FROM "DocumentChunk" dc
  WHERE to_tsvector('simple', dc."content") @@ websearch_to_tsquery('simple', $16::text)
  ORDER BY fts_score DESC
  LIMIT $2::int
),
combined AS (
  SELECT COALESCE(tv."chunkId", fm."chunkId") AS "chunkId",
         COALESCE(tv.vec_score, 0) AS vec_score,
         COALESCE(fm.fts_score, 0) AS fts_score,
         -- Dynamic weighting: use 0.65/0.35 as default for proposal queries
         0.65 * COALESCE(tv.vec_score, 0) + 0.35 * COALESCE(fm.fts_score, 0) AS hybrid_score
  FROM top_vectors tv
  FULL OUTER JOIN fts_matches fm ON tv."chunkId" = fm."chunkId"
)
SELECT ... FROM combined ...
ORDER BY hybrid_score DESC
```

**Migration requirement**: Add a GIN index on `DocumentChunk.content`:
```sql
CREATE INDEX idx_document_chunk_fts ON "DocumentChunk"
  USING gin(to_tsvector('simple', "content"));
```

**Effort**: ~2 days (SQL changes + index migration + testing)

### P0-B: Cross-Encoder Reranking with Section-Type Gating

**Source**: `apps/api/src/modules/rag/reranker.service.ts` (486 lines)

**What to transplant**:
Port `RerankerService` to the Funding Bot, adapting intent-based gating to section-type gating.

**Section-type gating rules for Funding Bot**:

```typescript
// Always rerank: high-evidence sections where precision matters
const ALWAYS_RERANK_SECTIONS = new Set([
  'budget',
  'objectives',
  'monitoring',
  'results',
  'need',          // Need statement must cite statistics
]);

// Usually skip: narrative-heavy sections
const SKIP_RERANK_SECTIONS = new Set([
  'team',
  'sustainability',
  'communication',
  'cover_letter',
]);

// Conditional: rerank only if score ambiguity detected
// (same gating logic as Cancer Bot: gap3, gap6, h1 thresholds)
```

**Provider recommendation**: Voyage AI (`rerank-2`) at $0.05/1M tokens. For a typical proposal with 10 sections × 20 chunks each = 200 rerank calls, the cost is ~$0.002 per proposal — negligible.

**Effort**: ~1 day (port service + adapt gating + add to proposal pipeline)

### P1-A: Multi-Query Retrieval with RRF Scoring

**Source**: `apps/api/src/modules/rag/rag.service.ts` lines 100-160

**What to transplant**:
The Funding Bot already generates 5-10 queries per section via `QueryGeneratorService`. Currently these are likely executed independently. Add RRF fusion scoring:

```typescript
// After executing N queries, merge results:
function rrfFuseResults(
  queryResults: RetrievalChunkDto[][],
  k: number = 60  // RRF constant
): RetrievalChunkDto[] {
  const chunkScores = new Map<string, { chunk: RetrievalChunkDto; rrfScore: number; queryCount: number }>();

  for (const results of queryResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const chunk = results[rank];
      const existing = chunkScores.get(chunk.id);
      const rrfContribution = 1 / (k + rank + 1);

      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.queryCount += 1;
        // Keep highest-scoring version
        if ((chunk.score ?? 0) > (existing.chunk.score ?? 0)) {
          existing.chunk = chunk;
        }
      } else {
        chunkScores.set(chunk.id, { chunk, rrfScore: rrfContribution, queryCount: 1 });
      }
    }
  }

  // Multi-query boost: chunks found by multiple queries get bonus
  for (const entry of chunkScores.values()) {
    entry.rrfScore *= (1.0 + (entry.queryCount - 1) * 0.15);
  }

  return [...chunkScores.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(e => ({ ...e.chunk, score: e.rrfScore }));
}
```

**Where to integrate**: In `proposal.service.ts`, after calling `queryGenerator.generateQueries()` and before passing evidence to `sectionWriter.writeSection()`.

**Effort**: ~1 day (add fusion function + integrate into proposal pipeline)

### P1-B: Query Expansion with Domain Synonyms

**Source**: `apps/api/src/modules/rag/query-expander.service.ts` (435 lines)

**What to transplant**:
Create a `FundingQueryExpanderService` with fundraising/development-sector synonym maps.

**Proposed synonym maps for Funding Bot**:

```typescript
const FUNDRAISING_SYNONYMS: Record<string, string[]> = {
  // Proposal terminology
  "outcomes": ["impact indicators", "results framework", "M&E results", "ToC outputs", "program results"],
  "beneficiaries": ["target population", "participants", "stakeholders", "end users", "communities served"],
  "budget": ["cost estimates", "financial projections", "expenditure plan", "resource allocation"],
  "need statement": ["problem statement", "situation analysis", "needs assessment", "context analysis"],
  "sustainability": ["exit strategy", "long-term viability", "institutionalization", "scale-up plan"],
  "monitoring": ["M&E", "evaluation framework", "data collection", "progress tracking", "KPIs"],

  // Diksha-specific programs
  "KHEL": ["sports program", "physical education", "Khelkud program", "games and sports"],
  "SPARK": ["digital literacy", "computer training", "IT education", "digital skills"],
  "SEL": ["social emotional learning", "life skills", "psychosocial development", "soft skills"],

  // Indian development sector
  "CSR": ["corporate social responsibility", "Section 135", "CSR funding"],
  "FCRA": ["Foreign Contribution Regulation Act", "foreign funding"],
  "NEP": ["National Education Policy", "NEP 2020"],
  "RTE": ["Right to Education", "RTE Act"],

  // Funder terminology
  "grant": ["funding", "financial support", "program support", "project funding"],
  "capacity building": ["training", "skill development", "institutional strengthening"],
  "theory of change": ["ToC", "impact pathway", "causal framework", "logic model"],
};

const FUNDRAISING_ABBREVIATIONS: Record<string, string[]> = {
  "M&E": ["monitoring and evaluation"],
  "ToC": ["theory of change"],
  "KPI": ["key performance indicator"],
  "FTE": ["full-time equivalent"],
  "INR": ["Indian Rupees"],
  "CSR": ["corporate social responsibility"],
  "FCRA": ["Foreign Contribution Regulation Act"],
  "NGO": ["non-governmental organization"],
  "CBO": ["community-based organization"],
  "SHG": ["self-help group"],
  "ASER": ["Annual Status of Education Report"],
};
```

**Effort**: ~0.5 days (create service + synonym maps + integrate)

### P1-C: Strengthen Retrieval Confidence Gating

**Source**: `apps/api/src/modules/evidence/evidence-gate.service.ts` (Cancer Bot)

**What exists**: The Funding Bot already has `retrieval-confidence.ts` with HIGH/MEDIUM/LOW levels, but it only informs the writer prompt — it doesn't gate behavior.

**What to add**:
- **LOW confidence → placeholder insertion**: When confidence is LOW for a section, automatically insert `[Insert: specific data needed]` placeholders rather than letting the LLM hallucinate
- **LOW confidence → query retry**: Try expanded queries before accepting LOW confidence
- **Section-type-specific thresholds**: Budget and monitoring sections should require HIGH confidence; narrative sections can accept MEDIUM

```typescript
const SECTION_CONFIDENCE_REQUIREMENTS: Record<string, "high" | "medium" | "low"> = {
  budget: "high",       // Financial claims need strong evidence
  monitoring: "high",   // M&E framework needs documented methodology
  results: "high",      // Impact claims need data backing
  need: "medium",       // Can use external statistics
  objectives: "medium", // Mix of evidence-backed and aspirational
  activities: "low",    // Mostly descriptive
  team: "low",          // Mostly internal info
  sustainability: "low",
};
```

**Effort**: ~0.5 days (enhance existing utility + add section-type thresholds)

### P2-A: Query Decomposition for Multi-Faceted Proposals

**Source**: `apps/api/src/modules/rag/query-decomposer.service.ts` (412 lines)

**What to transplant**:
For proposal sections that span multiple evidence needs, decompose the retrieval into targeted sub-queries with different corpus preferences.

**Example**: A "Need Statement" section needs:
1. **Statistics**: Bihar education data, dropout rates → corpus: `external_evidence`
2. **Policy context**: NEP 2020, state education policy → corpus: `theory_frameworks`
3. **Organizational experience**: Prior Diksha assessments → corpus: `diksha_internal`

The `CITATIONS_NEEDED_MAP` in `query-generator.prompt.ts` already has this information — it just needs to be used for corpus-targeted retrieval rather than only prompt construction.

**Effort**: ~1 day (create decomposer + integrate with corpus router)

### P2-B: Trusted Source Boosting

**Source**: `apps/api/src/modules/rag/rag.service.ts` lines 350-400

**What to transplant**:
Apply multiplicative boost to scores based on document quality tier after retrieval:

```typescript
function applyTierBoost(chunks: RetrievalChunkDto[]): RetrievalChunkDto[] {
  const TIER_BOOST: Record<string, number> = {
    "A": 1.30,   // Vetted, citable documents
    "B": 1.10,   // Supporting documents
    "C": 1.00,   // Background/reference (no boost)
    "X": 0.90,   // Unreviewed (slight penalty)
  };

  return chunks
    .map(chunk => ({
      ...chunk,
      score: (chunk.score ?? 0) * (TIER_BOOST[chunk.claimType === "hard" ? "A" : "B"] ?? 1.0),
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
```

**Effort**: ~0.5 days

### P2-C: Retrieval-with-Expansion Retry

**Source**: `apps/api/src/modules/rag/rag.service.ts` `retrieveWithExpansion()`

**What to transplant**:
When initial retrieval returns < N chunks or avg score < threshold, automatically retry with expanded terms:

```typescript
async retrieveWithRetry(
  query: string,
  options: RetrievalOptions,
  minChunks: number = 3,
): Promise<RetrievalChunkDto[]> {
  const initial = await this.retrieve(query, options);

  if (initial.length >= minChunks) return initial;

  // Expand with domain synonyms and retry
  const expanded = this.expandQuery(query);
  if (expanded === query) return initial; // No expansion available

  const retry = await this.retrieve(expanded, {
    ...options,
    limit: (options.limit ?? 20) + 5,
  });

  // Merge, deduplicate, re-sort
  const merged = this.mergeAndDeduplicate(initial, retry);
  return merged.slice(0, options.limit ?? 20);
}
```

**Effort**: ~0.5 days

### P3-A: Result Diversification

**Source**: `apps/api/src/modules/rag/rag.service.ts` cross-cancer diversification

**What to transplant**:
Ensure no single document dominates the results. For proposal sections, this prevents the writer from over-citing one source.

```typescript
function diversifyByDocument(
  chunks: RetrievalChunkDto[],
  maxPerDoc: number = 4,
): RetrievalChunkDto[] {
  const docCounts = new Map<string, number>();
  return chunks.filter(chunk => {
    const count = docCounts.get(chunk.source) ?? 0;
    if (count >= maxPerDoc) return false;
    docCounts.set(chunk.source, count + 1);
    return true;
  });
}
```

**Effort**: ~0.25 days

### P3-B: Dynamic Hybrid Weights

**Source**: `apps/api/src/modules/rag/rag.service.ts` dynamic weighting

**What to transplant**:
Adjust vector vs. lexical weights based on query characteristics:

```typescript
function getHybridWeights(query: string): { wVec: number; wLex: number } {
  const tokenCount = query.split(/\s+/).length;

  // Short queries (proper nouns, metrics): lean more on vector
  if (tokenCount <= 4) return { wVec: 0.80, wLex: 0.20 };

  // Medium queries: balanced
  if (tokenCount <= 8) return { wVec: 0.65, wLex: 0.35 };

  // Long queries (detailed questions): lexical precision matters more
  return { wVec: 0.55, wLex: 0.45 };
}
```

**Effort**: ~0.25 days (part of hybrid search implementation)

---

## 5. Implementation Roadmap

### Phase 1: Foundation (Week 1) — Critical Impact

| # | Task | Effort | Impact | Dependencies |
|---|------|--------|--------|--------------|
| 1.1 | Add GIN index on `DocumentChunk.content` | 0.5d | Enables FTS | DB migration |
| 1.2 | Implement hybrid search (vector + FTS) in `retrieval.service.ts` | 1.5d | **High** — unlocks exact match for proper nouns, metrics | 1.1 |
| 1.3 | Port `RerankerService` to Funding Bot | 0.5d | — | None |
| 1.4 | Add section-type gating for reranker | 0.5d | **High** — improves evidence precision for critical sections | 1.3 |

### Phase 2: Retrieval Quality (Week 2) — High Impact

| # | Task | Effort | Impact | Dependencies |
|---|------|--------|--------|--------------|
| 2.1 | Implement RRF fusion for multi-query results | 1d | **High** — leverages existing query generator | None |
| 2.2 | Create `FundingQueryExpanderService` with synonym maps | 0.5d | **High** — zero LLM cost improvement | None |
| 2.3 | Strengthen retrieval confidence gating per section type | 0.5d | **Medium** — reduces hallucination for data-heavy sections | None |
| 2.4 | Add retrieval-with-retry for thin results | 0.5d | **Medium** — prevents empty sections | 2.2 |

### Phase 3: Polish (Week 3) — Moderate Impact

| # | Task | Effort | Impact | Dependencies |
|---|------|--------|--------|--------------|
| 3.1 | Add trusted source boosting (tier-based score multiplier) | 0.5d | **Medium** — improves citation quality | None |
| 3.2 | Add result diversification (max chunks per document) | 0.25d | **Low** — prevents mono-source sections | None |
| 3.3 | Add query decomposition for multi-evidence sections | 1d | **Medium** — better evidence coverage for complex sections | None |
| 3.4 | Add eval cases for retrieval quality | 1d | **Medium** — regression prevention | All above |

### Total Estimated Effort: ~8.25 days

---

## 6. Funding-Specific Domain Adaptations

The Cancer Bot patterns need adaptation for the proposal generation context:

### 6.1 Intent → Section Type Mapping

Cancer Bot gates on user intent (RED_FLAG_URGENT, INFORMATIONAL, etc.). The Funding Bot equivalent is **section type**:

| Cancer Bot Intent | Funding Bot Section Type | Gating Behavior |
|-------------------|------------------------|-----------------|
| RED_FLAG_URGENT | budget, monitoring | Always rerank, require HIGH confidence |
| SYMPTOMATIC_PATIENT | objectives, results | Always rerank, require MEDIUM+ confidence |
| INFORMATIONAL_GENERAL | activities, beneficiaries | Conditional rerank |
| GREETING | team, cover_letter | Skip rerank |

### 6.2 Source Trust → Quality Tier Mapping

| Cancer Bot Source Priority | Funding Bot Quality Tier | Boost |
|---------------------------|-------------------------|-------|
| High (NCI, NCG, Suchi) | Tier A (vetted, citable) | 1.30x |
| Medium (IARC, PMC) | Tier B (supporting) | 1.10x |
| Low (other trusted) | Tier C (background) | 1.00x |
| Untrusted | Tier X (unreviewed) | 0.90x |

### 6.3 Query Expansion Categories

| Cancer Bot Category | Funding Bot Category | Examples |
|--------------------|--------------------|----------|
| Symptom synonyms | Outcome synonyms | "impact" → "results", "change", "improvement" |
| Treatment synonyms | Program synonyms | "KHEL" → "sports program", "physical education" |
| Medical abbreviations | Development abbreviations | "M&E" → "monitoring and evaluation" |
| Cancer type synonyms | Sector synonyms | "education" → "learning", "pedagogy", "instruction" |
| Navigation synonyms | Geography synonyms | "Bihar" → "Patna", "Bihta", "Muzaffarpur" |
| Risk factor synonyms | Need factor synonyms | "poverty" → "economic vulnerability", "marginalisation" |

### 6.4 Cross-Topic Detection → Cross-Section Evidence Sharing

Cancer Bot detects cross-cancer topics (smoking → lung + bladder + esophageal). The Funding Bot equivalent:

- **Cross-program data**: A query about "attendance" is relevant to KHEL, SPARK, and SEL sections
- **Cross-section evidence**: Budget data is relevant to both "Budget" and "Sustainability" sections
- **Implementation**: After retrieval for one section, tag chunks that are also relevant to other sections → avoid re-retrieving the same evidence

### 6.5 Evidence Gate Adaptations

Cancer Bot's evidence gate routes between "answer directly" / "hedge" / "abstain". For proposals:

| Cancer Bot Response Type | Funding Bot Behavior |
|-------------------------|---------------------|
| Answer directly (HIGH) | Write section with citations |
| Hedge (MEDIUM) | Write section with `[Note: limited evidence available]` markers |
| Ask clarifying question (LOW) | Insert `[Insert: specific data needed]` placeholders |
| Abstain (INSUFFICIENT) | Flag section for human review, provide skeleton only |

---

## 7. Estimated Impact

### 7.1 Retrieval Quality Metrics (Expected Improvement)

| Metric | Current (Estimated) | After Phase 1 | After Phase 2 | After Phase 3 |
|--------|-------------------|---------------|---------------|---------------|
| Avg top-5 similarity score | 0.45 | 0.55 (+22%) | 0.62 (+38%) | 0.65 (+44%) |
| % sections with ≥3 relevant chunks | 60% | 75% | 85% | 90% |
| Citation coverage (claims with citations) | 65% | 72% | 82% | 88% |
| Proper noun recall (program names, funder names) | 40% | 70% (+75%) | 80% (+100%) | 85% (+113%) |
| Evidence diversity (unique docs per section) | 1.8 | 2.2 | 2.8 | 3.2 |

### 7.2 Cost Impact

| Component | Per Proposal Cost |
|-----------|------------------|
| Hybrid search (FTS) | $0.00 (PostgreSQL built-in) |
| Reranking (Voyage) | ~$0.002 (10 sections × 20 chunks × ~400 tokens each) |
| Query expansion | $0.00 (rule-based, no LLM) |
| RRF fusion | $0.00 (compute-only) |
| **Total incremental cost** | **~$0.002 per proposal** |

### 7.3 Latency Impact

| Component | Added Latency |
|-----------|--------------|
| FTS (parallel with vector) | +0ms (runs in same SQL query) |
| Reranking (Voyage, gated) | +200-500ms per reranked section |
| Query expansion | +0ms (static maps) |
| RRF fusion | +5ms (in-memory) |
| **Total added latency** | **~1-3 seconds per proposal** (5-10 sections, not all reranked) |

---

## 8. Files Reference

### Cancer Bot RAG Files (Source)

| File | Lines | Key Pattern |
|------|-------|-------------|
| `apps/api/src/modules/rag/rag.service.ts` | ~1000 | Hybrid search, multi-query, cross-cancer, trust boost |
| `apps/api/src/modules/rag/query-expander.service.ts` | ~435 | Medical synonym maps, intent-gated expansion |
| `apps/api/src/modules/rag/query-decomposer.service.ts` | ~412 | Rule-based multi-intent decomposition |
| `apps/api/src/modules/rag/reranker.service.ts` | ~486 | Cross-encoder reranking (Voyage/Cohere/Jina) |
| `apps/api/src/modules/rag/cross-lingual.service.ts` | ~215 | Hindi↔English parallel query generation |
| `apps/api/src/modules/rag/retrieval-tool.service.ts` | ~327 | Retrieval-as-tool, multi-retrieval with cross-intent bonus |
| `apps/api/src/modules/evidence/evidence-gate.service.ts` | ~300+ | Evidence quality gating, confidence routing |
| `apps/api/src/modules/citation/citation.service.ts` | ~200+ | Citation extraction, orphan detection, confidence ladder |

### Funding Bot RAG Files (Target)

| File | Lines | What to Change |
|------|-------|---------------|
| `apps/funding-api/src/modules/evidence_ingest/retrieval.service.ts` | 585 | Add hybrid search, add tier boost, add retry logic |
| `apps/funding-api/src/modules/proposal/utils/retrieval-confidence.ts` | 65 | Strengthen thresholds per section type |
| `apps/funding-api/src/modules/proposal/utils/corpus-router.ts` | 62 | Add cross-section evidence sharing |
| `apps/funding-api/src/modules/proposal/services/query-generator.service.ts` | 47 | Add RRF fusion after multi-query execution |
| `apps/funding-api/src/modules/proposal/prompts/query-generator.prompt.ts` | 125 | Leverage CITATIONS_NEEDED_MAP for decomposition |
| `apps/funding-api/src/modules/evidence_ingest/embedding-provider.ts` | 135 | No changes needed |
| `apps/funding-api/src/modules/evidence_ingest/corpus.constants.ts` | 86 | No changes needed |

### New Files to Create

| File | Purpose |
|------|---------|
| `apps/funding-api/src/modules/evidence_ingest/reranker.service.ts` | Cross-encoder reranking (port from Cancer Bot) |
| `apps/funding-api/src/modules/evidence_ingest/query-expander.service.ts` | Fundraising domain synonym expansion |
| `apps/funding-api/src/modules/proposal/utils/rrf-fusion.ts` | Reciprocal Rank Fusion utility |
| `prisma/migrations/xxx_add_fts_index.sql` | GIN index for full-text search |

---

## Appendix A: Cancer Bot Patterns NOT Transferable

| Pattern | Reason Not Applicable |
|---------|----------------------|
| Cross-lingual retrieval (Hindi↔English) | Funding proposals are English-only |
| Emergency fast-path | No crisis routing needed for proposals |
| Self-harm detection | Not applicable to funding context |
| Cross-cancer topic detection | No multi-domain equivalent (single org) |
| Emotional state detection | Not applicable to document generation |
| Safe-but-Helpful abstention with helpline numbers | Proposals don't need helpline fallbacks |

## Appendix B: Shared Infrastructure Opportunities

Both bots run on the same NestJS + Prisma + PostgreSQL + pgvector stack. Opportunities for shared packages:

1. **`@suchi/reranker`**: Extract reranker service as shared package (both bots can use Voyage/Cohere/Jina)
2. **`@suchi/hybrid-search`**: Extract hybrid search SQL builder as shared utility
3. **`@suchi/rrf-fusion`**: Extract RRF fusion as shared utility
4. **`@suchi/eval-runner`**: Both bots already have parallel eval frameworks — could share the runner/report infrastructure
