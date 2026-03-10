/**
 * Adapter functions that bridge RetrievalConfig into the existing
 * retrieval pipeline functions. These allow passing config as an
 * optional parameter while keeping the original function signatures
 * unchanged for existing callers.
 */
import {
  RetrievalConfig,
  BASELINE_RETRIEVAL_CONFIG,
} from "./retrieval-config";
import type { RetrievalConfidence } from "../proposal/utils/retrieval-confidence";

/**
 * Compute retrieval confidence using config-driven thresholds.
 * Drop-in replacement for `computeRetrievalConfidence()` when
 * a config is available.
 */
export function computeRetrievalConfidenceWithConfig(
  chunks: Array<{ score?: number; docId: string }>,
  _sectionName: string | undefined,
  config: RetrievalConfig = BASELINE_RETRIEVAL_CONFIG,
): RetrievalConfidence {
  if (chunks.length === 0) {
    return {
      level: "low",
      avgScore: 0,
      chunkCount: 0,
      uniqueDocCount: 0,
      reason: "No chunks retrieved",
    };
  }

  const scores = chunks.map((c) => c.score ?? 0);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const uniqueDocs = new Set(chunks.map((c) => c.docId)).size;

  if (
    avgScore >= config.confidenceHighAvgScore &&
    chunks.length >= config.confidenceMinChunks &&
    uniqueDocs >= config.confidenceMinDocs
  ) {
    return { level: "high", avgScore, chunkCount: chunks.length, uniqueDocCount: uniqueDocs };
  }

  if (avgScore >= config.confidenceMinAvgScore && chunks.length >= config.confidenceMinDocs) {
    return { level: "medium", avgScore, chunkCount: chunks.length, uniqueDocCount: uniqueDocs };
  }

  const reasons: string[] = [];
  if (avgScore < config.confidenceMinAvgScore) reasons.push(`Low avg score: ${avgScore.toFixed(3)}`);
  if (chunks.length < config.confidenceMinChunks) reasons.push(`Only ${chunks.length} chunks`);
  if (uniqueDocs < config.confidenceMinDocs) reasons.push(`Only ${uniqueDocs} unique doc(s)`);

  return {
    level: "low",
    avgScore,
    chunkCount: chunks.length,
    uniqueDocCount: uniqueDocs,
    reason: reasons.join("; "),
  };
}

/**
 * Check if reranker should trigger based on config thresholds.
 * Mirrors the gating logic in RerankerService.shouldRerank().
 */
export function shouldRerankWithConfig(
  sectionName: string,
  chunks: Array<{ score?: number }>,
  config: RetrievalConfig = BASELINE_RETRIEVAL_CONFIG,
): { shouldRerank: boolean; reason: string } {
  const sectionLower = sectionName.toLowerCase();

  const alwaysRerank = ["budget", "objectives", "monitoring", "results", "need"];
  const skipRerank = ["team", "sustainability", "communication", "cover_letter", "experience"];

  if (alwaysRerank.some((s) => sectionLower.includes(s))) {
    return { shouldRerank: true, reason: `always_rerank:${sectionLower}` };
  }
  if (skipRerank.some((s) => sectionLower.includes(s))) {
    return { shouldRerank: false, reason: `skip_section:${sectionLower}` };
  }

  const scores = chunks.map((c) => c.score ?? 0).sort((a, b) => b - a);
  const h1 = scores[0] ?? 0;
  const gap3 = scores.length >= 3 ? scores[0] - scores[2] : 1;
  const gap6 = scores.length >= 6 ? scores[0] - scores[5] : 1;

  if (gap3 <= config.rerankerGapThreshold1vs3 || gap6 <= config.rerankerGapThreshold1vs6) {
    return { shouldRerank: true, reason: `score_ambiguity:gap3=${gap3.toFixed(3)},gap6=${gap6.toFixed(3)}` };
  }

  if (h1 < config.rerankerWeakTopThreshold) {
    return { shouldRerank: true, reason: `weak_top:h1=${h1.toFixed(3)}` };
  }

  return { shouldRerank: false, reason: `clear_separation:h1=${h1.toFixed(3)},gap3=${gap3.toFixed(3)}` };
}
