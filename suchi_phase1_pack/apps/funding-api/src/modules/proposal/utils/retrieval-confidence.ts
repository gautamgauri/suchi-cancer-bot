/**
 * Retrieval confidence scoring utility.
 *
 * Evaluates the quality of a retrieval result set based on
 * average similarity score, chunk count, and document diversity.
 */

export interface RetrievalConfidence {
  level: "high" | "medium" | "low";
  avgScore: number;
  chunkCount: number;
  uniqueDocCount: number;
  reason?: string;
}

const THRESHOLDS = {
  minAvgScore: 0.35,
  highAvgScore: 0.50,
  minChunks: 3,
  minDocs: 2,
};

export function computeRetrievalConfidence(
  chunks: Array<{ score?: number; docId: string }>,
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
    avgScore >= THRESHOLDS.highAvgScore &&
    chunks.length >= THRESHOLDS.minChunks &&
    uniqueDocs >= THRESHOLDS.minDocs
  ) {
    return { level: "high", avgScore, chunkCount: chunks.length, uniqueDocCount: uniqueDocs };
  }

  if (avgScore >= THRESHOLDS.minAvgScore && chunks.length >= THRESHOLDS.minDocs) {
    return { level: "medium", avgScore, chunkCount: chunks.length, uniqueDocCount: uniqueDocs };
  }

  const reasons: string[] = [];
  if (avgScore < THRESHOLDS.minAvgScore) reasons.push(`Low avg score: ${avgScore.toFixed(3)}`);
  if (chunks.length < THRESHOLDS.minChunks) reasons.push(`Only ${chunks.length} chunks`);
  if (uniqueDocs < THRESHOLDS.minDocs) reasons.push(`Only ${uniqueDocs} unique doc(s)`);

  return {
    level: "low",
    avgScore,
    chunkCount: chunks.length,
    uniqueDocCount: uniqueDocs,
    reason: reasons.join("; "),
  };
}
