/**
 * Safety rules and patterns for the Suchi Cancer Bot.
 *
 * NOT PART OF THE REPAIRABLE SURFACE. Safety patterns must never be modified
 * by the autoresearch loop. See repairable/manifest.json → constraints.safetyInvariant.
 */
export type SafetyClassification = "normal" | "refusal" | "red_flag" | "self_harm";

export const RULES = {
  EMERGENCY: "SAFE_EMERGENCY_V1",
  SELF_HARM: "SAFE_SELF_HARM_V1",
  REFUSAL_DIAGNOSIS: "SAFE_REFUSAL_DIAGNOSIS_V1",
  REFUSAL_DOSAGE: "SAFE_REFUSAL_DOSAGE_V1",
  REFUSAL_REPORT_INTERPRETATION: "SAFE_REFUSAL_REPORT_INTERPRETATION_V1",
  REFUSAL_TREATMENT_CHOICE: "SAFE_REFUSAL_TREATMENT_CHOICE_V1",
  REFUSAL_PROGNOSIS: "SAFE_REFUSAL_PROGNOSIS_V1",
  MISINFO_STOP_TREATMENT: "SAFE_MISINFO_STOP_TREATMENT_V1",
  MISINFO_ALTERNATIVE_ONLY: "SAFE_MISINFO_ALTERNATIVE_ONLY_V1",
} as const;

// ─── Self-harm patterns (English + Hindi + Hinglish) ─────────────────
export const SELF_HARM_PATTERNS = [
  // English
  /kill myself/i,
  /end my life/i,
  /suicid(e|al)/i,
  /i want to die/i,
  /better off dead/i,
  /no point in living/i,
  /nothing to live for/i,
  /can'?t go on/i,
  /harm myself/i,
  /self[- ]?harm/i,
  /cut myself/i,
  /want to hurt myself/i,
  /end it all/i,
  /give up on life/i,
  /just want the pain to stop/i,
  /want to end everything/i,
  // Hindi
  /मरना\s+चाह/i,
  /जीने\s+का\s+मन\s+नहीं/i,
  /ख़ुद\s*को\s*(मार|नुकसान)/i,
  /जीना\s+नहीं\s+चाह/i,
  /सब\s+ख़त्म\s+कर/i,
  // Hinglish
  /\bmarna\s+chahta\b/i,
  /\bjeene\s+ka\s+mann?\s+nahi\b/i,
  /\bjeena\s+nahi\b/i,
  /\bsab\s+khatam\b/i,
];

// ─── Emergency patterns (English + Hindi + Hinglish) ─────────────────
export const EMERGENCY_PATTERNS = [
  // English
  /vomiting blood/i,
  /uncontrolled bleeding/i,
  /severe chest pain/i,
  /can'?t breathe/i,
  /faint(ed|ing)/i,
  /coughing\s+(up\s+)?blood/i,
  /blood\s+in\s+(stool|urine|vomit)/i,
  /seizure/i,
  /unconscious/i,
  /collapsed/i,
  /severe\s+allergic/i,
  /anaphylax/i,
  // Hindi
  /खून\s*की?\s*उल्टी/i,
  /खून\s*रुक\s*नहीं/i,
  /सांस\s*नहीं\s*(आ|ले)/i,
  /बेहोश/i,
  /दौरा\s*(पड़|आ)/i,
  // Hinglish
  /\bkhoon\s*(ki|ka)\s*ulti\b/i,
  /\bsaans?\s*nahi\b/i,
  /\bbehosh\b/i,
];

// ─── Diagnosis patterns (expanded with Hindi/Hinglish) ───────────────
export const DIAGNOSIS_PATTERNS = [
  // English
  /do i have cancer/i,
  /is it cancer/i,
  /can you diagnose/i,
  /what stage/i,
  /do i have.*cancer/i,
  /is this cancer/i,
  /tell me if.*cancer/i,
  /diagnose me/i,
  /am i going to die/i,
  /is.*malignant/i,
  /is.*benign\s+or\s+malignant/i,
  /what is my (diagnosis|prognosis|stage)/i,
  /confirm.*diagnosis/i,
  // Hindi
  /क्या\s*(मुझे|मेरे|ये|यह)\s*कैंसर\s*(है|हो)/i,
  /कैंसर\s*(है|हो)\s*क्या/i,
  /जांच\s*करो/i,
  // Hinglish
  /\bkya\s*(mujhe|mere|ye|yeh)\s*cancer\s*(hai|ho)\b/i,
  /\bcancer\s*hai\s*kya\b/i,
];

// ─── Dosage patterns (expanded with more clinical terms) ─────────────
export const DOSAGE_PATTERNS = [
  // Dosage units and prescription language
  /\bmg\b/i,
  /\bml\b.*\b(take|dose|inject|drink)/i,
  /dose/i,
  /how much .* take/i,
  /prescribe/i,
  /how many.*take/i,
  /when to take/i,
  /how often.*take/i,
  /what.*dose.*should/i,
  /increase.*dose/i,
  /decrease.*dose/i,
  /skip.*dose/i,
  /double.*dose/i,
  /miss.*dose/i,
  /overdose/i,
  // Injection-related
  /how\s+(much|many)\s+(units?|vials?|syringes?)/i,
  /inject.*how\s+much/i,
  // Hindi/Hinglish
  /कितना\s*(दवा|गोली|injection|dose)/i,
  /\bkitna\s*(dawai?|goli|dose)\b/i,
  /\bdawai?\s*(kitni|kitna|kab)\b/i,
];

// ─── Stop treatment / misinformation patterns ────────────────────────
export const STOP_TREATMENT_PATTERNS = [
  // English
  /stop chemo/i,
  /quit chemo/i,
  /only ayurveda/i,
  /alternative cure/i,
  /refuse\s+(chemo|radiation|surgery|treatment)/i,
  /don'?t\s+need\s+(chemo|radiation|surgery|treatment)/i,
  /natural\s+cure\s+(for|instead)/i,
  /homeopathy\s+(can\s+)?cure\s+cancer/i,
  /cancer\s+cure\s+without\s+(chemo|radiation|surgery)/i,
  // Hindi
  /कीमो\s*(बंद|छोड़|मत)/i,
  /इलाज\s*बंद/i,
  /सिर्फ\s*(आयुर्वेद|होम्योपैथी|देसी\s*इलाज)/i,
  // Hinglish
  /\bchemo\s*(band|chod|mat)\b/i,
  /\bsirf\s*(ayurved|homeopath|desi\s*ilaaj)\b/i,
];

// ─── Report interpretation patterns (expanded) ──────────────────────
export const REPORT_INTERPRETATION_PATTERNS = [
  /interpret.*scan/i,
  /interpret.*report/i,
  /interpret.*test results/i,
  /what does.*mean.*lab/i,
  /what does.*scan show/i,
  /explain.*report/i,
  /reading.*results/i,
  /read\s+my\s+(report|scan|mri|ct|pet|biopsy|pathology)/i,
  /analyze\s+my\s+(report|results|scan)/i,
  /what\s+do\s+my\s+(results|numbers|values)\s+mean/i,
  /is\s+my\s+(report|scan|test)\s+(normal|abnormal|ok|bad)/i,
  // Hindi
  /रिपोर्ट\s*(पढ़|समझा|बता)/i,
  /जांच\s*(का\s*)?(मतलब|क्या\s*है|नतीजा)/i,
];

// ─── Treatment choice patterns (expanded) ────────────────────────────
export const TREATMENT_CHOICE_PATTERNS = [
  /which.*treatment.*should.*take/i,
  /which.*chemo.*should/i,
  /which.*drug.*should.*take/i,
  /what treatment.*should i/i,
  /recommend.*treatment/i,
  /best.*treatment\s+for\s+my/i,
  /should\s+i\s+(get|have|do|take)\s+(surgery|chemo|radiation|immunotherapy)/i,
  /surgery\s+or\s+(chemo|radiation)/i,
  /chemo\s+or\s+(surgery|radiation)/i,
  /which\s+(hospital|doctor)\s+is\s+best\s+for\s+my/i,
  // Hindi
  /कौन\s*सा?\s*(इलाज|दवा|treatment)\s*(अच्छा|सही|करवाऊं)/i,
  /ऑपरेशन\s*(करवाऊं|ज़रूरी)\s*(कि\s*नहीं|या)/i,
  // Hinglish
  /\bkaun\s*sa\s*(ilaaj|treatment|dawai)\b/i,
  /\boperation\s*karwau\b/i,
];

// ─── Prognosis patterns (NEW — plan requirement) ─────────────────────
export const PROGNOSIS_PATTERNS = [
  /how\s+long\s+(do\s+i|will\s+i|does)\s+(have|live|survive)/i,
  /survival\s+rate\s+(for\s+)?my/i,
  /am\s+i\s+going\s+to\s+die/i,
  /will\s+i\s+(die|survive|make\s+it)/i,
  /what\s+(are|is)\s+my\s+(chances|odds|prognosis)/i,
  /how\s+much\s+time\s+do\s+i\s+have/i,
  /life\s+expectancy/i,
  /terminal/i,
  // Hindi
  /कितने\s*दिन\s*(बचे|हैं|और)/i,
  /बच\s*(पाऊंगा|जाऊंगा|सकता)/i,
  /मर\s*जाऊंगा/i,
  // Hinglish
  /\bkitne\s*din\s*(bache|hain|aur)\b/i,
  /\bbach\s*(paunga|jaunga)\b/i,
];

// ─── Alternative-only misinformation patterns (NEW) ──────────────────
export const ALTERNATIVE_ONLY_PATTERNS = [
  /\b(turmeric|haldi|neem|tulsi|giloy|ashwagandha)\s+(cure|treat|kill)\s+cancer\b/i,
  /\bcancer\s+cure\s+(home|natural|herbal|ayurvedic)\s+remed/i,
  /\b(alkaline|keto|fasting)\s+(diet\s+)?(cure|treat|kill)\s+cancer\b/i,
  /\b(juice|detox|cleanse)\s+(cure|treat|kill)\s+cancer\b/i,
  /\bwhy\s+(not|won'?t)\s+(doctors|hospitals)\s+tell\b.*\b(cure|natural)\b/i,
  /\bconspiracy\b.*\bcancer\s+cure\b/i,
  // Hindi
  /हल्दी\s*(से)?\s*कैंसर\s*(ठीक|ख़त्म)/i,
  /देसी\s*(इलाज|नुस्खा|दवा)\s*(से)?\s*कैंसर/i,
];
