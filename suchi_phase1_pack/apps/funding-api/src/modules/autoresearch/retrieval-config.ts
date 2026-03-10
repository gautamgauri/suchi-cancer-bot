/**
 * Typed retrieval configuration with all tunable knobs extracted from
 * the proposal retrieval pipeline.
 *
 * Every hardcoded constant that governs retrieval behavior is captured here.
 * The baseline defaults match the current production values exactly.
 */
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Knob classification — governs sweep policy in the mutation engine
// ---------------------------------------------------------------------------

export type KnobClass = "ranking" | "control_flow" | "cost";

export interface KnobMeta {
  class: KnobClass;
  description: string;
  sweepRange?: number[];
}

export const KNOB_METADATA: Record<keyof RetrievalConfig, KnobMeta> = {
  // RANKING — safe to sweep widely, pure math on existing result sets
  rrfK: {
    class: "ranking",
    description: "RRF constant (higher = less top-heavy)",
    sweepRange: [20, 30, 45, 60, 80, 100, 120],
  },
  multiQueryBoost: {
    class: "ranking",
    description: "Bonus per additional query that finds same chunk",
    sweepRange: [0.05, 0.10, 0.15, 0.20, 0.30],
  },
  fusedScoreWeightSimilarity: {
    class: "ranking",
    description: "Weight of max-similarity in fused score (remainder = RRF)",
    sweepRange: [0.4, 0.5, 0.6, 0.7, 0.8],
  },
  tierBoostA: {
    class: "ranking",
    description: "Score multiplier for tier-A documents",
    sweepRange: [1.00, 1.10, 1.20, 1.30, 1.40, 1.50],
  },
  tierBoostB: {
    class: "ranking",
    description: "Score multiplier for tier-B documents",
    sweepRange: [1.00, 1.05, 1.10, 1.15, 1.20],
  },
  tierBoostC: {
    class: "ranking",
    description: "Score multiplier for tier-C documents",
  },
  tierBoostX: {
    class: "ranking",
    description: "Score multiplier for tier-X (unknown) documents",
  },
  finalChunkLimit: {
    class: "ranking",
    description: "Max chunks passed to the writer after reranking",
    sweepRange: [6, 8, 10, 12, 15, 20],
  },
  maxChunksPerDoc: {
    class: "ranking",
    description: "Max chunks per single document (source diversity)",
    sweepRange: [2, 3, 4, 5, 6],
  },

  // CONTROL FLOW — narrow sweep only, changes pipeline behavior
  confidenceMinAvgScore: {
    class: "control_flow",
    description: "Min avg score for medium confidence",
    sweepRange: [0.25, 0.30, 0.35, 0.40],
  },
  confidenceHighAvgScore: {
    class: "control_flow",
    description: "Min avg score for high confidence",
    sweepRange: [0.40, 0.45, 0.50, 0.55],
  },
  confidenceMinChunks: {
    class: "control_flow",
    description: "Min chunks for high confidence",
  },
  confidenceMinDocs: {
    class: "control_flow",
    description: "Min unique docs for high confidence",
  },
  rerankerGapThreshold1vs3: {
    class: "control_flow",
    description: "Score gap threshold (top1 vs top3) to trigger reranking",
  },
  rerankerGapThreshold1vs6: {
    class: "control_flow",
    description: "Score gap threshold (top1 vs top6) to trigger reranking",
  },
  rerankerWeakTopThreshold: {
    class: "control_flow",
    description: "Min score for top result before reranking triggers",
  },
  minScoreThreshold: {
    class: "control_flow",
    description: "Min similarity score for initial retrieval",
    sweepRange: [0.15, 0.20, 0.25, 0.30],
  },
  retryMinScoreThreshold: {
    class: "control_flow",
    description: "Min similarity score for retry retrieval",
  },

  // COST — manual/capped only, affects API calls or compute
  maxSynonymsPerTerm: {
    class: "cost",
    description: "Max synonym expansions per matched term",
  },
  maxExpandedCandidates: {
    class: "cost",
    description: "Max candidate terms for synonym expansion",
  },
  queryCharLimit: {
    class: "cost",
    description: "Max expanded query character length",
  },
  overselectMultiplier: {
    class: "cost",
    description: "Multiplier for overselection before reranking",
  },
  overselectCap: {
    class: "cost",
    description: "Absolute cap on overselected chunks",
  },
  maxQueriesPerSection: {
    class: "cost",
    description: "Max queries per section after expansion",
  },
  retrievalLimitPerQuery: {
    class: "cost",
    description: "Max chunks returned per single retrieval query",
  },
};

// ---------------------------------------------------------------------------
// RetrievalConfig interface
// ---------------------------------------------------------------------------

export interface RetrievalConfig {
  // RRF (proposal.service.ts:494-549)
  rrfK: number;
  multiQueryBoost: number;
  fusedScoreWeightSimilarity: number;

  // Tier boost (proposal.service.ts:509)
  tierBoostA: number;
  tierBoostB: number;
  tierBoostC: number;
  tierBoostX: number;

  // Confidence (retrieval-confidence.ts:16-21)
  confidenceMinAvgScore: number;
  confidenceHighAvgScore: number;
  confidenceMinChunks: number;
  confidenceMinDocs: number;

  // Reranker gating (reranker.service.ts:186-191)
  rerankerGapThreshold1vs3: number;
  rerankerGapThreshold1vs6: number;
  rerankerWeakTopThreshold: number;

  // Query expansion (query-expander.service.ts)
  maxSynonymsPerTerm: number;
  maxExpandedCandidates: number;
  queryCharLimit: number;

  // Chunk limits (proposal.service.ts)
  finalChunkLimit: number;
  maxChunksPerDoc: number;
  overselectMultiplier: number;
  overselectCap: number;
  minScoreThreshold: number;
  retryMinScoreThreshold: number;
  maxQueriesPerSection: number;
  retrievalLimitPerQuery: number;
}

// ---------------------------------------------------------------------------
// Baseline — matches current production hardcoded values exactly
// ---------------------------------------------------------------------------

export const BASELINE_RETRIEVAL_CONFIG: Readonly<RetrievalConfig> = {
  // RRF
  rrfK: 60,
  multiQueryBoost: 0.15,
  fusedScoreWeightSimilarity: 0.6,

  // Tier boost
  tierBoostA: 1.30,
  tierBoostB: 1.10,
  tierBoostC: 1.00,
  tierBoostX: 0.90,

  // Confidence
  confidenceMinAvgScore: 0.35,
  confidenceHighAvgScore: 0.50,
  confidenceMinChunks: 3,
  confidenceMinDocs: 2,

  // Reranker gating
  rerankerGapThreshold1vs3: 0.04,
  rerankerGapThreshold1vs6: 0.07,
  rerankerWeakTopThreshold: 0.50,

  // Query expansion
  maxSynonymsPerTerm: 2,
  maxExpandedCandidates: 3,
  queryCharLimit: 500,

  // Chunk limits
  finalChunkLimit: 12,
  maxChunksPerDoc: 4,
  overselectMultiplier: 5,
  overselectCap: 20,
  minScoreThreshold: 0.25,
  retryMinScoreThreshold: 0.20,
  maxQueriesPerSection: 8,
  retrievalLimitPerQuery: 5,
};

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Merge a partial delta onto a baseline config. */
export function mergeRetrievalConfig(
  baseline: RetrievalConfig,
  delta: Partial<RetrievalConfig>,
): RetrievalConfig {
  return { ...baseline, ...delta };
}

/** Return only the keys that differ between two configs. */
export function diffRetrievalConfig(
  a: RetrievalConfig,
  b: RetrievalConfig,
): Partial<RetrievalConfig> {
  const diff: Partial<RetrievalConfig> = {};
  for (const key of Object.keys(a) as Array<keyof RetrievalConfig>) {
    if (a[key] !== b[key]) {
      (diff as Record<string, number>)[key] = b[key];
    }
  }
  return diff;
}

/** Deterministic SHA-256 hash of a config (for dedup). */
export function configHash(config: RetrievalConfig): string {
  const sorted = JSON.stringify(config, Object.keys(config).sort());
  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

/** Build the tier boost map from config values. */
export function buildTierBoostMap(config: RetrievalConfig): Record<string, number> {
  return {
    A: config.tierBoostA,
    B: config.tierBoostB,
    C: config.tierBoostC,
    X: config.tierBoostX,
  };
}
