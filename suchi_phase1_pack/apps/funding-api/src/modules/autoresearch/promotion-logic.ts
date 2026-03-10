/**
 * Promotion logic for autoresearch experiments.
 *
 * Determines whether a variant should be promoted, rejected, or held
 * based on utility score improvement and guardrail checks.
 *
 * No automatic deployment — promoted config is flagged for human review.
 */
import { BenchmarkMetrics, SliceMetrics, BenchmarkSlice } from "./retrieval-benchmark.service";

// ---------------------------------------------------------------------------
// Utility score weights (easily adjustable)
// ---------------------------------------------------------------------------

export const UTILITY_WEIGHTS = {
  recallAtK: 0.50,
  avgScore: 0.25,
  tierAFraction: 0.15,
  rerankerPenalty: 0.10, // 1 - rerankerTriggerRate
} as const;

export function computeUtilityScore(m: BenchmarkMetrics): number {
  return (
    UTILITY_WEIGHTS.recallAtK * m.recallAtK +
    UTILITY_WEIGHTS.avgScore * m.avgScore +
    UTILITY_WEIGHTS.tierAFraction * m.tierAFraction +
    UTILITY_WEIGHTS.rerankerPenalty * (1 - m.rerankerTriggerRate)
  );
}

// ---------------------------------------------------------------------------
// Promotion thresholds
// ---------------------------------------------------------------------------

const THRESHOLDS = {
  /** Minimum utility improvement to promote (3%). */
  minUtilityImprovement: 0.03,
  /** Hold zone: improvement exists but < 1% (noise). */
  holdZoneThreshold: 0.01,
  /** Max allowed regression on any guardrail metric (2%). */
  maxGuardrailRegression: 0.02,
  /** Max allowed per-slice recall regression (5%). */
  maxSliceRecallRegression: 0.05,
  /** Minimum fraction of queries per slice that must be benchmarked (30%). */
  minSliceCoverage: 0.30,
} as const;

// ---------------------------------------------------------------------------
// Promotion decision types
// ---------------------------------------------------------------------------

export type PromotionDecision = "promote" | "reject" | "hold";

export interface PromotionResult {
  decision: PromotionDecision;
  utilityDelta: number;
  reasons: string[];
  guardrailViolations: string[];
  sliceViolations: string[];
}

// ---------------------------------------------------------------------------
// Evaluate promotion
// ---------------------------------------------------------------------------

export function evaluatePromotion(
  baselineMetrics: BenchmarkMetrics,
  variantMetrics: BenchmarkMetrics,
  baselineSliceMetrics: SliceMetrics | null,
  variantSliceMetrics: SliceMetrics | null,
  queryCountPerSlice?: Record<BenchmarkSlice, { total: number; benchmarked: number }>,
): PromotionResult {
  const reasons: string[] = [];
  const guardrailViolations: string[] = [];
  const sliceViolations: string[] = [];

  const baselineUtility = computeUtilityScore(baselineMetrics);
  const variantUtility = computeUtilityScore(variantMetrics);
  const utilityDelta = variantUtility - baselineUtility;

  // 1. Minimum case coverage check
  if (queryCountPerSlice) {
    for (const [slice, counts] of Object.entries(queryCountPerSlice)) {
      if (counts.total > 0 && counts.benchmarked / counts.total < THRESHOLDS.minSliceCoverage) {
        return {
          decision: "hold",
          utilityDelta,
          reasons: [`Insufficient coverage for slice "${slice}": ${counts.benchmarked}/${counts.total} (need ${THRESHOLDS.minSliceCoverage * 100}%)`],
          guardrailViolations: [],
          sliceViolations: [],
        };
      }
    }
  }

  // 2. Guardrail checks (recallAtK, avgScore, tierAFraction must not regress > 2%)
  const guardrails: Array<{ name: string; baseline: number; variant: number }> = [
    { name: "recallAtK", baseline: baselineMetrics.recallAtK, variant: variantMetrics.recallAtK },
    { name: "avgScore", baseline: baselineMetrics.avgScore, variant: variantMetrics.avgScore },
    { name: "tierAFraction", baseline: baselineMetrics.tierAFraction, variant: variantMetrics.tierAFraction },
  ];

  for (const g of guardrails) {
    const regression = g.baseline - g.variant;
    if (regression > THRESHOLDS.maxGuardrailRegression) {
      guardrailViolations.push(
        `${g.name} regressed: ${g.baseline.toFixed(3)} → ${g.variant.toFixed(3)} (Δ=${(-regression).toFixed(3)}, limit=-${THRESHOLDS.maxGuardrailRegression})`,
      );
    }
  }

  // 3. Per-slice non-regression
  if (baselineSliceMetrics && variantSliceMetrics) {
    for (const slice of ["easy_win", "borderline", "known_failure", "proper_noun"] as BenchmarkSlice[]) {
      const baseSlice = baselineSliceMetrics[slice];
      const varSlice = variantSliceMetrics[slice];
      if (baseSlice && varSlice) {
        const recallDrop = baseSlice.recallAtK - varSlice.recallAtK;
        if (recallDrop > THRESHOLDS.maxSliceRecallRegression) {
          sliceViolations.push(
            `Slice "${slice}" recall dropped: ${baseSlice.recallAtK.toFixed(3)} → ${varSlice.recallAtK.toFixed(3)} (Δ=${(-recallDrop).toFixed(3)}, limit=-${THRESHOLDS.maxSliceRecallRegression})`,
          );
        }
      }
    }
  }

  // 4. Reject if any violation
  if (guardrailViolations.length > 0 || sliceViolations.length > 0) {
    return {
      decision: "reject",
      utilityDelta,
      reasons: ["Guardrail or slice regression detected"],
      guardrailViolations,
      sliceViolations,
    };
  }

  // 5. Promote if utility improves >= 3%
  if (utilityDelta >= THRESHOLDS.minUtilityImprovement) {
    reasons.push(
      `Utility improved by ${(utilityDelta * 100).toFixed(1)}% (threshold: ${THRESHOLDS.minUtilityImprovement * 100}%)`,
    );
    return { decision: "promote", utilityDelta, reasons, guardrailViolations, sliceViolations };
  }

  // 6. Hold zone: improvement exists but < 1%
  if (utilityDelta > 0 && utilityDelta < THRESHOLDS.holdZoneThreshold) {
    reasons.push(
      `Utility improved by ${(utilityDelta * 100).toFixed(1)}% — within noise threshold (${THRESHOLDS.holdZoneThreshold * 100}%)`,
    );
    return { decision: "hold", utilityDelta, reasons, guardrailViolations, sliceViolations };
  }

  // 7. No improvement or negative
  if (utilityDelta <= 0) {
    reasons.push(`No utility improvement (Δ=${(utilityDelta * 100).toFixed(1)}%)`);
    return { decision: "reject", utilityDelta, reasons, guardrailViolations, sliceViolations };
  }

  // Between 1% and 3% — hold for more data
  reasons.push(
    `Utility improved by ${(utilityDelta * 100).toFixed(1)}% — between hold and promote thresholds`,
  );
  return { decision: "hold", utilityDelta, reasons, guardrailViolations, sliceViolations };
}
