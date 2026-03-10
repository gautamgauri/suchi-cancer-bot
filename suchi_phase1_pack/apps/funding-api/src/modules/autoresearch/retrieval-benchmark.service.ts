/**
 * Retrieval benchmark runner.
 * Runs retrieval-only benchmarks (no LLM writing, no reranker API calls)
 * to evaluate config variants against a gold query set.
 */
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RetrievalService } from "../evidence_ingest/retrieval.service";
import { QueryExpanderService } from "../evidence_ingest/query-expander.service";
import {
  RetrievalConfig,
  BASELINE_RETRIEVAL_CONFIG,
  buildTierBoostMap,
} from "./retrieval-config";
import { computeRetrievalConfidenceWithConfig } from "./config-adapters";

// ---------------------------------------------------------------------------
// Benchmark query types
// ---------------------------------------------------------------------------

export type BenchmarkSlice = "easy_win" | "borderline" | "known_failure" | "proper_noun";

export interface BenchmarkQuery {
  id: string;
  query: string;
  sectionName: string;
  orgId: string;
  slice: BenchmarkSlice;
  expectedDocIds?: string[];
  corpus?: string[];
}

export interface BenchmarkSet {
  id: string;
  version: string;
  queries: BenchmarkQuery[];
}

// ---------------------------------------------------------------------------
// Per-query result
// ---------------------------------------------------------------------------

interface QueryResult {
  queryId: string;
  slice: BenchmarkSlice;
  chunksRetrieved: number;
  uniqueDocCount: number;
  scores: number[];
  avgScore: number;
  tierACount: number;
  totalChunks: number;
  confidenceLevel: string;
  rerankerWouldTrigger: boolean;
  recallAtK: number | null; // null if no expectedDocIds
  latencyMs: number;
  retrievedDocIds: string[];
}

// ---------------------------------------------------------------------------
// Aggregate metrics
// ---------------------------------------------------------------------------

export interface BenchmarkMetrics {
  recallAtK: number;
  avgScore: number;
  medianScore: number;
  avgChunksRetrieved: number;
  avgUniqueDocCount: number;
  tierAFraction: number;
  avgConfidenceLevel: number; // low=0, medium=0.5, high=1
  p50LatencyMs: number;
  p95LatencyMs: number;
  rerankerTriggerRate: number;
}

export interface SliceMetrics {
  easy_win?: BenchmarkMetrics;
  borderline?: BenchmarkMetrics;
  known_failure?: BenchmarkMetrics;
  proper_noun?: BenchmarkMetrics;
}

export interface BenchmarkRunResult {
  benchmarkRunId: string;
  variantId: string;
  queryCount: number;
  metrics: BenchmarkMetrics;
  sliceMetrics: SliceMetrics;
  perQueryResults: Record<string, QueryResult>;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class RetrievalBenchmarkService {
  private readonly logger = new Logger(RetrievalBenchmarkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly queryExpander: QueryExpanderService,
  ) {}

  /**
   * Run a benchmark for a specific variant against a query set.
   */
  async runBenchmark(
    variantId: string,
    benchmarkSet: BenchmarkSet,
    config: RetrievalConfig = BASELINE_RETRIEVAL_CONFIG,
  ): Promise<BenchmarkRunResult> {
    const startTime = Date.now();

    // Create BenchmarkRun record
    const run = await this.prisma.benchmarkRun.create({
      data: {
        variantId,
        benchmarkSetId: benchmarkSet.id,
        benchmarkSetVersion: benchmarkSet.version,
        queryCount: benchmarkSet.queries.length,
        status: "running",
        startedAt: new Date(),
      },
    });

    const perQueryResults: Record<string, QueryResult> = {};

    try {
      // Run each query
      for (const bq of benchmarkSet.queries) {
        const qResult = await this.runSingleQuery(bq, config);
        perQueryResults[bq.id] = qResult;
      }

      // Compute aggregate metrics
      const allResults = Object.values(perQueryResults);
      const metrics = this.computeAggregateMetrics(allResults);

      // Compute per-slice metrics
      const sliceMetrics: SliceMetrics = {};
      for (const slice of ["easy_win", "borderline", "known_failure", "proper_noun"] as BenchmarkSlice[]) {
        const sliceResults = allResults.filter((r) => r.slice === slice);
        if (sliceResults.length > 0) {
          sliceMetrics[slice] = this.computeAggregateMetrics(sliceResults);
        }
      }

      const durationMs = Date.now() - startTime;

      // Write MetricSnapshot rows
      const metricEntries = Object.entries(metrics) as Array<[string, number]>;
      await this.prisma.metricSnapshot.createMany({
        data: metricEntries.map(([name, value]) => ({
          benchmarkRunId: run.id,
          metricName: name,
          metricValue: value,
          perQueryValues: Object.fromEntries(
            Object.entries(perQueryResults).map(([qId, qr]) => {
              const val = this.getMetricFromResult(qr, name);
              return [qId, val];
            }),
          ),
        })),
      });

      // Update BenchmarkRun
      await this.prisma.benchmarkRun.update({
        where: { id: run.id },
        data: {
          status: "complete",
          completedAt: new Date(),
          durationMs,
          sliceMetrics: sliceMetrics as object,
        },
      });

      this.logger.log({
        message: "Benchmark complete",
        runId: run.id,
        variantId,
        queryCount: benchmarkSet.queries.length,
        durationMs,
        utilityScore: this.computeUtilityScore(metrics),
      });

      return {
        benchmarkRunId: run.id,
        variantId,
        queryCount: benchmarkSet.queries.length,
        metrics,
        sliceMetrics,
        perQueryResults,
        durationMs,
      };
    } catch (err) {
      await this.prisma.benchmarkRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorMessage: (err as Error).message,
        },
      });
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Single query execution
  // -------------------------------------------------------------------------

  private async runSingleQuery(
    bq: BenchmarkQuery,
    config: RetrievalConfig,
  ): Promise<QueryResult> {
    const startMs = Date.now();

    // 1. Query expansion
    const expandedQueries = this.queryExpander
      .expandQueries([bq.query], bq.sectionName)
      .slice(0, config.maxQueriesPerSection);

    // 2. Retrieve chunks across all expanded queries
    const allChunks = new Map<string, { id: string; docId: string; score: number; qualityTier?: string }>();
    const rrfData = new Map<string, { ranks: number[]; hitCount: number; maxScore: number }>();
    const tierBoostMap = buildTierBoostMap(config);

    for (const query of expandedQueries) {
      const chunks = await this.retrieval.retrieve(query, {
        mode: "proposal_drafting",
        limit: config.retrievalLimitPerQuery,
        minScore: config.minScoreThreshold,
        orgId: bq.orgId,
        corpus: bq.corpus,
      });

      chunks.forEach((chunk, rank) => {
        const tierBoost = tierBoostMap[chunk.qualityTier ?? "X"] ?? 1.0;
        const boostedScore = (chunk.score ?? 0) * tierBoost;

        const existing = rrfData.get(chunk.id);
        if (existing) {
          existing.ranks.push(rank);
          existing.hitCount++;
          existing.maxScore = Math.max(existing.maxScore, boostedScore);
        } else {
          rrfData.set(chunk.id, { ranks: [rank], hitCount: 1, maxScore: boostedScore });
        }

        const existingChunk = allChunks.get(chunk.id);
        if (!existingChunk || boostedScore > existingChunk.score) {
          allChunks.set(chunk.id, {
            id: chunk.id,
            docId: chunk.source,
            score: boostedScore,
            qualityTier: chunk.qualityTier,
          });
        }
      });
    }

    // 3. Compute RRF scores
    for (const [chunkId, data] of rrfData) {
      const rrfScore = data.ranks.reduce((sum, r) => sum + 1 / (config.rrfK + r), 0);
      const multiBoost = 1 + config.multiQueryBoost * Math.max(0, data.hitCount - 1);
      const fusedScore = rrfScore * multiBoost;
      const chunk = allChunks.get(chunkId);
      if (chunk) {
        chunk.score =
          config.fusedScoreWeightSimilarity * data.maxScore +
          (1 - config.fusedScoreWeightSimilarity) * (fusedScore / (1 / config.rrfK));
      }
    }

    // 4. Diversification
    const docChunkCounts = new Map<string, number>();
    const diversified = Array.from(allChunks.values())
      .sort((a, b) => b.score - a.score)
      .filter((c) => {
        const count = docChunkCounts.get(c.docId) ?? 0;
        if (count >= config.maxChunksPerDoc) return false;
        docChunkCounts.set(c.docId, count + 1);
        return true;
      });

    // 5. Overselect (for reranker gating check, but don't call reranker API)
    const overselected = diversified.slice(0, config.overselectCap);

    // 6. Check if reranker would trigger (without calling it)
    const rerankerWouldTrigger = this.wouldRerankTrigger(bq.sectionName, overselected, config);

    // 7. Final chunk limit
    const finalChunks = overselected.slice(0, config.finalChunkLimit);

    // 8. Confidence
    const confidence = computeRetrievalConfidenceWithConfig(
      finalChunks.map((c) => ({ score: c.score, docId: c.docId })),
      bq.sectionName,
      config,
    );

    // 9. Recall@K
    let recallAtK: number | null = null;
    if (bq.expectedDocIds && bq.expectedDocIds.length > 0) {
      const retrievedDocIds = new Set(finalChunks.map((c) => c.docId));
      const hits = bq.expectedDocIds.filter((id) => retrievedDocIds.has(id)).length;
      recallAtK = hits / bq.expectedDocIds.length;
    }

    const scores = finalChunks.map((c) => c.score);
    const tierACount = finalChunks.filter((c) => c.qualityTier === "A").length;

    return {
      queryId: bq.id,
      slice: bq.slice,
      chunksRetrieved: finalChunks.length,
      uniqueDocCount: new Set(finalChunks.map((c) => c.docId)).size,
      scores,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      tierACount,
      totalChunks: finalChunks.length,
      confidenceLevel: confidence.level,
      rerankerWouldTrigger,
      recallAtK,
      latencyMs: Date.now() - startMs,
      retrievedDocIds: finalChunks.map((c) => c.docId),
    };
  }

  // -------------------------------------------------------------------------
  // Reranker gating check (mirrors reranker.service.ts logic)
  // -------------------------------------------------------------------------

  private wouldRerankTrigger(
    sectionName: string,
    chunks: Array<{ score: number }>,
    config: RetrievalConfig,
  ): boolean {
    const sectionLower = sectionName.toLowerCase();
    const alwaysRerank = ["budget", "objectives", "monitoring", "results", "need"];
    const skipRerank = ["team", "sustainability", "communication", "cover_letter", "experience"];

    if (alwaysRerank.some((s) => sectionLower.includes(s))) return true;
    if (skipRerank.some((s) => sectionLower.includes(s))) return false;

    const scores = chunks.map((c) => c.score).sort((a, b) => b - a);
    const h1 = scores[0] ?? 0;
    const gap3 = scores.length >= 3 ? scores[0] - scores[2] : 1;
    const gap6 = scores.length >= 6 ? scores[0] - scores[5] : 1;

    if (gap3 <= config.rerankerGapThreshold1vs3 || gap6 <= config.rerankerGapThreshold1vs6) return true;
    if (h1 < config.rerankerWeakTopThreshold) return true;

    return false;
  }

  // -------------------------------------------------------------------------
  // Aggregate metrics computation
  // -------------------------------------------------------------------------

  private computeAggregateMetrics(results: QueryResult[]): BenchmarkMetrics {
    if (results.length === 0) {
      return {
        recallAtK: 0, avgScore: 0, medianScore: 0,
        avgChunksRetrieved: 0, avgUniqueDocCount: 0, tierAFraction: 0,
        avgConfidenceLevel: 0, p50LatencyMs: 0, p95LatencyMs: 0, rerankerTriggerRate: 0,
      };
    }

    // Recall@K (only for queries with gold labels)
    const recallResults = results.filter((r) => r.recallAtK !== null);
    const recallAtK = recallResults.length > 0
      ? recallResults.reduce((sum, r) => sum + r.recallAtK!, 0) / recallResults.length
      : 0;

    // Scores
    const allScores = results.flatMap((r) => r.scores);
    const avgScore = allScores.length > 0
      ? allScores.reduce((a, b) => a + b, 0) / allScores.length
      : 0;
    const sortedScores = [...allScores].sort((a, b) => a - b);
    const medianScore = sortedScores.length > 0
      ? sortedScores[Math.floor(sortedScores.length / 2)]
      : 0;

    // Chunks & docs
    const avgChunksRetrieved = results.reduce((s, r) => s + r.chunksRetrieved, 0) / results.length;
    const avgUniqueDocCount = results.reduce((s, r) => s + r.uniqueDocCount, 0) / results.length;

    // Tier A fraction
    const totalTierA = results.reduce((s, r) => s + r.tierACount, 0);
    const totalChunks = results.reduce((s, r) => s + r.totalChunks, 0);
    const tierAFraction = totalChunks > 0 ? totalTierA / totalChunks : 0;

    // Confidence
    const confMap: Record<string, number> = { low: 0, medium: 0.5, high: 1 };
    const avgConfidenceLevel =
      results.reduce((s, r) => s + (confMap[r.confidenceLevel] ?? 0), 0) / results.length;

    // Latency
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50LatencyMs = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95LatencyMs = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

    // Reranker trigger rate
    const rerankerTriggerRate =
      results.filter((r) => r.rerankerWouldTrigger).length / results.length;

    return {
      recallAtK, avgScore, medianScore,
      avgChunksRetrieved, avgUniqueDocCount, tierAFraction,
      avgConfidenceLevel, p50LatencyMs, p95LatencyMs, rerankerTriggerRate,
    };
  }

  /** Compute composite utility score from metrics. */
  private computeUtilityScore(m: BenchmarkMetrics): number {
    return 0.50 * m.recallAtK + 0.25 * m.avgScore + 0.15 * m.tierAFraction + 0.10 * (1 - m.rerankerTriggerRate);
  }

  /** Extract a named metric value from a single query result. */
  private getMetricFromResult(qr: QueryResult, metricName: string): number {
    switch (metricName) {
      case "recallAtK": return qr.recallAtK ?? 0;
      case "avgScore": return qr.avgScore;
      case "medianScore": return qr.scores.length > 0
        ? [...qr.scores].sort((a, b) => a - b)[Math.floor(qr.scores.length / 2)]
        : 0;
      case "avgChunksRetrieved": return qr.chunksRetrieved;
      case "avgUniqueDocCount": return qr.uniqueDocCount;
      case "tierAFraction": return qr.totalChunks > 0 ? qr.tierACount / qr.totalChunks : 0;
      case "avgConfidenceLevel":
        return ({ low: 0, medium: 0.5, high: 1 } as Record<string, number>)[qr.confidenceLevel] ?? 0;
      case "p50LatencyMs":
      case "p95LatencyMs":
        return qr.latencyMs;
      case "rerankerTriggerRate": return qr.rerankerWouldTrigger ? 1 : 0;
      default: return 0;
    }
  }
}
