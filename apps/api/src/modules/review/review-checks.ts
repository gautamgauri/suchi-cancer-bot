/**
 * Review Copilot — Hard, Soft, and Ambiguous failure checks.
 *
 * Each check function receives a ReviewContext and returns an array of failures found.
 * Checks are deterministic (regex / string matching / DB lookups) — no LLM calls.
 */

export interface ReviewContext {
  responseText: string;
  userText: string;
  citations: Array<{ docId: string; chunkId: string; position: number; citationText: string }>;
  retrievedChunkIds: string[];
  retrievedDocIds: string[];
  intent?: string;
  safetyClassification?: string;
  evidenceQuality?: string;
  evidenceGatePassed?: boolean;
}

export interface HardFailure {
  id: string;
  type: string;
  detail: string;
}

export interface SoftFailure {
  id: string;
  type: string;
  detail: string;
  repair?: { type: string; patch: string };
}

export interface AmbiguousFlag {
  id: string;
  type: string;
  detail: string;
  reason: string;
}

export type ReviewVerdict = 'PASS' | 'REPAIRED' | 'BLOCKED' | 'FLAGGED';

export interface ReviewResult {
  verdict: ReviewVerdict;
  hardFailures: HardFailure[];
  softFailures: SoftFailure[];
  ambiguousFlags: AmbiguousFlag[];
  patchesApplied: Array<{ type: string; before: string; after: string; confidence: number }>;
  repairedText: string | null;
  originalText: string | null;
  reviewLatencyMs: number;
}

// ─── Diagnosis language patterns (response-side) ────────────────────────────
const DIAGNOSIS_LANGUAGE_PATTERNS = [
  /you (definitely|certainly|clearly) have/i,
  /this (is|means) cancer/i,
  /it is (definitely|certainly) (cancer|malignant)/i,
  /confirm(s|ed)?\s+(that\s+)?(you\s+have\s+)?cancer/i,
  /you have (been diagnosed with|cancer|a tumor|a malignant)/i,
  /your diagnosis is/i,
  /based on (your|the) (symptoms|results),?\s+(you have|this is)/i,
];

// ─── Dosing / prescription patterns (response-side) ─────────────────────────
const DOSING_PATTERNS = [
  /take\s+\d+\s*(mg|ml|mcg|units?|tablets?|capsules?|pills?)/i,
  /\d+\s*(mg|ml|mcg)\s*(once|twice|thrice|\d+\s*times)\s*(a\s+)?(day|daily|weekly)/i,
  /recommended\s+dose\s+(is|of)\s+\d+/i,
  /you\s+should\s+take\s+\d+/i,
  /prescribe\s+\d+\s*(mg|ml)/i,
  /dosage\s*:\s*\d+\s*(mg|ml)/i,
  /administer\s+\d+\s*(mg|ml|units?)/i,
];

// ─── Emergency keywords for escalation check ────────────────────────────────
const EMERGENCY_KEYWORDS = [
  /vomiting\s+blood/i,
  /uncontrolled\s+bleeding/i,
  /severe\s+chest\s+pain/i,
  /can'?t\s+breathe/i,
  /seizure/i,
  /unconscious/i,
  /collapsed/i,
  /anaphylax/i,
  /coughing\s+(up\s+)?blood/i,
];

const ESCALATION_PHRASES = [
  /seek\s+(emergency|immediate|urgent)\s+(medical\s+)?(care|attention|help)/i,
  /call\s+(112|108|911|emergency)/i,
  /go\s+to\s+(the\s+)?(nearest\s+)?(emergency|hospital|ER)/i,
  /medical\s+emergency/i,
];

// ─── Medical content detection ──────────────────────────────────────────────
const MEDICAL_CONTENT_PATTERNS = [
  /\b(symptom|treatment|chemotherapy|radiation|surgery|immunotherapy|biopsy|tumor|malignant|benign|metasta|oncolog|carcinoma|lymphoma|leukemia|sarcoma)\b/i,
  /\b(screening|mammogram|colonoscopy|pap\s+smear|MRI|CT\s+scan|PET\s+scan)\b/i,
  /\b(side\s+effect|nausea|fatigue|hair\s+loss|neutropenia|anemia)\b/i,
  /\b(stage\s+[0-4IV]+|prognosis|survival\s+rate|remission|recurrence)\b/i,
  /\b(BRCA|HER2|estrogen\s+receptor|biomarker|genetic\s+test)\b/i,
];

// ─── Disclaimer patterns ────────────────────────────────────────────────────
const DISCLAIMER_PATTERNS = [
  /not\s+(a\s+)?diagnosis/i,
  /can'?t\s+diagnose/i,
  /cannot\s+diagnose/i,
  /not\s+medical\s+advice/i,
  /consult\s+(with\s+)?(your\s+)?(healthcare\s+provider|doctor|clinician|oncologist)/i,
  /see\s+(a|your)\s+(doctor|clinician|oncologist)/i,
  /talk\s+to\s+(a|your)\s+(doctor|clinician|oncologist)/i,
  /seek\s+medical\s+(evaluation|care|attention|help)/i,
  /discuss\s+with\s+(your\s+)?(healthcare|doctor|clinician|oncologist)/i,
  /verify\s+with\s+(your\s+)?(healthcare|doctor|clinician)/i,
  /please\s+note/i,
];

// ─── Citation format pattern ────────────────────────────────────────────────
const CITATION_PATTERN = /\[citation:([^\]]+):([^\]]+)\]/g;

// ─── Over-escalation detection ──────────────────────────────────────────────
const SAFE_FALLBACK_PATTERNS = [
  /I don'?t have enough.*information/i,
  /consult\s+(with\s+)?(your\s+)?healthcare\s+provider/i,
  /speak\s+with\s+your\s+(doctor|oncologist)/i,
];

const ANSWERABLE_INTENTS = [
  'INFORMATIONAL_GENERAL',
  'INFORMATIONAL_SYMPTOMS',
  'INFORMATIONAL_TREATMENT',
  'INFORMATIONAL_SIDE_EFFECTS',
  'INFORMATIONAL_SCREENING',
  'INFORMATIONAL_PREVENTION',
];

/**
 * HF-1: Ungrounded medical claim — medical content with 0 valid citations
 */
export function checkHF1_UngroundedMedicalClaim(ctx: ReviewContext): HardFailure | null {
  const hasMedicalContent = MEDICAL_CONTENT_PATTERNS.some(p => p.test(ctx.responseText));
  if (!hasMedicalContent) return null;

  // Check if response has any citations at all
  const citationMatches = ctx.responseText.match(CITATION_PATTERN);
  if (citationMatches && citationMatches.length >= 1) return null;

  // Also accept if citations were passed separately (database-stored)
  if (ctx.citations.length >= 1) return null;

  return {
    id: 'HF-1',
    type: 'ungrounded_medical_claim',
    detail: 'Response contains medical content but has 0 valid citations',
  };
}

/**
 * HF-2: Diagnosis language — "You have cancer", "This is malignant", etc.
 */
export function checkHF2_DiagnosisLanguage(ctx: ReviewContext): HardFailure | null {
  for (const pattern of DIAGNOSIS_LANGUAGE_PATTERNS) {
    const match = ctx.responseText.match(pattern);
    if (match) {
      return {
        id: 'HF-2',
        type: 'diagnosis_language',
        detail: `Response contains diagnosis language: "${match[0]}"`,
      };
    }
  }
  return null;
}

/**
 * HF-3: Dosing / prescription — specific drug doses in response
 */
export function checkHF3_DosingPrescription(ctx: ReviewContext): HardFailure | null {
  for (const pattern of DOSING_PATTERNS) {
    const match = ctx.responseText.match(pattern);
    if (match) {
      return {
        id: 'HF-3',
        type: 'dosing_prescription',
        detail: `Response contains dosing/prescription language: "${match[0]}"`,
      };
    }
  }
  return null;
}

/**
 * HF-4: Fabricated citation — citation ID doesn't match any retrieved chunk
 */
export function checkHF4_FabricatedCitation(ctx: ReviewContext): HardFailure | null {
  const matches = [...ctx.responseText.matchAll(CITATION_PATTERN)];
  if (matches.length === 0) return null;

  const retrievedSet = new Set(ctx.retrievedChunkIds);
  const retrievedDocSet = new Set(ctx.retrievedDocIds);

  for (const match of matches) {
    const docId = match[1];
    const chunkId = match[2];
    // Check if either the chunk or the doc is in the retrieved set
    if (!retrievedSet.has(chunkId) && !retrievedDocSet.has(docId)) {
      return {
        id: 'HF-4',
        type: 'fabricated_citation',
        detail: `Citation [citation:${docId}:${chunkId}] not found in retrieved evidence`,
      };
    }
  }
  return null;
}

/**
 * HF-6: Emergency bypass — response to emergency symptoms without escalation
 */
export function checkHF6_EmergencyBypass(ctx: ReviewContext): HardFailure | null {
  const hasEmergencyKeywords = EMERGENCY_KEYWORDS.some(p => p.test(ctx.userText));
  if (!hasEmergencyKeywords) return null;

  const hasEscalation = ESCALATION_PHRASES.some(p => p.test(ctx.responseText));
  if (hasEscalation) return null;

  // If safety already classified as red_flag, the safety module handled it
  if (ctx.safetyClassification === 'red_flag' || ctx.safetyClassification === 'self_harm') return null;

  return {
    id: 'HF-6',
    type: 'emergency_bypass',
    detail: 'User described emergency symptoms but response lacks escalation guidance',
  };
}

/**
 * HF-7: Contraindicated advice — advice against safety contract hard-NO areas in response
 */
export function checkHF7_ContraindicatedAdvice(ctx: ReviewContext): HardFailure | null {
  // Check if response recommends stopping evidence-based treatment
  const stopTreatmentPatterns = [
    /stop\s+(taking\s+)?(your\s+)?(chemotherapy|chemo|radiation|medication|treatment)/i,
    /discontinue\s+(your\s+)?(chemotherapy|chemo|radiation|medication|treatment)/i,
    /you\s+(don'?t\s+need|should\s+stop|can\s+stop)\s+(your\s+)?(chemo|radiation|treatment)/i,
  ];

  for (const pattern of stopTreatmentPatterns) {
    const match = ctx.responseText.match(pattern);
    if (match) {
      return {
        id: 'HF-7',
        type: 'contraindicated_advice',
        detail: `Response suggests stopping treatment: "${match[0]}"`,
      };
    }
  }

  // Check if response promotes alternative-only cures
  const altOnlyPatterns = [
    /\b(turmeric|haldi|neem|tulsi|giloy|ashwagandha)\s+(can|will)\s+(cure|treat|eliminate)\s+cancer\b/i,
    /\b(alkaline|keto|fasting)\s+(diet\s+)?(can|will)\s+(cure|treat)\s+cancer\b/i,
    /\bnatural\s+(cure|remedy)\s+for\s+cancer\b/i,
  ];

  for (const pattern of altOnlyPatterns) {
    const match = ctx.responseText.match(pattern);
    if (match) {
      return {
        id: 'HF-7',
        type: 'contraindicated_advice',
        detail: `Response promotes unproven alternative cure: "${match[0]}"`,
      };
    }
  }

  return null;
}

/**
 * SF-1: Missing disclaimer — no "consult your doctor" / "not medical advice"
 */
export function checkSF1_MissingDisclaimer(ctx: ReviewContext): SoftFailure | null {
  const hasMedicalContent = MEDICAL_CONTENT_PATTERNS.some(p => p.test(ctx.responseText));
  if (!hasMedicalContent) return null;

  const hasDisclaimer = DISCLAIMER_PATTERNS.some(p => p.test(ctx.responseText));
  if (hasDisclaimer) return null;

  return {
    id: 'SF-1',
    type: 'missing_disclaimer',
    detail: 'Medical response lacks disclaimer or consult-your-doctor language',
    repair: {
      type: 'append_disclaimer',
      patch: '\n\n*Please consult with your healthcare provider for personalized medical advice.*',
    },
  };
}

/**
 * SF-2: Citation format error — malformed citation markers
 */
export function checkSF2_CitationFormatError(ctx: ReviewContext): SoftFailure | null {
  // Look for malformed citations: [citation: missing parts or extra spaces
  const malformedPatterns = [
    /\[citation\s*:\s*\]/g,                    // empty citation
    /\[citation\s*:[^\]]*\s*\]/g,              // all citation-like markers
  ];

  const wellFormed = CITATION_PATTERN;
  const allCitationLike = /\[citation[^\]]*\]/g;
  const allMatches = ctx.responseText.match(allCitationLike) || [];
  const wellFormedMatches = ctx.responseText.match(wellFormed) || [];

  if (allMatches.length > wellFormedMatches.length) {
    return {
      id: 'SF-2',
      type: 'citation_format_error',
      detail: `Found ${allMatches.length - wellFormedMatches.length} malformed citation(s)`,
    };
  }

  return null;
}

/**
 * SF-6: Excessive length — response >800 words for simple query
 */
export function checkSF6_ExcessiveLength(ctx: ReviewContext): SoftFailure | null {
  const wordCount = ctx.responseText.split(/\s+/).length;
  if (wordCount <= 800) return null;

  return {
    id: 'SF-6',
    type: 'excessive_length',
    detail: `Response is ${wordCount} words (limit: 800)`,
  };
}

/**
 * AF-1: Over-escalation — every query gets "consult your doctor" without answering
 */
export function checkAF1_OverEscalation(ctx: ReviewContext): AmbiguousFlag | null {
  if (!ctx.intent || !ANSWERABLE_INTENTS.includes(ctx.intent)) return null;

  // Check if evidence was sufficient
  if (ctx.evidenceQuality === 'insufficient' || !ctx.evidenceGatePassed) return null;

  // Check if response is basically just a safe fallback
  const isSafeFallback = SAFE_FALLBACK_PATTERNS.some(p => p.test(ctx.responseText));
  if (!isSafeFallback) return null;

  // Response is just a fallback but we had good evidence — over-escalation
  return {
    id: 'AF-1',
    type: 'over_escalation',
    detail: 'SafeFallbackResponse returned for answerable general-info query with sufficient evidence',
    reason: 'Evidence was available but response defaulted to consult-your-doctor',
  };
}

/**
 * AF-6: Implicit diagnosis — doesn't say "you have X" but implies it
 */
export function checkAF6_ImplicitDiagnosis(ctx: ReviewContext): AmbiguousFlag | null {
  const implicitPatterns = [
    /this\s+(suggests|indicates|points\s+to|is\s+consistent\s+with)\s+(a\s+)?(cancer|tumor|malignant|malignancy)/i,
    /your\s+(symptoms|results)\s+(are\s+)?(consistent\s+with|suggestive\s+of|typical\s+of)\s+(a\s+)?(cancer|tumor|malignancy)/i,
    /likely\s+(to\s+be|a|an)\s+(cancer|tumor|malignant)/i,
    /most\s+likely\s+(cancer|tumor|malignant)/i,
  ];

  for (const pattern of implicitPatterns) {
    const match = ctx.responseText.match(pattern);
    if (match) {
      return {
        id: 'AF-6',
        type: 'implicit_diagnosis',
        detail: `Response may imply diagnosis: "${match[0]}"`,
        reason: 'Phrasing could be interpreted as diagnostic — needs human review',
      };
    }
  }

  return null;
}

/**
 * Run all hard-failure checks. Returns on first failure (fail-fast).
 */
export function runHardChecks(ctx: ReviewContext): HardFailure[] {
  const checks = [
    checkHF1_UngroundedMedicalClaim,
    checkHF2_DiagnosisLanguage,
    checkHF3_DosingPrescription,
    checkHF4_FabricatedCitation,
    checkHF6_EmergencyBypass,
    checkHF7_ContraindicatedAdvice,
  ];

  const failures: HardFailure[] = [];
  for (const check of checks) {
    const result = check(ctx);
    if (result) failures.push(result);
  }
  return failures;
}

/**
 * Run all soft-failure checks.
 */
export function runSoftChecks(ctx: ReviewContext): SoftFailure[] {
  const checks = [
    checkSF1_MissingDisclaimer,
    checkSF2_CitationFormatError,
    checkSF6_ExcessiveLength,
  ];

  const failures: SoftFailure[] = [];
  for (const check of checks) {
    const result = check(ctx);
    if (result) failures.push(result);
  }
  return failures;
}

/**
 * Run all ambiguous-flag checks.
 */
export function runAmbiguousChecks(ctx: ReviewContext): AmbiguousFlag[] {
  const checks = [
    checkAF1_OverEscalation,
    checkAF6_ImplicitDiagnosis,
  ];

  const flags: AmbiguousFlag[] = [];
  for (const check of checks) {
    const result = check(ctx);
    if (result) flags.push(result);
  }
  return flags;
}
