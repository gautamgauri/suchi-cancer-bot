/**
 * Agentic Intent Router
 * Phase 1: Maps inbound messages to 6 high-level intent categories
 * with confidence scoring. Two-stage: rule-based fast path + existing
 * IntentClassifier for detailed classification.
 *
 * Categories (from implementation plan):
 *   EMERGENCY    — Immediate medical crisis
 *   NAVIGATION   — Care pathway guidance
 *   SCHEMES      — Government scheme eligibility
 *   PSYCHOSOCIAL — Emotional distress or support
 *   ADMIN        — Appointment, logistics, documents
 *   EDUCATION    — General cancer information
 */

import { IntentType } from "./intent-classifier";

export type AgenticCategory =
  | "EMERGENCY"
  | "NAVIGATION"
  | "SCHEMES"
  | "PSYCHOSOCIAL"
  | "ADMIN"
  | "EDUCATION";

export interface AgenticIntentResult {
  /** High-level category for routing */
  category: AgenticCategory;
  /** Original detailed intent type (preserved for downstream use) */
  detailedIntent: IntentType | null;
  /** Confidence 0-1 */
  confidence: number;
  /** Why this category was chosen */
  reasoning: string;
  /** True if classified by rule-based fast path (no LLM needed) */
  isRuleBased: boolean;
}

// ─── Rule-based patterns per category ───────────────────────────────

const EMERGENCY_PATTERNS: RegExp[] = [
  // English
  /\b(uncontrolled|severe|heavy)\s+(bleeding|hemorrhag)/i,
  /\bbleeding\s+(won'?t|doesn'?t)\s+stop/i,
  /\b(vomiting|coughing)\s+(up\s+)?blood\b/i,
  /\b(can'?t|cannot|unable to)\s+breathe?\b/i,
  /\bsevere\s+chest\s+pain\b/i,
  /\b(fainted|unconscious|seizure|collapsed)\b/i,
  /\bheart\s+attack\b/i,
  /\bstroke\b/i,
  /\b(108|112)\s*(call|bula)/i,
  /\bambulance\b/i,
  // Hindi
  /खून\s*(बहुत|ज़्यादा)\s*(आ|बह)/i,
  /सांस\s*नहीं\s*(आ|ले)/i,
  /बेहोश/i,
  /छाती\s*(में)?\s*(बहुत|तेज)\s*दर्द/i,
  /एम्बुलेंस/i,
  // Hinglish
  /\b(khoon|khun)\s*(bahut|zyada)\b/i,
  /\bsaans?\s*nahi/i,
  /\bbehosh\b/i,
];

const SCHEMES_PATTERNS: RegExp[] = [
  // Government schemes — English
  /\b(ayushman|pmjay|pm-jay|pradhan\s+mantri)\b/i,
  /\b(government|govt|sarkari)\s+(scheme|yojana|hospital|help|assistance)\b/i,
  /\b(bpl|below\s+poverty)\b/i,
  /\b(financial|money|cost|afford|free|subsidized)\s+(help|assistance|support|treatment)\b/i,
  /\b(rashtriya|swasthya|bima|arogya)\b/i,
  /\b(health\s+insurance|bima)\b.*\b(cancer|ilaj)\b/i,
  /\bhow\s+(much|to)\s+(apply|get|avail)\b.*\b(scheme|card|yojana)\b/i,
  // Hindi
  /आयुष्मान/i,
  /सरकारी\s*(योजना|स्कीम|मदद|सहायता)/i,
  /गरीबी\s*रेखा/i,
  /पैसे?\s*(का|की|के)?\s*(मदद|सहायता|इंतज़ाम)/i,
  /कार्ड\s*(कैसे|बनवा|बनेगा)/i,
  // Hinglish
  /\b(ayushman|sarkaari|sarkari)\s*(card|scheme|yojana)\b/i,
  /\b(paisa|paise|money)\s*(ki|ka|ke)\s*(madad|help|problem)\b/i,
  /\bcard\s+kaise\s+(banega|banvaye|milega)\b/i,
];

const PSYCHOSOCIAL_PATTERNS: RegExp[] = [
  // Crisis
  /\b(want to die|end it all|kill myself|suicid|no point in living)\b/i,
  /\b(harm myself|self[- ]?harm|cut myself)\b/i,
  // Emotional distress — English
  /\b(depressed|depression|hopeless|overwhelmed|can'?t cope|breaking down)\b/i,
  /\b(scared|terrified|anxiety|panic)\b.*\b(cancer|diagnosis|treatment)\b/i,
  /\b(feel|feeling)\s+(so\s+)?(alone|isolated|lonely|lost|helpless)\b/i,
  /\b(need\s+someone|need\s+support|who\s+do\s+i\s+talk)\b/i,
  /\b(support\s+group|counselor|counselling|therapy|therapist)\b/i,
  /\bhow\s+do\s+i\s+tell\b.*\b(children|family|kids|spouse)\b/i,
  // Hindi
  /बहुत\s*(डर|डरा|चिंता|तनाव|अकेला)/i,
  /मन\s*(नहीं|बहुत\s*भारी)/i,
  /कैसे\s*बताऊं/i,
  /हिम्मत\s*(नहीं|टूट)/i,
  // Hinglish
  /\b(bahut|bht)\s*(dar|darr|tension|akela)\b/i,
  /\bkisse\s+baat\s+kar[uo]n?\b/i,
];

const ADMIN_PATTERNS: RegExp[] = [
  // Logistics — English
  /\b(opd|outpatient)\s*(timing|time|hours|schedule)\b/i,
  /\b(appointment|registration)\s*(book|schedule|how|process)\b/i,
  /\b(which\s+floor|where\s+is|location\s+of)\s*(oncology|chemo|radiation|cancer)\b/i,
  /\b(visiting\s+hours|parking|canteen|cafeteria)\b/i,
  /\b(documents?|papers?)\s+(need|required|bring|carry)\b/i,
  /\b(referral|transfer)\s+(letter|process|how)\b/i,
  // Hindi
  /ओपीडी\s*(का\s*)?(समय|टाइम|कब)/i,
  /अपॉइंटमेंट\s*(कैसे|बुक|लें)/i,
  /कौन\s*सा?\s*(फ्लोर|तल्ला|मंज़िल)/i,
  /कागज़ात|दस्तावेज़/i,
  // Hinglish
  /\bopd\s*(ka|ki|ke)\s*(time|samay|timing)\b/i,
  /\bappointment\s*(kaise|book|le)\b/i,
  /\bkaun\s*sa\s*floor\b/i,
];

const NAVIGATION_PATTERNS: RegExp[] = [
  // Care pathway — English
  /\b(which|best|nearest|good)\s+(hospital|doctor|oncologist|cancer\s+center)\b/i,
  /\b(where|how)\s+(should|can|do)\s+(we|i)\s+(go|get\s+treated)\b/i,
  /\b(biopsy|report)\s*(aaya|aya|came|received)\b.*\b(aage|next|kya)\b/i,
  /\b(second\s+opinion|another\s+doctor)\b/i,
  /\b(prepare|preparation)\s+(for|before)\s+(visit|appointment|chemo|surgery|radiation)\b/i,
  /\b(what\s+to)\s+(expect|bring|prepare)\s+(for|at|before)\b/i,
  /\b(caregiver|caregiving|taking\s+care)\b/i,
  // Hospital search with location
  /\b(hospital|doctor|treatment)\s+(in|near|at)\s+\w+/i,
  /\b(patna|bihar|delhi|mumbai|kolkata|chennai|bangalore|hyderabad|gaya|muzaffarpur|bhagalpur)\b.*\b(hospital|doctor|cancer|oncolog)/i,
  // Hindi
  /\b(कौन\s*सा|सबसे\s*अच्छा|नज़दीकी)\s*(हॉस्पिटल|अस्पताल|डॉक्टर)\b/i,
  /बायोप्सी\s*(रिपोर्ट)?\s*(आया|आई|मिला)/i,
  /आगे\s*क्या\s*(करना|करें|होगा)/i,
  // Hinglish
  /\b(kaun\s*sa|sabse\s*acha|nearest)\s*(hospital|doctor)\b/i,
  /\b(biopsy|report)\s*(aaya|aa\s*gaya|mil\s*gaya)\b/i,
  /\baage\s*kya\s*(karna|kare|hoga)\b/i,
];

// ─── Category mapping from detailed IntentType ────────────────────

const INTENT_TO_CATEGORY: Record<string, AgenticCategory> = {
  // Emergency
  SYMPTOMS_URGENT_RED_FLAGS: "EMERGENCY",
  SIDE_EFFECTS_POSSIBLY_URGENT: "EMERGENCY",
  ABSTENTION_WITH_RED_FLAGS: "EMERGENCY",

  // Psychosocial
  PSYCHOLOGICAL_CRISIS: "PSYCHOSOCIAL",
  MENTAL_HEALTH_SUPPORT: "PSYCHOSOCIAL",
  MENTAL_HEALTH_ISOLATION: "PSYCHOSOCIAL",

  // Navigation
  CARE_NAVIGATION_PROVIDER_CHOICE: "NAVIGATION",
  CARE_NAVIGATION_SECOND_OPINION: "NAVIGATION",
  CAREGIVER_NAVIGATION: "NAVIGATION",
  PERSONAL_SYMPTOMS: "NAVIGATION",
  PREVENTION_SCREENING_INFO: "NAVIGATION",

  // Education
  INFORMATIONAL_GENERAL: "EDUCATION",
  INFORMATIONAL_SYMPTOMS: "EDUCATION",
  SIDE_EFFECTS_GENERAL: "EDUCATION",
  TREATMENT_OPTIONS_GENERAL: "EDUCATION",
  REPORT_TEXT_PROVIDED: "EDUCATION",
  REPORT_REQUEST_NO_TEXT: "EDUCATION",

  // Admin (greeting, unclear, etc.)
  GREETING_ONLY: "ADMIN",
  UNCLEAR_REQUEST: "ADMIN",
  REQUEST_OUT_OF_SCOPE: "ADMIN",

  // Fallback
  SAFETY_RESTRICTED: "EDUCATION",
  INSUFFICIENT_EVIDENCE: "EDUCATION",
  MISSING_CONTEXT: "EDUCATION",
  CONFLICTING_INFO: "EDUCATION",
  TECHNICAL_FAILURE: "ADMIN",
};

// ─── Public API ───────────────────────────────────────────────────

/**
 * Stage 1: Rule-based fast path classification.
 * Returns a category if patterns match with high confidence.
 * Returns null if ambiguous (should proceed to Stage 2 / LLM classifier).
 */
export function classifyFastPath(userText: string): AgenticIntentResult | null {
  const text = userText.trim();

  // EMERGENCY — highest priority, always checked first
  const emergencyMatches = EMERGENCY_PATTERNS.filter((re) => re.test(text));
  if (emergencyMatches.length > 0) {
    return {
      category: "EMERGENCY",
      detailedIntent: null,
      confidence: 1.0,
      reasoning: `Emergency pattern matched (${emergencyMatches.length} patterns)`,
      isRuleBased: true,
    };
  }

  // PSYCHOSOCIAL — crisis patterns (second highest priority)
  const psychoMatches = PSYCHOSOCIAL_PATTERNS.filter((re) => re.test(text));
  if (psychoMatches.length > 0) {
    // Higher confidence for crisis indicators
    const isCrisis = /\b(want to die|kill myself|suicid|harm myself|self[- ]?harm)\b/i.test(text);
    return {
      category: "PSYCHOSOCIAL",
      detailedIntent: null,
      confidence: isCrisis ? 1.0 : 0.85,
      reasoning: `Psychosocial pattern matched (${psychoMatches.length} patterns, crisis=${isCrisis})`,
      isRuleBased: true,
    };
  }

  // SCHEMES — specific enough to classify by rules
  const schemesMatches = SCHEMES_PATTERNS.filter((re) => re.test(text));
  if (schemesMatches.length >= 1) {
    return {
      category: "SCHEMES",
      detailedIntent: null,
      confidence: schemesMatches.length >= 2 ? 0.95 : 0.8,
      reasoning: `Schemes pattern matched (${schemesMatches.length} patterns)`,
      isRuleBased: true,
    };
  }

  // ADMIN — logistics patterns
  const adminMatches = ADMIN_PATTERNS.filter((re) => re.test(text));
  if (adminMatches.length >= 1) {
    return {
      category: "ADMIN",
      detailedIntent: null,
      confidence: adminMatches.length >= 2 ? 0.9 : 0.75,
      reasoning: `Admin pattern matched (${adminMatches.length} patterns)`,
      isRuleBased: true,
    };
  }

  // NAVIGATION — care pathway patterns
  const navMatches = NAVIGATION_PATTERNS.filter((re) => re.test(text));
  if (navMatches.length >= 1) {
    return {
      category: "NAVIGATION",
      detailedIntent: null,
      confidence: navMatches.length >= 2 ? 0.9 : 0.75,
      reasoning: `Navigation pattern matched (${navMatches.length} patterns)`,
      isRuleBased: true,
    };
  }

  // No strong match — return null to proceed to Stage 2
  return null;
}

/**
 * Stage 2: Map a detailed IntentType (from existing IntentClassifier) to
 * an agentic category. Used when Stage 1 returns null.
 */
export function mapDetailedIntentToCategory(
  detailedIntent: IntentType,
  confidence: "high" | "medium" | "low"
): AgenticIntentResult {
  const category = INTENT_TO_CATEGORY[detailedIntent] || "EDUCATION";
  const numericConfidence =
    confidence === "high" ? 0.9 : confidence === "medium" ? 0.7 : 0.5;

  return {
    category,
    detailedIntent,
    confidence: numericConfidence,
    reasoning: `Mapped from detailed intent ${detailedIntent} (confidence: ${confidence})`,
    isRuleBased: false,
  };
}

/**
 * Full two-stage classification.
 * Stage 1: Rule-based fast path (sub-1ms)
 * Stage 2: Falls back to mapping from detailed IntentClassifier result
 */
export function classifyAgenticIntent(
  userText: string,
  detailedIntent?: IntentType,
  detailedConfidence?: "high" | "medium" | "low"
): AgenticIntentResult {
  // Stage 1: Rule-based fast path
  const fastResult = classifyFastPath(userText);
  if (fastResult && fastResult.confidence >= 0.7) {
    return fastResult;
  }

  // Stage 2: Map from detailed intent if available
  if (detailedIntent && detailedConfidence) {
    const mappedResult = mapDetailedIntentToCategory(detailedIntent, detailedConfidence);

    // If fast path had a partial match, use it to boost confidence
    if (fastResult) {
      // Take the category with higher confidence
      if (fastResult.confidence > mappedResult.confidence) {
        return { ...fastResult, detailedIntent };
      }
    }

    return mappedResult;
  }

  // No information available — default to EDUCATION (safest default)
  return {
    category: "EDUCATION",
    detailedIntent: null,
    confidence: 0.3,
    reasoning: "No patterns matched and no detailed intent provided; defaulting to EDUCATION",
    isRuleBased: false,
  };
}
