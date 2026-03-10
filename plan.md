# Autoresearch Slice 1: Retrieval Config Tuning — Suchi Cancer Bot

## Context

The Suchi Cancer Bot's retrieval pipeline has ~25 hardcoded constants across 5 files (hybrid search weights, trusted-source boosts, reranker gating thresholds, multi-query boost, topK limits, evidence gate scores, etc.). These were set by intuition, never systematically optimized. Retrieval quality directly gates answer quality — `insufficient` evidence and weak confidence are the top failure modes in eval reports. There is no infrastructure for A/B experiments, variant tracking, or promotion.

**Goal:** Build a benchmark-driven system that tunes retrieval config under safety constraints. Config mutations first, not code mutations. Interpretable, auditable, and safe — critical for a medical information bot.

**Not in scope:** Multi-agent topology, code mutations, LLM prompt optimization, live delivery changes, safety module changes.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ RetrievalConfig (typed, all ~25 knobs)                  │
│   ↓ baseline OR variant override                        │
│ ┌─────────────────┐  ┌──────────────────┐               │
│ │ Mutation Engine  │→│ Benchmark Runner │               │
│ │ (rule-based)     │  │ (retrieval-only) │               │
│ └─────────────────┘  └────────┬─────────┘               │
│                               ↓                         │
│                    ┌──────────────────┐                  │
│                    │ Comparison Report│                  │
│                    │ + Promotion Logic│                  │
│                    └──────────────────┘                  │
│                               ↓                         │
│              accept / reject / hold → DB                │
└─────────────────────────────────────────────────────────┘
```

---

## Step 1: RetrievalConfig Type + Knob Classification

**New file:** `apps/api/src/modules/autoresearch/retrieval-config.ts`

Extracts every hardcoded constant into a typed config with baseline defaults. Each knob is classified:

```typescript
// Knob classification — governs sweep policy
type KnobClass = "ranking" | "control_flow" | "cost" | "safety";

export const KNOB_METADATA: Record<keyof RetrievalConfig, { class: KnobClass; sweepRange?: number[] }> = {
  // RANKING — safe to sweep widely, pure math on existing result sets
  hybridWeightVecLong:         { class: "ranking", sweepRange: [0.45, 0.50, 0.55, 0.60, 0.65, 0.70] },
  hybridWeightVecShort:        { class: "ranking", sweepRange: [0.70, 0.75, 0.80, 0.85, 0.90] },
  shortQueryMaxTokens:         { class: "ranking", sweepRange: [4, 5, 6, 7, 8] },
  multiQueryBoost:             { class: "ranking", sweepRange: [0.05, 0.08, 0.10, 0.15, 0.20] },
  crossIntentBoost:            { class: "ranking", sweepRange: [0.10, 0.15, 0.20, 0.25] },
  trustedSourceBoostHigh:      { class: "ranking", sweepRange: [1.25, 1.35, 1.50, 1.60, 1.75] },
  trustedSourceBoostMedium:    { class: "ranking", sweepRange: [1.10, 1.20, 1.25, 1.35] },
  trustedSourceBoostLow:       { class: "ranking", sweepRange: [1.00, 1.05, 1.10, 1.15] },
  untrustedSourcePenalty:      { class: "ranking", sweepRange: [0.85, 0.90, 0.95, 1.00] },

  // CONTROL FLOW — narrow sweep only, changes pipeline behavior
  rerankerGapThreshold3:       { class: "control_flow", sweepRange: [0.03, 0.04, 0.05, 0.06] },
  rerankerGapThreshold6:       { class: "control_flow", sweepRange: [0.05, 0.06, 0.07, 0.08, 0.10] },
  rerankerWeakTopThreshold:    { class: "control_flow", sweepRange: [0.55, 0.60, 0.62, 0.65, 0.70] },
  rerankerLowLexicalThreshold: { class: "control_flow", sweepRange: [0.35, 0.40, 0.45, 0.50] },
  rerankerClusteredThreshold:  { class: "control_flow", sweepRange: [0.04, 0.05, 0.06, 0.07] },
  rerankerSlamDunkLexical:     { class: "control_flow" },
  rerankerSlamDunkGap3:        { class: "control_flow" },
  rerankerSlamDunkGap6:        { class: "control_flow" },
  rerankerSlamDunkH1:          { class: "control_flow" },
  rerankerSlamDunkV1:          { class: "control_flow" },

  // COST — manual/capped only, affects API calls or compute
  topKDefault:                 { class: "cost", sweepRange: [4, 5, 6, 8, 10] },
  retrieveMultiplier:          { class: "cost" },
  multiQueryMaxVariations:     { class: "cost", sweepRange: [2, 3, 4, 5] },
  multiRetrieveMaxTotal:       { class: "cost" },
  synonymExpansionLimit:       { class: "cost" },
  rerankerMaxChars:            { class: "cost" },
  rerankerTimeoutMs:           { class: "cost" },
  rerankerMaxCandidateMultiplier: { class: "cost" },
  retrieveWithExpansionMinChunks: { class: "control_flow" },
  retrieveWithExpansionMaxRetries: { class: "control_flow" },

  // SAFETY — NEVER auto-sweep, manual review only
  // These thresholds gate whether the bot responds at all (medical safety)
  evidenceStrongMatchScore:    { class: "safety" },
  evidenceVeryWeakScore:       { class: "safety" },
  evidenceMinPassagesTreatment:{ class: "safety" },
  evidenceMinSourcesTreatment: { class: "safety" },
  evidenceGoodSimilarityScore: { class: "safety" },
};

export interface RetrievalConfig {
  // === Hybrid Search Weights (rag.service.ts:771-772) ===
  hybridWeightVecLong: number;         // 0.55  — vector weight for long queries (>6 tokens)
  hybridWeightVecShort: number;        // 0.80  — vector weight for short queries (≤6 tokens)
  shortQueryMaxTokens: number;         // 6     — token count threshold for "short" query

  // === Multi-Query Retrieval (rag.service.ts:160-165) ===
  multiQueryBoost: number;             // 0.10  — bonus per additional query hit (RRF-lite)
  multiQueryMaxVariations: number;     // 3     — max query variations to search

  // === Cross-Intent Boost (retrieval-tool.service.ts:219) ===
  crossIntentBoost: number;            // 0.15  — bonus for chunks found across multiple intents

  // === Trusted Source Reranking (rag.service.ts:930-948) ===
  trustedSourceBoostHigh: number;      // 1.50  — multiplier for high-priority trusted sources
  trustedSourceBoostMedium: number;    // 1.25  — multiplier for medium-priority trusted sources
  trustedSourceBoostLow: number;       // 1.10  — multiplier for low-priority trusted sources
  untrustedSourcePenalty: number;      // 0.95  — multiplier for untrusted sources

  // === Reranker Gating (reranker.service.ts:115-173) ===
  rerankerGapThreshold3: number;       // 0.04  — top-1 vs top-3 score gap to trigger reranking
  rerankerGapThreshold6: number;       // 0.07  — top-1 vs top-6 score gap to trigger reranking
  rerankerWeakTopThreshold: number;    // 0.62  — h1 score below which reranking triggers
  rerankerLowLexicalThreshold: number; // 0.45  — l1 below which reranking triggers
  rerankerClusteredThreshold: number;  // 0.05  — gap6 below which "clustered results" triggers reranking
  // Slam-dunk thresholds (skip reranking when scores are clearly strong)
  rerankerSlamDunkLexical: number;     // 0.85
  rerankerSlamDunkGap3: number;        // 0.12
  rerankerSlamDunkGap6: number;        // 0.18
  rerankerSlamDunkH1: number;          // 0.75
  rerankerSlamDunkV1: number;          // 0.72
  // Low-stakes intent weak retrieval thresholds
  rerankerLowIntentWeakH1: number;     // 0.55
  rerankerLowIntentWeakL1: number;     // 0.40

  // === Retrieval Limits (rag.service.ts, retrieval-tool.service.ts) ===
  topKDefault: number;                 // 6     — default topK for single retrieval
  retrieveMultiplier: number;          // 2     — retrieve topK*N for reranking buffer
  multiRetrieveMaxTotal: number;       // 15    — cap on total chunks from multi-retrieve
  synonymExpansionLimit: number;       // 2     — max synonyms per matched term (query-expander)

  // === Reranker Cost Controls (reranker.service.ts) ===
  rerankerMaxChars: number;            // 1600  — max chars per document sent to reranker
  rerankerTimeoutMs: number;           // 8000  — timeout for reranker API calls
  rerankerMaxCandidateMultiplier: number; // 3  — pass topK*N candidates to reranker

  // === Retrieval Expansion (rag.service.ts:453-514) ===
  retrieveWithExpansionMinChunks: number; // 3  — min chunks before considering expansion
  retrieveWithExpansionMaxRetries: number; // 2 — max retry attempts with expanded queries

  // === Evidence Gate Thresholds (evidence-gate.service.ts) — SAFETY CLASS ===
  evidenceStrongMatchScore: number;    // 0.70  — gateScore above which match is "strong"
  evidenceVeryWeakScore: number;       // 0.30  — avgGateScore below which evidence is "very weak"
  evidenceGoodSimilarityScore: number; // 0.50  — avgGateScore above which quality = "strong"
  evidenceMinPassagesTreatment: number;// 2     — min passages for treatment queries
  evidenceMinSourcesTreatment: number; // 2     — min unique sources for treatment queries
}

export const BASELINE_RETRIEVAL_CONFIG: RetrievalConfig = { /* all defaults above */ };
export function mergeRetrievalConfig(baseline: RetrievalConfig, delta: Partial<RetrievalConfig>): RetrievalConfig { ... }
export function diffRetrievalConfig(a: RetrievalConfig, b: RetrievalConfig): Partial<RetrievalConfig> { ... }
export function configHash(config: RetrievalConfig): string { /* sha256 of sorted JSON */ }
```

**Sweep policy rules** (enforced by mutation engine):
- `ranking` knobs: auto-sweep with sweepRange if defined
- `control_flow` knobs: auto-sweep only if sweepRange defined, narrower ranges
- `cost` knobs: manual variant creation only, no auto-sweep
- `safety` knobs: NEVER auto-sweep — manual review required, changes must be approved by clinical team

---

## Step 2: Refactor Consumers (Zero Behavioral Change)

Add optional `config?: RetrievalConfig` param to functions that currently use hardcoded constants. Default = `BASELINE_RETRIEVAL_CONFIG`. Existing callers unchanged.

| File | Change |
|------|--------|
| `modules/rag/rag.service.ts` | `hybridSearchWithMetadata()` — accept config param, use `config.hybridWeightVecLong`, `config.hybridWeightVecShort`, `config.shortQueryMaxTokens` instead of hardcoded 0.55/0.80/6. `multiQueryRetrieve()` — use `config.multiQueryBoost`, `config.multiQueryMaxVariations`. `vectorSearchWithMetadata()` — use `config.retrieveMultiplier`. `rerankByTrustedSource()` — use `config.trustedSourceBoostHigh/Medium/Low`, `config.untrustedSourcePenalty` instead of hardcoded 1.50/1.25/1.10/0.95. `retrieveWithExpansion()` — use `config.retrieveWithExpansionMinChunks/MaxRetries` |
| `modules/rag/reranker.service.ts` | `shouldRerank()` — accept config param for all gating thresholds (gap3, gap6, weakTop, lowLexical, clustered, slamDunk*). `rerank()` — use `config.rerankerMaxChars` for truncation |
| `modules/rag/query-expander.service.ts` | `expandTerms()` — accept config param for `config.synonymExpansionLimit` (currently hardcoded `slice(0, 2)`) |
| `modules/rag/retrieval-tool.service.ts` | `multiRetrieve()` — use `config.crossIntentBoost` instead of hardcoded 0.15, `config.multiRetrieveMaxTotal` instead of 15 |
| `modules/evidence/evidence-gate.service.ts` | `hasStrongMatches()` — use `config.evidenceStrongMatchScore` instead of 0.7. `validateEvidence()` — use `config.evidenceVeryWeakScore`, `config.evidenceGoodSimilarityScore` |

**Key constraint:** Production path still uses `BASELINE_RETRIEVAL_CONFIG` everywhere. A parity test asserts identical behavior (snapshot comparison of retrieval results for 5 known queries).

---

## Step 3: Parity Tests

Before building the benchmark runner, write snapshot tests proving the refactor in Step 2 is zero-change.

**New file:** `apps/api/src/modules/autoresearch/retrieval-config.spec.ts`

- 5 known queries (one per query type: treatment, symptoms, navigation, caregiver, general)
- For each: call the refactored retrieval path with `BASELINE_RETRIEVAL_CONFIG` and compare output chunk IDs + scores against a pre-recorded snapshot from the current hardcoded path
- Test passes only if chunk IDs and ordering are identical

This gates Step 4 — if parity breaks, the refactor introduced a bug.

---

## Step 4: Benchmark Query Set (Stratified)

**New file:** `apps/api/src/modules/autoresearch/benchmark-sets/gold-retrieval-v1.json`

Bootstrap 25-30 queries from existing eval test cases + real user sessions, stratified into 4 slices:

| Slice | Count | Source | Purpose |
|-------|-------|--------|---------|
| `easy_win` | 6-8 | Queries where evidence quality = "strong", score > 0.6 | Guardrail — must not regress |
| `borderline` | 6-8 | Queries where evidence quality = "weak", score 0.30-0.50 | Optimization target — most room to improve |
| `known_failure` | 5-6 | Queries where bot abstained or returned 0 citations | Hard cases — improvement here is real signal |
| `cross_lingual` | 5-6 | Hindi/Hinglish queries, mixed-language inputs | Tests cross-lingual retrieval effectiveness |

Each query:
```json
{
  "id": "q-treatment-breast",
  "query": "What is the treatment for stage 2 breast cancer?",
  "queryType": "treatment",
  "intent": "INFORMATIONAL_GENERAL",
  "cancerType": "breast",
  "slice": "easy_win",
  "expectedDocIds": ["<harvested-from-successful-eval-runs>"],
  "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks"]
}
```

Cover: treatment, symptoms, screening, prevention, side effects, navigation, caregiver, psychosocial query types. Include Hindi queries ("फेफड़ों के कैंसर के लक्षण क्या हैं?") and Hinglish queries ("lung cancer ka ilaaj kaise hota hai").

---

## Step 5: Benchmark Runner

**New file:** `apps/api/src/modules/autoresearch/retrieval-benchmark.service.ts`

Runs retrieval-only benchmarks (no LLM answer generation, no reranker API calls unless testing reranker variants).

Per variant, per query:
1. Run query expansion with config params (synonym expansion limit)
2. Run cross-lingual parallel query generation
3. Run hybrid search with config's vec/lex weights, short-query threshold
4. Apply multi-query merging with config's boost
5. Apply trusted-source reranking with config's boost values
6. Compute reranker gating decision with config thresholds (don't call API)
7. Apply evidence gate with config's strong match/weak thresholds
8. If expectedDocIds provided, compute recall@K

Metrics computed per run (aggregate):
- `utilityScore` — primary metric (composite, see Step 8)
- `recallAtK` (if gold labels exist)
- `avgScore`, `medianScore`
- `avgChunksRetrieved`, `avgUniqueDocCount`
- `trustedSourceFraction` — fraction of top-K from trusted sources
- `avgConfidenceLevel` — evidence gate confidence (low=0, medium=0.5, high=1)
- `p50LatencyMs`, `p95LatencyMs`
- `rerankerTriggerRate` — fraction where gating says "yes"
- `abstentionRate` — fraction where evidence gate would abstain

Per-slice metrics (stored in `sliceMetrics` JSON on BenchmarkRun):
- Same metrics as above, computed independently for each slice
- Enables per-slice non-regression checks in promotion logic

Writes BenchmarkRun + MetricSnapshot rows to DB.

---

## Step 6: Prisma Schema — Experiment Tracking

**File:** `apps/api/prisma/schema.prisma` (append)

4 new models (additive, no ALTER on existing tables):

```prisma
model Experiment {
  id              String    @id @default(uuid())
  name            String                         // "hybrid-weight-sweep-2026-03"
  hypothesis      String    @db.Text
  targetDomain    String    @default("retrieval") // retrieval | evidence_gate | reranker
  status          String    @default("active")    // active | concluded | abandoned
  baselineConfig  Json                            // RetrievalConfig snapshot
  // Provenance
  benchmarkSetVersion String @default("gold-retrieval-v1")
  codeSha         String?                         // git SHA at experiment creation
  createdBy       String    @default("cli")       // "cli" | "api" | user identifier
  conclusion      String?   @db.Text
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  concludedAt     DateTime?
  variants        ExperimentVariant[]
  @@index([status])
  @@index([targetDomain])
}

model ExperimentVariant {
  id              String    @id @default(uuid())
  experimentId    String
  variantLabel    String                          // "hybridWeightVecLong=0.65", "baseline"
  isBaseline      Boolean   @default(false)       // auto-created shadow baseline row
  configDelta     Json                            // partial RetrievalConfig ({} for baseline)
  resolvedConfig  Json                            // full merged config
  configHash      String                          // sha256 of resolvedConfig — dedup key
  mutationSource  String    @default("manual")    // manual | rule_sweep
  status          String    @default("pending")   // pending|running|scored|promoted|rejected|hold
  promotionNote   String?   @db.Text
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  experiment      Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)
  benchmarkRuns   BenchmarkRun[]
  @@unique([experimentId, variantLabel])
  @@index([experimentId])
  @@index([status])
  @@index([configHash])
}

model BenchmarkRun {
  id              String    @id @default(uuid())
  variantId       String
  benchmarkSetId  String                          // "gold-retrieval-v1"
  benchmarkSetVersion String @default("v1")
  queryCount      Int
  status          String    @default("running")   // running | complete | failed
  // Provenance
  codeSha         String?
  apiVersion      String?
  corpusSnapshotAt DateTime?                      // timestamp of corpus state
  sliceMetrics    Json?                           // { "easy_win": { recallAtK: 0.9, ... }, ... }
  startedAt       DateTime  @default(now())
  completedAt     DateTime?
  durationMs      Int?
  errorMessage    String?   @db.Text
  variant         ExperimentVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  metrics         MetricSnapshot[]
  @@index([variantId])
  @@index([benchmarkSetId])
}

model MetricSnapshot {
  id              String    @id @default(uuid())
  benchmarkRunId  String
  metricName      String                          // "utilityScore", "recallAtK", "abstentionRate"
  metricValue     Float
  perQueryValues  Json?                           // { "q-treatment-breast": 0.85, ... }
  createdAt       DateTime  @default(now())
  benchmarkRun    BenchmarkRun @relation(fields: [benchmarkRunId], references: [id], onDelete: Cascade)
  @@index([benchmarkRunId])
  @@index([metricName])
}
```

**Baseline shadow row:** When an experiment is created, the system auto-creates a variant with `isBaseline: true`, `variantLabel: "baseline"`, `configDelta: {}`, `resolvedConfig: baselineConfig`. Every experiment always has a baseline to compare against.

---

## Step 7: Mutation Engine

**New file:** `apps/api/src/modules/autoresearch/mutation-engine.ts`

Rule-based only (no LLM). Respects knob classification from `KNOB_METADATA`:

**`single_knob_sweep`:** Auto-generate variants from sweepRange in metadata
- Only `ranking` and `control_flow` knobs with defined sweepRange
- `cost` knobs blocked from auto-sweep (must be manual)
- `safety` knobs blocked entirely from auto-sweep (medical safety)

**`paired_knob`:** Two related knobs together (ranking class only)
- `hybridWeightVecLong` + `hybridWeightVecShort` (search blend)
- `trustedSourceBoostHigh` + `trustedSourceBoostMedium` (source priority)
- `rerankerGapThreshold3` + `rerankerGapThreshold6` (score ambiguity)

**`profile`:** Named config packages (any class, manually curated)
- `"semantic_heavy"`: hybridWeightVecLong=0.70, hybridWeightVecShort=0.90 — favor vector search
- `"lexical_heavy"`: hybridWeightVecLong=0.40, hybridWeightVecShort=0.60 — favor FTS
- `"aggressive_trust"`: trustedSourceBoostHigh=1.75, untrustedSourcePenalty=0.85 — strongly prefer NCI/WHO
- `"rerank_more"`: rerankerWeakTopThreshold=0.70, rerankerGapThreshold6=0.10 — trigger reranker more often
- `"rerank_less"`: rerankerWeakTopThreshold=0.50, rerankerGapThreshold3=0.02 — skip reranker more often

Each strategy auto-includes a baseline variant row (deduped by configHash).

---

## Step 8: Comparison Report + Promotion Logic

**New files:**
- `apps/api/src/modules/autoresearch/comparison-report.ts`
- `apps/api/src/modules/autoresearch/promotion-logic.ts`

**Primary metric:** `utilityScore` (composite, not a raw retrieval score):
```
utilityScore = 0.40 * recallAtK
             + 0.25 * avgScore
             + 0.20 * trustedSourceFraction
             + 0.10 * (1 - abstentionRate)
             + 0.05 * (1 - rerankerTriggerRate)
```
Weights are constants in `promotion-logic.ts`, easily adjustable.

**Promotion rules:**
1. **Minimum case coverage:** variant must have been benchmarked on ≥ 30% of queries in each slice. Insufficient coverage → `hold` (not enough data).
2. **Aggregate gate:** utilityScore improves ≥ 3% over baseline AND no guardrail regresses > 2%.
   - Guardrail metrics: `recallAtK`, `avgScore`, `trustedSourceFraction`
3. **Per-slice non-regression:** For each slice (easy_win, borderline, known_failure, cross_lingual), the slice's recallAtK must not drop by more than 5% vs baseline. A variant that lifts borderline by 20% but drops easy_win by 10% is rejected.
4. **Safety gate (CRITICAL):** If any safety-class knob is changed, variant requires manual approval flag regardless of metric improvement. No auto-promotion for safety knobs.
5. **Hold zone:** aggregate improvement exists but < 1% (noise).
6. **Reject:** no improvement or any guardrail/slice violation.

No automatic deployment in Slice 1. Promoted config is printed for human review and manual copy to `BASELINE_RETRIEVAL_CONFIG`.

---

## Step 9: NestJS Module + API

**New module:** `apps/api/src/modules/autoresearch/`

```
autoresearch/
  autoresearch.module.ts
  autoresearch.controller.ts
  retrieval-config.ts
  retrieval-config.spec.ts        ← parity tests (Step 3)
  retrieval-benchmark.service.ts
  mutation-engine.ts
  comparison-report.ts
  promotion-logic.ts
  benchmark-sets/
    gold-retrieval-v1.json
```

Endpoints:
- `POST /v1/autoresearch/experiments` — create experiment (auto-creates baseline variant)
- `POST /v1/autoresearch/experiments/:id/generate-variants` — auto-generate variants (respects knob class)
- `POST /v1/autoresearch/benchmark` — run benchmark for a variant
- `GET /v1/autoresearch/experiments/:id/report` — comparison report (includes per-slice breakdown)
- `POST /v1/autoresearch/experiments/:id/promote/:variantId` — mark promoted (blocked for safety knobs without manual flag)

---

## Implementation Order

1. **Config type + knob metadata** — `retrieval-config.ts` with interface, baseline, classification, hash
2. **Refactor consumers** — Add optional config param to 5 files, zero behavioral change
3. **Parity tests** — Snapshot tests proving refactor is zero-change (gates all subsequent steps)
4. **Benchmark query set** — Harvest 25-30 stratified queries from existing eval cases + session data
5. **Benchmark runner** — `retrieval-benchmark.service.ts` with per-slice metrics
6. **Comparison report** — Report generation with per-slice breakdown
7. **Prisma schema + migrate** — 4 models with provenance fields, auto-baseline
8. **Mutation engine** — Variant generation respecting knob class (with safety class block)
9. **Promotion logic** — Composite utility score, case coverage gate, per-slice non-regression, safety gate
10. **Module + API** — Controller, wire DI, register module
11. **First experiment** — Hybrid weight sweep, benchmark all variants, review report

---

## Critical Files

| Purpose | Path |
|---------|------|
| Hybrid search + trusted-source reranking + multi-query | `modules/rag/rag.service.ts` |
| Reranker gating thresholds | `modules/rag/reranker.service.ts` |
| Query expansion (synonym limits) | `modules/rag/query-expander.service.ts` |
| Cross-intent boost + multi-retrieve cap | `modules/rag/retrieval-tool.service.ts` |
| Evidence gate (strong/weak/abstention) | `modules/evidence/evidence-gate.service.ts` |
| Trusted source config | `config/trusted-sources.config.ts` |
| Cross-lingual retrieval | `modules/rag/cross-lingual.service.ts` |
| Query decomposer | `modules/rag/query-decomposer.service.ts` |
| Prisma schema | `apps/api/prisma/schema.prisma` |
| Eval CLI | `eval/cli.ts` |

---

## All Hardcoded Constants (Inventory)

| Constant | File:Line | Value | Config Key |
|----------|-----------|-------|------------|
| Vector weight (long query) | rag.service.ts:771 | 0.55 | `hybridWeightVecLong` |
| Vector weight (short query) | rag.service.ts:771 | 0.80 | `hybridWeightVecShort` |
| Lexical weight (long query) | rag.service.ts:772 | 0.45 | derived (1 - vec) |
| Lexical weight (short query) | rag.service.ts:772 | 0.20 | derived (1 - vec) |
| Short query token threshold | rag.service.ts:770 | 6 | `shortQueryMaxTokens` |
| Multi-query boost | rag.service.ts:164 | 0.10 | `multiQueryBoost` |
| Multi-query max variations | rag.service.ts:74 | 3 | `multiQueryMaxVariations` |
| Trusted boost high | rag.service.ts:932 | 1.50 | `trustedSourceBoostHigh` |
| Trusted boost medium | rag.service.ts:935 | 1.25 | `trustedSourceBoostMedium` |
| Trusted boost low | rag.service.ts:938 | 1.10 | `trustedSourceBoostLow` |
| Untrusted penalty | rag.service.ts:947 | 0.95 | `untrustedSourcePenalty` |
| Reranker gap3 threshold | reranker.service.ts:152 | 0.04 | `rerankerGapThreshold3` |
| Reranker gap6 threshold | reranker.service.ts:152 | 0.07 | `rerankerGapThreshold6` |
| Reranker weak top (h1) | reranker.service.ts:157 | 0.62 | `rerankerWeakTopThreshold` |
| Reranker low lexical (l1) | reranker.service.ts:163 | 0.45 | `rerankerLowLexicalThreshold` |
| Reranker clustered (gap6) | reranker.service.ts:167 | 0.05 | `rerankerClusteredThreshold` |
| Slam dunk lexical | reranker.service.ts:135 | 0.85 | `rerankerSlamDunkLexical` |
| Slam dunk gap3 | reranker.service.ts:135 | 0.12 | `rerankerSlamDunkGap3` |
| Slam dunk gap6 | reranker.service.ts:135 | 0.18 | `rerankerSlamDunkGap6` |
| Slam dunk h1 | reranker.service.ts:135 | 0.75 | `rerankerSlamDunkH1` |
| Slam dunk v1 | reranker.service.ts:135 | 0.72 | `rerankerSlamDunkV1` |
| Low intent weak h1 | reranker.service.ts:142 | 0.55 | `rerankerLowIntentWeakH1` |
| Low intent weak l1 | reranker.service.ts:142 | 0.40 | `rerankerLowIntentWeakL1` |
| Default topK | rag.service.ts:31 | 6 | `topKDefault` |
| Retrieve multiplier | rag.service.ts:556 | 2 | `retrieveMultiplier` |
| Cross-intent boost | retrieval-tool.service.ts:219 | 0.15 | `crossIntentBoost` |
| Multi-retrieve max total | retrieval-tool.service.ts:227 | 15 | `multiRetrieveMaxTotal` |
| Synonym expansion limit | query-expander.service.ts:368 | 2 | `synonymExpansionLimit` |
| Reranker max chars | reranker.service.ts:241 | 1600 | `rerankerMaxChars` |
| Reranker timeout | reranker.service.ts:49 | 8000 | `rerankerTimeoutMs` |
| Reranker candidate multiplier | rag.service.ts:799 | 3 | `rerankerMaxCandidateMultiplier` |
| Expansion min chunks | rag.service.ts:457 | 3 | `retrieveWithExpansionMinChunks` |
| Expansion max retries | rag.service.ts:458 | 2 | `retrieveWithExpansionMaxRetries` |
| Strong match score | evidence-gate.service.ts:84 | 0.70 | `evidenceStrongMatchScore` |
| Very weak score | evidence-gate.service.ts:234 | 0.30 | `evidenceVeryWeakScore` |
| Good similarity score | evidence-gate.service.ts:280 | 0.50 | `evidenceGoodSimilarityScore` |
| Min passages (treatment) | trusted-sources.config.ts:67 | 2 | `evidenceMinPassagesTreatment` |
| Min sources (treatment) | trusted-sources.config.ts:68 | 2 | `evidenceMinSourcesTreatment` |

---

## Verification

```bash
# 1. Build compiles
cd apps/api && npm run build

# 2. Baseline parity test: BASELINE_RETRIEVAL_CONFIG produces identical
#    retrieval results to current hardcoded constants
npx jest --testPathPattern=retrieval-config

# 3. End-to-end: create experiment, generate variants, run benchmark, get report
curl -X POST .../v1/autoresearch/experiments \
  -d '{"name":"hybrid-weight-sweep","hypothesis":"Higher vector weight improves recall for cancer queries","targetDomain":"retrieval"}'
curl -X POST .../v1/autoresearch/experiments/<id>/generate-variants \
  -d '{"strategy":"single_knob_sweep","knob":"hybridWeightVecLong"}'
curl -X POST .../v1/autoresearch/benchmark \
  -d '{"variantId":"<baseline-id>","benchmarkSetId":"gold-retrieval-v1"}'
# repeat for each variant
curl .../v1/autoresearch/experiments/<id>/report

# 4. Existing chat unchanged (regression check)
cd eval && npx ts-node cli.ts run --cases cases/tier1/common_cancers_20_mode_matrix.yaml --summary

# 5. Safety check: verify safety-class knobs cannot be auto-swept
curl -X POST .../v1/autoresearch/experiments/<id>/generate-variants \
  -d '{"strategy":"single_knob_sweep","knob":"evidenceStrongMatchScore"}'
# → Should return 400: "Safety-class knobs cannot be auto-swept"
```

---

## Safety Considerations (Medical Bot Specific)

This is a **medical information bot**. Unlike the funding bot, incorrect retrieval can lead to:
1. **Missed urgent information** — patient misses warning signs
2. **Wrong treatment info surfaced** — wrong cancer type matched
3. **Trusted source demotion** — NCI/WHO content ranked below untrusted sources
4. **Abstention regression** — bot answers when it should abstain (safety)

Therefore:
- Evidence gate thresholds (`safety` class) are **NEVER** auto-swept
- Any config change that increases abstention rate by >5% is auto-rejected (patient experience)
- Any config change that decreases `trustedSourceFraction` by >3% is auto-rejected (source quality)
- Cross-lingual slice ensures Hindi/Hinglish users aren't degraded
- All experiments log `codeSha` + `corpusSnapshotAt` for reproducibility
