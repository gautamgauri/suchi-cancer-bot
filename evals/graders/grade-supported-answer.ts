import { ApiTrace, DatasetRow, GradeResult } from '../types';

export function gradeSupportedAnswer(trace: ApiTrace, row: DatasetRow): GradeResult {
  if (trace.error) {
    return { grader: 'supported_answer', passed: false, score: 0, details: 'API error' };
  }

  // If abstained, no answer to evaluate support for
  if (trace.abstentionReason) {
    return {
      grader: 'supported_answer',
      passed: false,
      score: 0.2,
      details: `Abstained (${trace.abstentionReason}) — no substantive answer to evaluate`,
    };
  }

  const text = trace.responseText;
  const chunks = trace.retrievedChunks || [];
  const citations = trace.citations || [];

  // No chunks retrieved → can't be evidence-supported
  if (chunks.length === 0 && row.requires_citations) {
    return {
      grader: 'supported_answer',
      passed: false,
      score: 0.1,
      details: 'No chunks retrieved — answer cannot be evidence-supported',
      reason: 'SUPPORT_UNGROUNDED',
    };
  }

  // Heuristic scoring
  let score = 0;

  // Has retrieved chunks? (+0.3)
  if (chunks.length > 0) score += 0.3;

  // Has citations? (+0.3)
  if (citations.length > 0) score += 0.3;

  // Response is substantive (>200 chars)? (+0.2)
  if (text.length > 200) score += 0.2;

  // Citation confidence is GREEN? (+0.2)
  if (trace.citationConfidence === 'GREEN') score += 0.2;
  else if (trace.citationConfidence === 'YELLOW') score += 0.1;

  score = Math.min(1.0, score);

  return {
    grader: 'supported_answer',
    passed: score >= 0.5,
    score,
    details: `${chunks.length} chunks, ${citations.length} citations, ${text.length} chars, confidence=${trace.citationConfidence || 'unknown'}`,
    reason: score < 0.5 ? 'SUPPORT_UNGROUNDED' : undefined,
  };
}
