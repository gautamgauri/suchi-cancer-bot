import { ApiTrace, DatasetRow, GradeResult } from '../types';

const ANSWERABLE_INTENTS = ['symptoms', 'screening', 'triage'];

const CLARIFICATION_PATTERNS = [
  /could you (?:please )?(?:specify|clarify|tell me more)/i,
  /can you (?:please )?(?:specify|clarify|provide more)/i,
  /what (?:type|kind|specific)/i,
  /are you asking about/i,
  /do you mean/i,
  /which (?:type|kind|symptoms)/i,
  /to provide more accurate/i,
  /more information.*needed/i,
];

export function gradeDirectness(trace: ApiTrace, row: DatasetRow): GradeResult {
  if (trace.error) {
    return { grader: 'directness', passed: false, score: 0, details: 'API error' };
  }

  const text = trace.responseText;
  const isAnswerable = ANSWERABLE_INTENTS.includes(row.intent);

  // Check for false abstention
  if (trace.abstentionReason && isAnswerable) {
    const hasChunks = (trace.retrievedChunks || []).length > 0;
    if (hasChunks) {
      return {
        grader: 'directness',
        passed: false,
        score: 0,
        details: `Abstained (${trace.abstentionReason}) despite ${trace.retrievedChunks.length} retrieved chunks`,
        reason: 'DIRECT_ABSTAIN',
      };
    }
  }

  // Check for unnecessary clarification questions
  const clarificationHits = CLARIFICATION_PATTERNS.filter((p) => p.test(text));

  if (clarificationHits.length > 0 && isAnswerable) {
    // Is the response mostly a clarifying question (short, no substance)?
    const isSubstantive = text.length > 300 && !trace.abstentionReason;
    if (!isSubstantive) {
      return {
        grader: 'directness',
        passed: false,
        score: 0.2,
        details: `${clarificationHits.length} clarification pattern(s) detected in non-substantive response (${text.length} chars)`,
        reason: 'DIRECT_OVERASK',
      };
    }
  }

  // Short non-answer check
  if (text.length < 100 && isAnswerable && !trace.abstentionReason) {
    return {
      grader: 'directness',
      passed: false,
      score: 0.3,
      details: `Very short response (${text.length} chars) for answerable query`,
      reason: 'DIRECT_OVERASK',
    };
  }

  // Count question marks — too many questions in response suggests over-clarification
  const questionCount = (text.match(/\?/g) || []).length;
  const hasSubstance = text.length > 200;
  if (questionCount > 4 && !hasSubstance) {
    return {
      grader: 'directness',
      passed: false,
      score: 0.3,
      details: `${questionCount} questions in response without substantial content`,
      reason: 'DIRECT_OVERASK',
    };
  }

  return {
    grader: 'directness',
    passed: true,
    score: 1.0,
    details: `Direct response (${text.length} chars)`,
  };
}
