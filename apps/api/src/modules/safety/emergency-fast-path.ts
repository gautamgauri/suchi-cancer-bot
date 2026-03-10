/**
 * Emergency Fast-Path Router
 * Phase 1: Deterministic Shell component
 *
 * Pure regex-based emergency detection designed for sub-100ms response.
 * Zero LLM calls. This is the first thing evaluated on every inbound message.
 *
 * Supports: English, Hindi, Bhojpuri, and mixed-language (Hinglish) inputs.
 */

export interface EmergencyFastPathResult {
  isEmergency: boolean;
  severity: "critical" | "urgent" | "none";
  matchedPatterns: string[];
  responseText: string | null;
  /** Confidence 0-1; rule-based always returns 1.0 for matched patterns */
  confidence: number;
}

/**
 * Critical emergency patterns — life-threatening, route to 108/112 immediately.
 * Each entry: [regex, human-readable label for logging]
 */
const CRITICAL_PATTERNS: Array<[RegExp, string]> = [
  // English — bleeding
  [/\b(uncontrolled|severe|heavy|massive|won'?t stop)\s+(bleeding|hemorrhag)/i, "severe_bleeding_en"],
  [/\bbleeding\s+(won'?t|doesn'?t|does not|will not)\s+stop/i, "bleeding_wont_stop_en"],
  [/\bvomiting\s+blood\b/i, "vomiting_blood_en"],
  [/\bcoughing\s+(up\s+)?blood\b/i, "coughing_blood_en"],
  [/\bblood\s+in\s+(stool|urine|vomit)\b/i, "blood_in_body_fluid_en"],

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
  [/छाती\s*(में)?\s*(बहुत|ज़्यादा|तेज)\s*दर्द/i, "severe_chest_pain_hi"],
  [/सीने\s*(में)?\s*(बहुत|ज़्यादा|तेज)\s*दर्द/i, "severe_chest_pain_hi_2"],

  // Hindi — consciousness
  [/बेहोश\s*(हो\s*गय|हो\s*रह)/i, "unconscious_hi"],
  [/होश\s*नहीं/i, "unconscious_hi_2"],
  [/दौरा\s*(पड़|आ)\s*रह/i, "seizure_hi"],
  [/मिर्गी/i, "epilepsy_hi"],

  // Hinglish / transliterated
  [/\b(khoon|khun)\s*(bahut|zyada|bht)\b/i, "severe_bleeding_hinglish"],
  [/\b(khoon|khun)\s*(ruk|band)\s*nahi/i, "bleeding_not_stopping_hinglish"],
  [/\bsaans?\s*nahi\s*(aa|le)\s*raha/i, "cant_breathe_hinglish"],
  [/\bbehosh\b/i, "unconscious_hinglish"],
  [/\bseene?\s*(mein|me)\s*(bahut|zyada|tez)\s*(dard|pain)/i, "chest_pain_hinglish"],

  // Explicit emergency keywords
  [/\b(108|112)\s*(call|bula|phone)/i, "emergency_number_request"],
  [/\b(ambulance|एम्बुलेंस)\s*(bula|call|chahiye|bhej)/i, "ambulance_request"],
];

/**
 * Urgent patterns — needs medical attention soon but not immediately life-threatening.
 */
const URGENT_PATTERNS: Array<[RegExp, string]> = [
  // English
  [/\bfever\s+(above|over|more than)\s*(101|102|103|38|39)\b/i, "high_fever_en"],
  [/\b(chemo|chemotherapy)\s*.*\b(fever|infection|neutropeni)/i, "chemo_fever_en"],
  [/\bsevere\s+(pain|headache|vomiting|diarrhea|dehydration)\b/i, "severe_symptom_en"],
  [/\b(swollen|swelling)\s*(face|neck|arm|leg).*\b(sudden|rapidly)\b/i, "rapid_swelling_en"],
  [/\bsudden\s+(vision|hearing)\s+(loss|change|problem)\b/i, "sudden_sensory_loss_en"],
  [/\bblood\s+clot\b/i, "blood_clot_en"],
  [/\b(dvt|deep\s+vein\s+thrombosis|pulmonary\s+embolism)\b/i, "thrombosis_en"],

  // Hindi
  [/बुखार\s*(बहुत|ज़्यादा|तेज)/i, "high_fever_hi"],
  [/कीमो\s*.*\s*(बुखार|इन्फेक्शन|infection)/i, "chemo_fever_hi"],
  [/(बहुत|ज़्यादा|तेज)\s*(दर्द|उल्टी|दस्त|सूजन)/i, "severe_symptom_hi"],

  // Hinglish
  [/\b(bukhar|bukhaar)\s*(bahut|zyada|tez)\b/i, "high_fever_hinglish"],
  [/\b(bahut|zyada|tez)\s*(dard|pain|sujan|swelling)\b/i, "severe_symptom_hinglish"],
];

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
  const matchedPatterns: string[] = [];

  // Check critical patterns first
  for (const [regex, label] of CRITICAL_PATTERNS) {
    if (regex.test(text)) {
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
    if (regex.test(text)) {
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
