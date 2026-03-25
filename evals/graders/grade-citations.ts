import { ApiTrace, DatasetRow, GradeResult } from '../types';

export function gradeCitations(trace: ApiTrace, row: DatasetRow): GradeResult {
  if (!row.requires_citations) {
    return { grader: 'citations', passed: true, score: 1.0, details: 'Citations not required for this case' };
  }

  if (trace.error) {
    return { grader: 'citations', passed: false, score: 0, details: 'API error — no response to check' };
  }

  const citations = trace.citations || [];
  const chunks = trace.retrievedChunks || [];

  if (citations.length === 0) {
    return {
      grader: 'citations',
      passed: false,
      score: 0,
      details: `Zero citations returned. ${chunks.length} chunks were retrieved.`,
      reason: 'CIT_ZERO',
    };
  }

  // Check grounding: each citation docId should exist in retrieved chunks
  const retrievedDocIds = new Set(chunks.map((c) => c.docId));
  const grounded = citations.filter((c) => retrievedDocIds.has(c.docId));
  const orphaned = citations.length - grounded.length;
  const groundingRate = grounded.length / citations.length;

  if (orphaned > 0 && groundingRate < 0.5) {
    return {
      grader: 'citations',
      passed: false,
      score: groundingRate,
      details: `${orphaned}/${citations.length} citations not grounded in retrieved chunks`,
      reason: 'CIT_ORPHAN',
    };
  }

  // Confidence check
  const conf = trace.citationConfidence;
  const confPenalty = conf === 'RED' ? 0.3 : conf === 'YELLOW' ? 0.1 : 0;

  const score = Math.max(0, groundingRate - confPenalty);
  return {
    grader: 'citations',
    passed: score >= 0.5,
    score,
    details: `${citations.length} citations, ${grounded.length} grounded, confidence=${conf || 'unknown'}`,
  };
}
