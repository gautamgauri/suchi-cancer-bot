import { ApiTrace, DatasetRow, GradeResult } from '../types';

const SYMPTOM_SECTIONS = [
  { pattern: /(?:symptom|sign|warning|look out|watch for)/i, label: 'symptoms mentioned' },
  { pattern: /(?:when to seek|see a doctor|consult.*doctor|medical attention|seek care)/i, label: 'when to seek care' },
  { pattern: /(?:question.*(?:ask|doctor)|ask.*doctor)/i, label: 'questions to ask' },
];

const SCREENING_SECTIONS = [
  { pattern: /(?:mammogram|pap smear|colonoscop|screen|test|PSA)/i, label: 'screening method' },
  { pattern: /(?:age|year|start|begin|frequency|every \d)/i, label: 'age/frequency guidance' },
  { pattern: /(?:consult|doctor|healthcare|provider)/i, label: 'provider recommendation' },
];

const TRIAGE_SECTIONS = [
  { pattern: /(?:next step|should.*do|action|see.*doctor|visit|appointment)/i, label: 'action steps' },
  { pattern: /(?:don't panic|normal|common|not necessarily|doesn't always)/i, label: 'reassurance' },
  { pattern: /(?:consult|doctor|healthcare|specialist)/i, label: 'professional referral' },
];

export function gradeCompleteness(trace: ApiTrace, row: DatasetRow): GradeResult {
  if (trace.error || trace.abstentionReason) {
    return {
      grader: 'completeness',
      passed: false,
      score: 0,
      details: trace.error ? 'API error' : `Abstained (${trace.abstentionReason})`,
      reason: 'COMPLETE_MISSING_SECTION',
    };
  }

  const text = trace.responseText;
  let sections: { pattern: RegExp; label: string }[];

  if (row.intent === 'symptoms') {
    sections = SYMPTOM_SECTIONS;
  } else if (row.intent === 'screening') {
    sections = SCREENING_SECTIONS;
  } else if (row.intent === 'triage') {
    sections = TRIAGE_SECTIONS;
  } else {
    // For other intents, just check basic substance
    const isSubstantive = text.length > 150;
    return {
      grader: 'completeness',
      passed: isSubstantive,
      score: isSubstantive ? 0.8 : 0.3,
      details: isSubstantive ? 'Substantive response' : 'Short/thin response',
    };
  }

  const found = sections.filter((s) => s.pattern.test(text));
  const missing = sections.filter((s) => !s.pattern.test(text));
  const score = found.length / sections.length;

  return {
    grader: 'completeness',
    passed: score >= 0.5,
    score,
    details: `${found.length}/${sections.length} expected sections: ` +
      `found=[${found.map((s) => s.label).join(', ')}]` +
      (missing.length > 0 ? ` missing=[${missing.map((s) => s.label).join(', ')}]` : ''),
    reason: score < 0.5 ? 'COMPLETE_MISSING_SECTION' : undefined,
  };
}
