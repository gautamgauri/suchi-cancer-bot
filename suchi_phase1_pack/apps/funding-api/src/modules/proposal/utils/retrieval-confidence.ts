/**
 * Retrieval confidence scoring utility.
 *
 * Evaluates the quality of a retrieval result set based on
 * average similarity score, chunk count, and document diversity.
 *
 * Sprint 2: Added section-specific thresholds — evidence-heavy sections
 * (budget, monitoring, results) require higher confidence than narrative sections.
 */

export interface RetrievalConfidence {
  level: "high" | "medium" | "low";
  avgScore: number;
  chunkCount: number;
  uniqueDocCount: number;
  reason?: string;
}

interface ConfidenceThresholds {
  minAvgScore: number;
  highAvgScore: number;
  minChunks: number;
  minDocs: number;
}

/** Default thresholds (used for most sections) */
const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  minAvgScore: 0.35,
  highAvgScore: 0.50,
  minChunks: 3,
  minDocs: 2,
};

/**
 * Section-specific thresholds.
 * HIGH-evidence sections need stricter thresholds to prevent hallucination.
 * NARRATIVE sections can tolerate lower confidence.
 */
const SECTION_THRESHOLDS: Record<string, ConfidenceThresholds> = {
  // Evidence-critical: strict thresholds
  budget: { minAvgScore: 0.40, highAvgScore: 0.55, minChunks: 4, minDocs: 2 },
  monitoring: { minAvgScore: 0.38, highAvgScore: 0.52, minChunks: 3, minDocs: 2 },
  results: { minAvgScore: 0.38, highAvgScore: 0.52, minChunks: 3, minDocs: 2 },
  objectives: { minAvgScore: 0.36, highAvgScore: 0.50, minChunks: 3, minDocs: 2 },
  need: { minAvgScore: 0.36, highAvgScore: 0.50, minChunks: 3, minDocs: 2 },

  // Narrative/org-context: relaxed thresholds
  team: { minAvgScore: 0.30, highAvgScore: 0.45, minChunks: 2, minDocs: 1 },
  sustainability: { minAvgScore: 0.30, highAvgScore: 0.45, minChunks: 2, minDocs: 1 },
  communication: { minAvgScore: 0.28, highAvgScore: 0.42, minChunks: 2, minDocs: 1 },
  experience: { minAvgScore: 0.30, highAvgScore: 0.45, minChunks: 2, minDocs: 1 },
  compliance: { minAvgScore: 0.25, highAvgScore: 0.40, minChunks: 1, minDocs: 1 },
};

/**
 * Get thresholds for a section, falling back to defaults.
 */
function getThresholds(sectionName?: string): ConfidenceThresholds {
  if (!sectionName) return DEFAULT_THRESHOLDS;
  const lower = sectionName.toLowerCase();

  for (const [key, thresholds] of Object.entries(SECTION_THRESHOLDS)) {
    if (lower.includes(key)) return thresholds;
  }

  // Additional section name matches
  if (lower.includes("m&e") || lower.includes("evaluat")) return SECTION_THRESHOLDS.monitoring;
  if (lower.includes("impact") || lower.includes("outcome")) return SECTION_THRESHOLDS.results;
  if (lower.includes("goal")) return SECTION_THRESHOLDS.objectives;
  if (lower.includes("staff") || lower.includes("personnel")) return SECTION_THRESHOLDS.team;
  if (lower.includes("exit") || lower.includes("scale")) return SECTION_THRESHOLDS.sustainability;
  if (lower.includes("track record")) return SECTION_THRESHOLDS.experience;

  return DEFAULT_THRESHOLDS;
}

export function computeRetrievalConfidence(
  chunks: Array<{ score?: number; docId: string }>,
  sectionName?: string,
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

  const thresholds = getThresholds(sectionName);
  const scores = chunks.map((c) => c.score ?? 0);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const uniqueDocs = new Set(chunks.map((c) => c.docId)).size;

  if (
    avgScore >= thresholds.highAvgScore &&
    chunks.length >= thresholds.minChunks &&
    uniqueDocs >= thresholds.minDocs
  ) {
    return { level: "high", avgScore, chunkCount: chunks.length, uniqueDocCount: uniqueDocs };
  }

  if (avgScore >= thresholds.minAvgScore && chunks.length >= thresholds.minDocs) {
    return { level: "medium", avgScore, chunkCount: chunks.length, uniqueDocCount: uniqueDocs };
  }

  const reasons: string[] = [];
  if (avgScore < thresholds.minAvgScore) reasons.push(`Low avg score: ${avgScore.toFixed(3)}`);
  if (chunks.length < thresholds.minChunks) reasons.push(`Only ${chunks.length} chunks`);
  if (uniqueDocs < thresholds.minDocs) reasons.push(`Only ${uniqueDocs} unique doc(s)`);

  return {
    level: "low",
    avgScore,
    chunkCount: chunks.length,
    uniqueDocCount: uniqueDocs,
    reason: reasons.join("; "),
  };
}

/**
 * Check if a section is evidence-critical (requires HIGH confidence for quality output).
 */
export function isEvidenceCriticalSection(sectionName: string): boolean {
  const lower = sectionName.toLowerCase();
  return (
    lower.includes("budget") ||
    lower.includes("financial") ||
    lower.includes("monitor") ||
    lower.includes("evaluat") ||
    lower.includes("m&e") ||
    lower.includes("result") ||
    lower.includes("outcome") ||
    lower.includes("impact")
  );
}
