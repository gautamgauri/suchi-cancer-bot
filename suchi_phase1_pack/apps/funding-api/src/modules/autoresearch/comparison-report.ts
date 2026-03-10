/**
 * Comparison report generator for autoresearch experiments.
 * Produces a structured report comparing all variants in an experiment
 * against the baseline, with per-slice breakdown.
 */
import { BenchmarkMetrics, SliceMetrics, BenchmarkSlice } from "./retrieval-benchmark.service";
import { computeUtilityScore, UTILITY_WEIGHTS } from "./promotion-logic";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface VariantReport {
  variantId: string;
  variantLabel: string;
  isBaseline: boolean;
  configDelta: Record<string, number>;
  status: string;
  metrics: BenchmarkMetrics | null;
  sliceMetrics: SliceMetrics | null;
  utilityScore: number | null;
  // Deltas vs baseline (null for baseline itself)
  deltaVsBaseline: {
    utilityScore: number | null;
    recallAtK: number | null;
    avgScore: number | null;
    tierAFraction: number | null;
    rerankerTriggerRate: number | null;
  } | null;
  perSliceDelta: Record<BenchmarkSlice, { recallAtK: number | null }> | null;
}

export interface ComparisonReport {
  experimentId: string;
  experimentName: string;
  hypothesis: string;
  baselineUtilityScore: number | null;
  variants: VariantReport[];
  utilityWeights: typeof UTILITY_WEIGHTS;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

export interface VariantData {
  id: string;
  variantLabel: string;
  isBaseline: boolean;
  configDelta: Record<string, number>;
  status: string;
  benchmarkRuns: Array<{
    status: string;
    sliceMetrics: SliceMetrics | null;
    metrics: Array<{
      metricName: string;
      metricValue: number;
    }>;
  }>;
}

export function buildComparisonReport(
  experiment: {
    id: string;
    name: string;
    hypothesis: string;
  },
  variants: VariantData[],
): ComparisonReport {
  // Find baseline
  const baselineVariant = variants.find((v) => v.isBaseline);
  const baselineMetrics = baselineVariant
    ? extractLatestMetrics(baselineVariant)
    : null;
  const baselineSliceMetrics = baselineVariant
    ? extractLatestSliceMetrics(baselineVariant)
    : null;
  const baselineUtility = baselineMetrics
    ? computeUtilityScore(baselineMetrics)
    : null;

  const variantReports: VariantReport[] = variants.map((v) => {
    const metrics = extractLatestMetrics(v);
    const sliceMetrics = extractLatestSliceMetrics(v);
    const utility = metrics ? computeUtilityScore(metrics) : null;

    let deltaVsBaseline: VariantReport["deltaVsBaseline"] = null;
    let perSliceDelta: VariantReport["perSliceDelta"] = null;

    if (!v.isBaseline && metrics && baselineMetrics) {
      deltaVsBaseline = {
        utilityScore: utility !== null && baselineUtility !== null
          ? utility - baselineUtility
          : null,
        recallAtK: metrics.recallAtK - baselineMetrics.recallAtK,
        avgScore: metrics.avgScore - baselineMetrics.avgScore,
        tierAFraction: metrics.tierAFraction - baselineMetrics.tierAFraction,
        rerankerTriggerRate: metrics.rerankerTriggerRate - baselineMetrics.rerankerTriggerRate,
      };

      // Per-slice recall delta
      if (sliceMetrics && baselineSliceMetrics) {
        perSliceDelta = {} as VariantReport["perSliceDelta"] & Record<BenchmarkSlice, { recallAtK: number | null }>;
        for (const slice of ["easy_win", "borderline", "known_failure", "proper_noun"] as BenchmarkSlice[]) {
          const varSlice = sliceMetrics[slice];
          const baseSlice = baselineSliceMetrics[slice];
          (perSliceDelta as Record<string, { recallAtK: number | null }>)[slice] = {
            recallAtK: varSlice && baseSlice
              ? varSlice.recallAtK - baseSlice.recallAtK
              : null,
          };
        }
      }
    }

    return {
      variantId: v.id,
      variantLabel: v.variantLabel,
      isBaseline: v.isBaseline,
      configDelta: v.configDelta,
      status: v.status,
      metrics,
      sliceMetrics,
      utilityScore: utility,
      deltaVsBaseline,
      perSliceDelta,
    };
  });

  // Sort: baseline first, then by utility score descending
  variantReports.sort((a, b) => {
    if (a.isBaseline) return -1;
    if (b.isBaseline) return 1;
    return (b.utilityScore ?? 0) - (a.utilityScore ?? 0);
  });

  return {
    experimentId: experiment.id,
    experimentName: experiment.name,
    hypothesis: experiment.hypothesis,
    baselineUtilityScore: baselineUtility,
    variants: variantReports,
    utilityWeights: UTILITY_WEIGHTS,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractLatestMetrics(variant: VariantData): BenchmarkMetrics | null {
  const completedRuns = variant.benchmarkRuns.filter((r) => r.status === "complete");
  if (completedRuns.length === 0) return null;

  // Use the latest completed run
  const latestRun = completedRuns[completedRuns.length - 1];
  const metricsMap = new Map(latestRun.metrics.map((m) => [m.metricName, m.metricValue]));

  return {
    recallAtK: metricsMap.get("recallAtK") ?? 0,
    avgScore: metricsMap.get("avgScore") ?? 0,
    medianScore: metricsMap.get("medianScore") ?? 0,
    avgChunksRetrieved: metricsMap.get("avgChunksRetrieved") ?? 0,
    avgUniqueDocCount: metricsMap.get("avgUniqueDocCount") ?? 0,
    tierAFraction: metricsMap.get("tierAFraction") ?? 0,
    avgConfidenceLevel: metricsMap.get("avgConfidenceLevel") ?? 0,
    p50LatencyMs: metricsMap.get("p50LatencyMs") ?? 0,
    p95LatencyMs: metricsMap.get("p95LatencyMs") ?? 0,
    rerankerTriggerRate: metricsMap.get("rerankerTriggerRate") ?? 0,
  };
}

function extractLatestSliceMetrics(variant: VariantData): SliceMetrics | null {
  const completedRuns = variant.benchmarkRuns.filter((r) => r.status === "complete");
  if (completedRuns.length === 0) return null;
  return completedRuns[completedRuns.length - 1].sliceMetrics ?? null;
}
