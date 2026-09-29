/**
 * Emergency Fast-Path Router
 * Phase 1: Deterministic Shell component
 *
 * Pure regex-based emergency detection designed for sub-100ms response.
 * Zero LLM calls. This is the first thing evaluated on every inbound message.
 *
 * Supports: English, Hindi, Bhojpuri, and mixed-language (Hinglish) inputs.
 */

import { normalizeForMatch } from "./text-normalizer";

export interface EmergencyFastPathResult {
  isEmergency: boolean;
  severity: "critical" | "urgent" | "none";
  matchedPatterns: string[];
  responseText: string | null;
  /** Confidence 0-1; rule-based always returns 1.0 for matched patterns */
  confidence: number;
}

/** Anything with a `.test(text)` — a RegExp, or a compound rule built from several. */
interface Matcher {
  test(text: string): boolean;
}

// ─── Issue #81: romanised-Hindi / Devanagari building blocks ─────────────
//
// Devanagari has no `\b` in JS regex (it is ASCII-only), so Devanagari pieces
// are written without word boundaries, as in the Hindi patterns below.
// The nukta in ज़ may arrive precomposed (U+095B) or decomposed (ज + U+093C);
// NFC always decomposes it, so both spellings are accepted.

/** Hinglish "very / too much" — but not "bahut kam" (very little) / "zyada nahi" (not much). */
const HI_MUCH = String.raw`(?:bahut|bohot|bahot|bhot|bht|zyada|jyada|jada|zyaada|jyaada|jaada|zada)\b(?!\s+(?:kam|nahi|nahin|nhi)\b)`;
const DV_ZYADA = "(?:ज़?|ज़)्यादा";
/** Devanagari "very / too much", with the same "very little / not much" exclusion. */
const DV_MUCH = `(?:बहुत|${DV_ZYADA}|जादा)(?!\\s*(?:कम|नहीं))`;
const DV_BLEED = "(?:खून|ब्लीडिंग|रक्तस्राव)";

/** "bleeding bahut zyada", "khoon aaj bahut" — noun then intensifier within two words. */
const SEVERE_BLEEDING_LOANWORD_HINGLISH = new RegExp(`\\b(?:bleeding|khoon|khun)\\b(?:\\s+\\S+){0,2}?\\s+${HI_MUCH}`, "i");
/** "bahut zyada bleeding" — intensifier then the loanword. */
const SEVERE_BLEEDING_LOANWORD_HINGLISH_PRE = new RegExp(`\\b${HI_MUCH}\\s+(?:\\S+\\s+)?bleeding\\b`, "i");
/** "ब्लीडिंग बहुत ज़्यादा", "खून बहुत ज्यादा निकल रहा" — covers what severe_bleeding_hi misses. */
const SEVERE_BLEEDING_HI_2 = new RegExp(`${DV_BLEED}(?:\\s+\\S+)?\\s*${DV_MUCH}`);
/** "बहुत ज़्यादा ब्लीडिंग", "बहुत खून बह गया". */
const SEVERE_BLEEDING_HI_2_PRE = new RegExp(`${DV_MUCH}\\s*(?:\\S+\\s*)?(?:ब्लीडिंग|रक्तस्राव)|${DV_MUCH}\\s*खून\\s*(?:आ|बह|निकल|गिर)`);
/** "bleeding ruk nahi rahi", "khoon rukta nahi", "bleeding band hi nahi ho rahi". */
const BLEEDING_NOT_STOPPING_HINGLISH_2 = /\b(?:bleeding|khoon|khun)\s+(?:ruk|band|thum|tham)\w*\s+(?:hi\s+)?(?:nahi|nahin|nhi|na)\b/i;
/** "ब्लीडिंग रुक नहीं रही", "खून बंद ही नहीं हो रहा". */
const BLEEDING_NOT_STOPPING_HI_2 = new RegExp(`${DV_BLEED}\\s*(?:रुक|बंद|थम)\\S*\\s*(?:ही\\s*)?नहीं`);

/**
 * Any report of bleeding, in any script. Excludes "khoon ki kami / jaanch / test"
 * (anaemia, blood test) — those are about blood, not bleeding.
 */
const ANY_BLEEDING: Matcher[] = [
  /\bbleed\w*|\bh(?:a)?emorrhag\w*/i,
  /\b(?:khoon|khun)\b(?!\s+(?:ki|ka|ke)\s+(?:kami|jaanch|janch|jach|test|report|group)\b)/i,
  /\bblood\s+(?:aa|a)\s+(?:raha|rahi|rahe|rha|rhi|gaya|gayi|gya|gyi)\b|\bblood\s+(?:nikal|beh|bah|gir)\w*/i,
  /खून(?!\s*(?:की|का|के)\s*(?:कमी|जा[ंँ]च|टेस्ट|रिपोर्ट))|ब्लीडिंग|रक्तस्राव/,
];

/**
 * Dizziness / near-fainting, in any script. "chakkar" only counts in its
 * dizziness sense ("chakkar aa raha", "chakkar khake gir gayi", "sir chakra
 * raha") — never as a trip or hassle ("chakkar lagana", "ke chakkar mein").
 */
const ANY_DIZZINESS: Matcher[] = [
  /\bchakk?a?r\s+(?:sa\s+|se\s+|bhi\s+)?(?:aa?|aata|ata|aati|ati|aate|ate|aaya|aya|aayi|ayi|aaye|aye|aane|ane)\b/i,
  /\bchakk?a?r\s+kha\w*/i,
  /\b(?:sir|sar)\s+(?:chakra|chakara|chakkar|ghum|ghoom)\w*/i,
  /\baa?nkh\w*\s+(?:ke\s+)?(?:aage|samne|saamne)\s+andhera/i,
  /\bbehosh\w*/i,
  /\b(?:dizz\w*|light[-\s]?headed\w*|giddy|giddiness|vertigo)\b/i,
  /\b(?:feel|feels|feeling|felt)\s+(?:like\s+)?faint\w*|\bfaint(?:ed|ing)?\b|\bpass(?:ed|ing)?\s+out\b/i,
  /चक्कर\s*(?:सा\s*|से\s*)?(?:आ|खा)|सिर\s*(?:घूम|चकरा)|बेहोश|आ[ँं]ख\S*\s*(?:के\s*)?(?:आगे|सामने)\s*अंधेरा/,
];

/** Bleeding AND dizziness / near-fainting in the same message (issue #81). */
const BLEEDING_WITH_DIZZINESS: Matcher = {
  test: (text: string) => ANY_BLEEDING.some((m) => m.test(text)) && ANY_DIZZINESS.some((m) => m.test(text)),
};

const CHEMO_TERM = "(?:\\b(?:chemo\\w*|kimo|kemo|keemo)\\b|कीमो)";
const FEVER_TERM = "(?:\\b(?:bukh?aa?r|fever)\\b|बुखार)";
/**
 * Fever with chemo in either order, any script — parity with chemo_fever_en,
 * which only saw English "chemo … fever" (issue #81 comment: Devanagari fever
 * with treatment context matched nothing).
 */
const CHEMO_FEVER_MULTILINGUAL = new RegExp(`${CHEMO_TERM}[\\s\\S]*${FEVER_TERM}|${FEVER_TERM}[\\s\\S]*${CHEMO_TERM}`, "i");
/** "तेज़ बुखार" / "बहुत बुखार" — high_fever_hi only saw the intensifier AFTER बुखार. */
const HIGH_FEVER_HI_PRE = new RegExp("(?:ते(?:ज़?|ज़)|बहुत)\\s*बुखार");

/**
 * Critical emergency patterns — life-threatening, route to 108/112 immediately.
 * Each entry: [regex, human-readable label for logging]
 */
const CRITICAL_PATTERNS: Array<[Matcher, string]> = [
  // English — bleeding
  [/\b(uncontrolled|severe|heavy|massive|won'?t stop)\s+(bleeding|hemorrhag)/i, "severe_bleeding_en"],
  [/\bbleeding\s+(won'?t|doesn'?t|does not|will not)\s+stop/i, "bleeding_wont_stop_en"],
  [/\bvomiting\s+blood\b/i, "vomiting_blood_en"],
  [/\bcoughing\s+(up\s+)?blood\b/i, "coughing_blood_en"],
  [/\bblood\s+in\s+(?:(?:his|her|my|the|their|your)\s+)?(stool|urine|vomit)\b/i, "blood_in_body_fluid_en"],

  // English — breathing
  [/\b(can'?t|cannot|unable to|difficulty|trouble|struggling to)\s+breathe?\b/i, "cant_breathe_en"],
  [/\bsevere\s+(shortness\s+of\s+)?breath/i, "severe_breathlessness_en"],
  [/\b(choking|suffocating|gasping)\b/i, "choking_en"],

  // English — cardiac
  [/\bsevere\s+chest\s+pain\b/i, "severe_chest_pain_en"],
  [/\bchest\s+pain\b.*\b(spreading|radiating|left arm)\b/i, "cardiac_chest_pain_en"],
  [/\bheart\s+attack\b/i, "heart_attack_en"],

  // English — consciousness
  [/\b(fainted|fainting|passed out|unconscious|unresponsive|collapsed)\b/i, "unconscious_en"],
  [/\b(seizure|convulsion|fitting)\b/i, "seizure_en"],
  [/\b(sudden|severe)\s+(confusion|disorientation)\b/i, "sudden_confusion_en"],

  // English — other critical
  [/\bsevere\s+allergic\s+reaction\b/i, "anaphylaxis_en"],
  [/\banaphylax/i, "anaphylaxis_term_en"],
  [/\b(stroke|paralysis|can'?t move|sudden numbness)\b/i, "stroke_en"],
  [/\bfever\s+above\s+(104|105|40|41)/i, "critical_fever_en"],

  // Hindi — bleeding
  [/खून\s*(बहुत|ज़्यादा|zyada|bahut)\s*(आ|बह)\s*रह/i, "severe_bleeding_hi"],
  [/खून\s*रुक\s*नहीं\s*रह/i, "bleeding_not_stopping_hi"],
  [/खून\s*की?\s*उल्टी/i, "vomiting_blood_hi"],
  [/उल्टी\s*में\s*खून/i, "blood_in_vomit_hi"],

  // Hindi — breathing
  [/सांस\s*नहीं\s*(आ|ले)\s*रह/i, "cant_breathe_hi"],
  [/सांस\s*(बहुत|ज़्यादा)?\s*(फूल|तकलीफ|मुश्किल)/i, "severe_breathlessness_hi"],
  [/दम\s*घुट\s*रह/i, "choking_hi"],

  // Hindi — cardiac/pain
  [/छाती\s*(में)?\s*(बहुत\s*)?(ज़्यादा|तेज)\s*दर्द/i, "severe_chest_pain_hi"],
  [/छाती\s*(में)?\s*बहुत\s+तेज\s*दर्द/i, "severe_chest_pain_hi_combo"],
  [/सीने\s*(में)?\s*(बहुत\s*)?(ज़्यादा|तेज)\s*दर्द/i, "severe_chest_pain_hi_2"],
  [/सीने\s*(में)?\s*बहुत\s+तेज\s*दर्द/i, "severe_chest_pain_hi_2_combo"],

  // Hindi — consciousness
  [/बेहोश\s*(हो\s*गय|हो\s*रह)/i, "unconscious_hi"],
  [/होश\s*नहीं/i, "unconscious_hi_2"],
  [/दौरा\s*(पड़|आ)\s*रह/i, "seizure_hi"],
  [/मिर्गी/i, "epilepsy_hi"],

  // Hinglish / transliterated
  [/\b(?:khoon|khun)\b.*\b(?:bahut|zyada|bht)\b|\b(?:bahut|zyada|bht)\b.*\b(?:khoon|khun)\b/i, "severe_bleeding_hinglish"],
  [/\b(?:khoon|khun)\b.*\b(?:turant|jaldi|abhi)\b|\b(?:turant|jaldi|abhi)\b.*\b(?:khoon|khun)\b/i, "urgent_bleeding_hinglish"],
  [/\b(khoon|khun)\s*(ruk|band)\s*nahi/i, "bleeding_not_stopping_hinglish"],
  [/\bsaans?\s*nahi\s*(aa|le)\s*raha/i, "cant_breathe_hinglish"],
  [/\bbehosh\b/i, "unconscious_hinglish"],
  [/\bseene?\s*(mein|me)\s*(bahut|zyada)?\s*(zyada|tez)\s*(dard|pain)/i, "chest_pain_hinglish"],
  [/\bseene?\s*(mein|me)\s*bahut\s+tez\s*(dard|pain)/i, "chest_pain_hinglish_combo"],

  // Issue #81 — heavy bleeding said with the loanword "bleeding", or with a
  // not-stopping verb the patterns above do not spell ("rukti nahi", "band hi
  // nahi"). Same meaning, same (critical) path as the khoon rules above.
  [SEVERE_BLEEDING_LOANWORD_HINGLISH, "severe_bleeding_loanword_hinglish"],
  [SEVERE_BLEEDING_LOANWORD_HINGLISH_PRE, "severe_bleeding_loanword_hinglish_pre"],
  [SEVERE_BLEEDING_HI_2, "severe_bleeding_hi_2"],
  [SEVERE_BLEEDING_HI_2_PRE, "severe_bleeding_hi_2_pre"],
  [BLEEDING_NOT_STOPPING_HINGLISH_2, "bleeding_not_stopping_hinglish_2"],
  [BLEEDING_NOT_STOPPING_HI_2, "bleeding_not_stopping_hi_2"],

  // Issue #81 — bleeding together with dizziness / near-fainting (possible
  // haemorrhage or shock during treatment). Each signal may be spelled in any
  // script; both must be present.
  [BLEEDING_WITH_DIZZINESS, "bleeding_with_dizziness_multilingual"],

  // Explicit emergency keywords
  [/\b(108|112)\s*(call|bula|phone)/i, "emergency_number_request"],
  [/\b(ambulance|एम्बुलेंस)\s*(bula|call|chahiye|bhej)/i, "ambulance_request"],
];

/**
 * Urgent patterns — needs medical attention soon but not immediately life-threatening.
 */
const URGENT_PATTERNS: Array<[Matcher, string]> = [
  // English
  [/\bfever\s+(above|over|more than)\s*(101|102|103|38|39)\b/i, "high_fever_en"],
  [/\b(chemo|chemotherapy)\s*.*\b(fever|infection|neutropeni)/i, "chemo_fever_en"],
  [/\bsevere\s+(pain|headache|vomiting|diarrhea|dehydration)\b/i, "severe_symptom_en"],
  [/\b(swollen|swelling)\s*(face|neck|arm|leg).*\b(sudden|rapidly)\b/i, "rapid_swelling_en"],
  [/\bsudden\s+(vision|hearing)\s+(loss|change|problem)\b/i, "sudden_sensory_loss_en"],
  [/\bblood\s+clots?\b/i, "blood_clot_en"],
  [/\b(can'?t|cannot|unable to)\s+(urinate|pass urine|pee)\b/i, "urinary_retention_en"],
  [/\b(dvt|deep\s+vein\s+thrombosis|pulmonary\s+embolism)\b/i, "thrombosis_en"],

  // Hindi
  [/बुखार\s*(बहुत|ज़्यादा|तेज)/i, "high_fever_hi"],
  [/कीमो\s*.*\s*(बुखार|इन्फेक्शन|infection)/i, "chemo_fever_hi"],
  [/(बहुत|ज़्यादा|तेज)\s*(दर्द|उल्टी|दस्त|सूजन)/i, "severe_symptom_hi"],

  // Hinglish
  [/\b(bukhar|bukhaar)\s*(bahut|zyada|tez)\b/i, "high_fever_hinglish"],
  [/\b(bahut|zyada|tez)\s*(dard|pain|sujan|swelling)\b/i, "severe_symptom_hinglish"],

  // Issue #81 — fever during chemo in romanised Hindi / Devanagari / either order
  [CHEMO_FEVER_MULTILINGUAL, "chemo_fever_multilingual"],
  [HIGH_FEVER_HI_PRE, "high_fever_hi_pre"],
];

/** The matchers added for issue #81, shared with AbstentionService.hasUrgencyIndicators. */
const ISSUE_81_MATCHERS: Matcher[] = [
  SEVERE_BLEEDING_LOANWORD_HINGLISH,
  SEVERE_BLEEDING_LOANWORD_HINGLISH_PRE,
  SEVERE_BLEEDING_HI_2,
  SEVERE_BLEEDING_HI_2_PRE,
  BLEEDING_NOT_STOPPING_HINGLISH_2,
  BLEEDING_NOT_STOPPING_HI_2,
  BLEEDING_WITH_DIZZINESS,
  CHEMO_FEVER_MULTILINGUAL,
];

/**
 * Test a matcher against the raw text AND its normalized copy (zero-width
 * characters removed, WhatsApp letter-elongation collapsed, NFC). Matching
 * either keeps this strictly broader than matching the raw text alone.
 */
function matchesEither(m: Matcher, raw: string, normalized: string): boolean {
  return m.test(raw) || (normalized !== raw && m.test(normalized));
}

/**
 * True when the message reports a romanised-Hindi / Devanagari red flag added
 * for issue #81 (heavy bleeding, bleeding + dizziness, fever during chemo).
 * Used by the S2 urgency layer so it agrees with the fast path.
 */
export function matchesIndicRedFlag(userText: string): boolean {
  const raw = (userText ?? "").trim();
  if (!raw) return false;
  const normalized = normalizeForMatch(raw);
  return ISSUE_81_MATCHERS.some((m) => matchesEither(m, raw, normalized));
}

/**
 * Emergency response template — structured, India-focused, multilingual-ready.
 */
function buildEmergencyResponse(severity: "critical" | "urgent", matchedPatterns: string[]): string {
  if (severity === "critical") {
    return `⚠️ **This sounds like a medical emergency.**

**Call for help NOW:**
• **112** — National emergency number (police, fire, ambulance)
• **108** — Free ambulance service (available in most states)
• **102** — Medical emergency helpline

**While waiting for help:**
• Do not move the person unnecessarily
• If breathing is difficult, keep them sitting upright
• If there is severe bleeding, apply gentle pressure with a clean cloth
• Keep the person calm and warm
• Note the time symptoms started — doctors will need this

**Bring to the hospital:**
• Aadhaar card / ID
• Current medications list
• Ayushman Bharat (PMJAY) card if available
• Any recent medical reports

**Important:** I am an information assistant, not a doctor. This is not a diagnosis. Please get emergency medical help immediately.`;
  }

  // Urgent (not immediately life-threatening)
  return `⚠️ **What you're describing needs prompt medical attention.**

**Contact your care team today:**
• Call your oncologist's office or hospital helpline
• If you cannot reach them, go to the nearest hospital OPD or emergency
• **108** — Free ambulance if needed
• **112** — National emergency number

**Before your visit, prepare:**
• List of current symptoms and when they started
• Current medications and dosages
• Recent medical reports or test results
• Aadhaar card and Ayushman Bharat (PMJAY) card if available

**Go to Emergency immediately if:**
• Fever above 101°F (38.3°C) during chemotherapy
• Bleeding that won't stop
• Sudden difficulty breathing
• Severe chest pain
• Loss of consciousness

**Important:** I am an information assistant, not a doctor. This is not a diagnosis. Please consult your healthcare provider promptly.`;
}

/**
 * Evaluate a user message for emergency indicators.
 * Returns in < 1ms for non-matches, < 5ms for matches.
 */
export function evaluateEmergencyFastPath(userText: string): EmergencyFastPathResult {
  const text = userText.trim();
  // Issue #81: also match a normalized copy, so zero-width characters and
  // WhatsApp elongation ("bahuttt", "chakkarrr") cannot hide a red flag.
  const normalized = normalizeForMatch(text);
  const matchedPatterns: string[] = [];

  // Check critical patterns first
  for (const [regex, label] of CRITICAL_PATTERNS) {
    if (matchesEither(regex, text, normalized)) {
      matchedPatterns.push(label);
    }
  }

  if (matchedPatterns.length > 0) {
    return {
      isEmergency: true,
      severity: "critical",
      matchedPatterns,
      responseText: buildEmergencyResponse("critical", matchedPatterns),
      confidence: 1.0,
    };
  }

  // Check urgent patterns
  for (const [regex, label] of URGENT_PATTERNS) {
    if (matchesEither(regex, text, normalized)) {
      matchedPatterns.push(label);
    }
  }

  if (matchedPatterns.length > 0) {
    return {
      isEmergency: true,
      severity: "urgent",
      matchedPatterns,
      responseText: buildEmergencyResponse("urgent", matchedPatterns),
      confidence: 1.0,
    };
  }

  return {
    isEmergency: false,
    severity: "none",
    matchedPatterns: [],
    responseText: null,
    confidence: 1.0,
  };
}

// Export pattern arrays for testing
export const _testExports = {
  CRITICAL_PATTERNS,
  URGENT_PATTERNS,
};
