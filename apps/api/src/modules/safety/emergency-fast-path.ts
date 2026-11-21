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
 * English heavy bleeding said without heavy / severe / uncontrolled:
 * "bleeding a lot / so much / too much / heavily / profusely", "lots of blood",
 * "lost a lot of blood". "Blood" followed by test / pressure / transfusion …,
 * or preceded by took / drew (a blood draw), is not a bleeding report.
 */
const SEVERE_BLEEDING_EN_2 =
  /\bbleeding\s+(?:(?:really|very|quite|so)\s+)?(?:a\s+lot|so\s+much|too\s+much|lots|heavily|profusely)\b|(?<!\b(?:took|take|takes|taken|taking|drew|draw|draws|drawn|drawing)\s)\b(?:a\s+lot\s+of|lots\s+of|so\s+much|too\s+much)\s+blood\b(?!\s+(?:test|work|report|count|sugar|pressure|draw|sample|transfusion|donation|bank|group|cell)\w*)/i;

/**
 * "behoshi" (fainting / near-fainting), which unconscious_hinglish's
 * `\bbehosh\b` misses. Critical like "behosh" and English "fainting".
 * "behoshi ki dawai / ka injection / ke doctor" is anaesthesia, not fainting.
 */
const BEHOSHI_HINGLISH =
  /\bbehosh(?:i|ee|y)\b(?!\s+(?:ki|ka|ke|wali|wala|vali|vala)\s+(?:dawai|dawaai|dawa|davai|dava|dvai|injection|sui|goli|doctor|daktar|medicine|specialist)\b)/i;
/** "बेहोशी आ गई", "बेहोशी जैसी" — but not "बेहोशी की दवा / का इंजेक्शन". */
const BEHOSHI_HI = /बेहोशी(?!\s*(?:की|का|के|वाली|वाला)\s*(?:दवा|दवाई|इंजेक्शन|सुई|डॉक्टर|डाक्टर))/;

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

// ─── QA0904-1: headache + vision change, severe headache, very weak ──────
//
// Nukta letters are written as escapes: ज़ = ज़ precomposed or
// ज़ decomposed (NFC always yields the latter); फ़ likewise
// फ़ / फ़. `(?<![ऀ-ॿ])` stands in for `\b` before
// सिर / सर so "कैंसर" (ends in सर) is not read as "head".

/** Devanagari तेज / तेज़ (fast / severe), any nukta form. */
const DV_TEZ = "ते(?:\\u091C\\u093C?|\\u095B)";
const DV_NOT_AFTER_LETTER = "(?<![\\u0900-\\u097F])";
const HL_IN = "(?:me|mein|mai|main|men)";
/** Hinglish "tez / tej" (severe) as a whole word. */
const HL_TEZ = String.raw`(?:tez|tej)\b`;

/**
 * Severe headache in romanised Hindi — parity with English "severe headache"
 * (severe_symptom_en, urgent). severe_symptom_hinglish sees "sir mein tez
 * dard" but not "tez sirdard", "bahut sir dard" or "sir dard bahut zyada".
 * Plain "sir dard" (no intensifier) is NOT matched.
 */
const SEVERE_HEADACHE_HINGLISH = new RegExp(
  [
    // intensifier(s) then headache: "tez sirdard", "bahut tez sir dard"
    String.raw`\b(?:(?:bahut|bohot|bahot|bhot|bht|zyada|jyada|tez|tej|bhayankar|bhayanak|asahniya)\s+)+(?:(?:sir|sar)\s*${HL_IN}?\s*dard|headache)\b`,
    // headache then intensifier: "sir dard bahut zyada", "sirdard aaj bahut tez"
    String.raw`\b(?:(?:sir|sar)\s*${HL_IN}?\s*dard|headache)\s+(?:(?:bhi|to|toh|hai|ho|raha|rahi|abhi|aaj)\s+)?(?:${HI_MUCH}|${HL_TEZ})`,
    // "sir phat raha hai" — splitting headache
    String.raw`\b(?:sir|sar)\s+(?:phat|fat)\w*\s+(?:raha|rahi|rahe|rha|rhi|ja)\w*`,
  ].join("|"),
  "i",
);
/** Severe headache in Devanagari: "तेज़ सिरदर्द", "सिरदर्द बहुत ज़्यादा", "सिर फट रहा". */
const SEVERE_HEADACHE_HI = new RegExp(
  [
    `(?:(?:बहुत|${DV_ZYADA}|${DV_TEZ}|भयंकर|असहनीय)\\s*)+(?:सिर|सर)\\s*(?:में\\s*)?दर्द`,
    `${DV_NOT_AFTER_LETTER}(?:सिर|सर)\\s*(?:में\\s*)?दर्द\\s*(?:(?:भी|तो|है|हो|रहा|रही|आज|अभी)\\s*)?(?:${DV_MUCH}|${DV_TEZ})`,
    `${DV_NOT_AFTER_LETTER}(?:सिर|सर)\\s*फट`,
  ].join("|"),
);
/**
 * severe_symptom_hi with any nukta form of तेज़ / ज़्यादा: "पेट में तेज़ दर्द"
 * missed because the nukta sits between तेज and `\s*`.
 */
const SEVERE_SYMPTOM_HI_2 = new RegExp(`(?:बहुत|${DV_ZYADA}|${DV_TEZ})\\s*(?:दर्द|उल्टी|दस्त|सूजन)`);

/**
 * Any mention of a headache, any script, with or without an intensifier.
 * A negated headache ("no headache", "sir dard nahi hai", "सिरदर्द नहीं") does
 * not count, so "no headache, but blurry vision" is vision alone.
 */
const ANY_HEADACHE: Matcher[] = [
  /(?<!\b(?:no|without|not\s+a)\s+)\b(?:headaches?|head\s*ache)\b|\bhead\s+(?:hurts|hurting|is\s+hurting|pain)\b|\bpain\s+in\s+(?:the|his|her|my|their)\s+head\b/i,
  // "sir dard", "sirdard", "sar me dard", "sir mein bahut tez dard" (Latin words only
  // in the gap, so "Sir, dard …" — a form of address — never matches)
  new RegExp(String.raw`\b(?:sir|sar)\s*${HL_IN}?\s*(?:[a-z]+\s+){0,2}?dard\b(?!\s+(?:nahi|nahin|nhi)\b)`, "i"),
  /\b(?:sir|sar)\s+(?:phat|fat)\w*|\bmath(?:a|e)\s*(?:me|mein)?\s*dard\b(?!\s+(?:nahi|nahin|nhi)\b)/i,
  new RegExp(
    `${DV_NOT_AFTER_LETTER}(?:सिर|सर)\\s*(?:में\\s*)?(?:\\S+\\s+){0,2}?दर्द(?!\\s*नहीं)|${DV_NOT_AFTER_LETTER}(?:सिर|सर)\\s*फट|${DV_NOT_AFTER_LETTER}माथे?\\s*(?:में\\s*)?दर्द(?!\\s*नहीं)|हेडेक`,
  ),
];

/**
 * A reported change in vision, any script: blurred, double, can't see clearly,
 * seeing less. "dhundh" alone (= search, fog) is NOT blur — the "l" of
 * dhundhla / dhundli is required. "aankh kamzor" (weak eyesight) is not matched.
 */
const ANY_VISION_CHANGE: Matcher[] = [
  /\bblurr?(?:ed|y|iness)\b|\b(?:hazy|fuzzy|double|dim)\s+(?:vision|sight|eyesight)\b|\b(?:vision|sight|eyesight)\s+(?:is\s+|has\s+|went\s+|got\s+|getting\s+|became\s+|turned\s+)?(?:been\s+|gone\s+)?(?:hazy|fuzzy|double|dim|dark)\b/i,
  /\bseeing\s+double\b|\b(?:can'?t|cannot|unable\s+to|not\s+able\s+to|couldn'?t)\s+see\s+(?:clearly|properly|well|anything)\b|\b(?:loss\s+of|losing|lost)\s+(?:(?:his|her|my|their)\s+)?(?:vision|sight|eyesight)\b/i,
  /\bdh(?:u|oo)ndh?a?l(?:a|aa|i|ee|e|apan|aapan)?\b/i,
  /\b(?:saaf|saf|sahi|theek|thik|clear)\s+(?:se\s+)?(?:nahi|nahin|nhi|na)\s+dikh|\b(?:double|do\s*-?\s*do)\s+dikh|\bdikh(?:na|ai|aai|ayi)\s+(?:dena\s+)?(?:band|nahi\s+de|nahin\s+de|nhi\s+de|kam)|\bkam\s+dikh\w*\s+(?:raha|rahi|rahe|rha|rhi|laga|lagi|lage|lag)\b/i,
  /ध[ुू][ंँ]?धल|सा(?:फ़?|फ़)\s*(?:से\s*)?नहीं\s*दिख|(?:डबल|दो\s*-?\s*दो)\s*दिख|दिख(?:ना|ाई)\s*(?:देना\s*)?(?:बंद|नहीं\s*दे|कम)|कम\s*दिख\S*\s*(?:रहा|रही|रहे|लगा|लगी|लगे)|रोशनी\s*(?:कम|जा)/,
];

/** Glasses / eye-test talk — the eyestrain reading of "headache + blurry". */
const EYEWEAR_CONTEXT =
  /\b(?:chashm\w*|chasm\w*|glasses|spectacles|specs|lens\w*|eye\s*(?:test|check\w*|exam\w*))\b|चश्म|ऐनक|लेंस/i;
/** Cancer / treatment context, which lifts the eyewear guard. */
const TREATMENT_CONTEXT =
  /\b(?:chemo\w*|kimo|kemo|keemo|radiation|radiotherapy|sikai|sekai|treatment|ilaa?j|cancer|tumou?r|leuk(?:a)?emia|oncolog\w*)\b|कीमो|इलाज|कैंसर|रेडिएशन|सिकाई|ट्यूमर|ल्यूकेमिया/i;

/**
 * Headache AND a vision change in the same message (QA0904-1: possible raised
 * intracranial pressure / CNS involvement). Both signals must appear. When the
 * message is about glasses or an eye test it is read as eyestrain — unless it
 * also mentions cancer or treatment.
 */
const HEADACHE_WITH_VISION_CHANGE: Matcher = {
  test: (text: string) =>
    ANY_HEADACHE.some((m) => m.test(text)) &&
    ANY_VISION_CHANGE.some((m) => m.test(text)) &&
    (!EYEWEAR_CONTEXT.test(text) || TREATMENT_CONTEXT.test(text)),
};

/**
 * "Very weak", any script — weakness WITH an intensifier. Weak eyes, immunity,
 * bones, memory or heart ("aankh bahut kamzor") are not a weakness report.
 */
const HL_WEAK_NOT_OF = String.raw`(?<!\b(?:aa?nkh\w*|nazar|nigah|eyesight|immunity|haddi\w*|yaa?dd?aa?sht|dimaag|dil)\s+(?:bhi\s+)?)`;
const DV_WEAK_NOT_OF = "(?<!(?:आ[ँं]ख\\S*|न(?:\\u091C\\u093C?|\\u095B)र|इम्युनिटी|हड्डी\\S*|हड्डियां|याददाश्त|दिल)\\s*(?:भी\\s*)?)";
const DV_KAMZOR = "कम(?:\\u091C\\u093C?|\\u095B)ोर";
const ANY_STRONG_WEAKNESS: Matcher[] = [
  new RegExp(
    String.raw`${HL_WEAK_NOT_OF}\b(?:bahut|bohot|bahot|bhot|bht|zyada|jyada|kaafi|kafi|ekdam|bilkul|itna|itni|itne)\s+(?:hi\s+)?kam[zj]o+r\w*` +
      String.raw`|${HL_WEAK_NOT_OF}\bkam[zj]o+r\w*\s+(?:\S+\s+)?${HI_MUCH}`,
    "i",
  ),
  new RegExp(
    `${DV_WEAK_NOT_OF}(?:बहुत|${DV_ZYADA}|का(?:\\u092B\\u093C?|\\u095E)ी|बिल्कुल|एकदम)\\s*(?:ही\\s*)?${DV_KAMZOR}` +
      `|${DV_WEAK_NOT_OF}${DV_KAMZOR}\\S*\\s*(?:\\S+\\s*)?${DV_MUCH}`,
  ),
  /\b(?:very|extremely|so|too|really|terribly|severely|awfully)\s+weak\b(?!\s+(?:eyesight|eyes?|immunity|immune|bones?|signal|network|wifi|heart|memory))|\b(?:extreme|severe|profound)\s+weakness\b/i,
];

/** Not eating / not drinking, any script. Diet questions ("kya nahi khana chahiye") do not match. */
const ANY_NOT_EATING_DRINKING: Matcher[] = [
  /\b(?:khana|khaana|kuch|kuchh|paani|pani)\s+(?:bhi\s+)?(?:(?:peena|pina)\s+)?(?:nahi|nahin|nhi|na)\s+(?:kha|khaa|pee|pi|le)\w*(?:\s+(?:pa|paa)\w*)?\s+(?:raha|rahi|rahe|rha|rhi|rhe|sak\w*|pa\w*)\b|\b(?:khana|khaana)[\s-]*(?:(?:peena|pina)\s+)?(?:bilkul\s+|ekdam\s+)?(?:band|chhoot|chhut|chhod)\w*/i,
  /(?:खाना|कुछ|पानी)\s*(?:भी\s*)?(?:पीना\s*)?नहीं\s*(?:खा|पी|ले)\S*\s*(?:पा\S*\s*)?(?:रह|सक|पा)|खाना[\s-]*(?:पीना\s*)?(?:बिल्कुल\s*)?(?:बंद|छूट|छोड़)/,
  /\b(?:can'?t|cannot|unable\s+to|not\s+able\s+to|isn'?t|is\s+not|hasn'?t(?:\s+been)?|has\s+not(?:\s+been)?|won'?t|stopped|refus\w*\s+to)\s+(?:eat|eating|drink|drinking|keep\s+(?:anything|food|water|fluids|liquids)\s+down)\b|\bnot\s+eating\s+or\s+drinking\b/i,
];

const ANY_FEVER: Matcher = new RegExp(FEVER_TERM, "i");

/**
 * "Very weak" TOGETHER WITH dizziness, not eating / drinking, fever or bleeding.
 * Weakness alone is deliberately not escalated: fatigue is the most common
 * treatment side effect, and there is no English rule for it either.
 */
const WEAKNESS_WITH_SECOND_SIGNAL: Matcher = {
  test: (text: string) =>
    ANY_STRONG_WEAKNESS.some((m) => m.test(text)) &&
    (ANY_DIZZINESS.some((m) => m.test(text)) ||
      ANY_NOT_EATING_DRINKING.some((m) => m.test(text)) ||
      ANY_FEVER.test(text) ||
      ANY_BLEEDING.some((m) => m.test(text))),
};

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
  // Owner decision on #196: English "bleeding a lot" and "behoshi" are
  // critical, so bleeding + either one is critical, not the urgent cluster.
  [SEVERE_BLEEDING_EN_2, "severe_bleeding_en_2"],
  [BEHOSHI_HINGLISH, "unconscious_hinglish_2"],
  [BEHOSHI_HI, "unconscious_hi_3"],

  // Bleeding + dizziness without a heavy / won't-stop signal is URGENT, not
  // critical — see BLEEDING_WITH_DIZZINESS in URGENT_PATTERNS below.

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

  // Issue #81 — bleeding together with dizziness / near-fainting, each signal
  // in any script; both must be present. SCCF decision (#196): urgent — the
  // reply says contact the care team today, still shows 112/108, and says go
  // to Emergency if bleeding won't stop. Heavy or won't-stop bleeding stays
  // critical: CRITICAL_PATTERNS run first, so "bleeding bahut zyada … chakkar
  // aa raha" never reaches this rule.
  [BLEEDING_WITH_DIZZINESS, "bleeding_with_dizziness_multilingual"],

  // QA0904-1 — severe headache + blurred vision (possible raised intracranial
  // pressure / CNS involvement). URGENT, the same tier as English "severe
  // headache" (severe_symptom_en) and "sudden vision loss"
  // (sudden_sensory_loss_en): the reply sends the family to the care team /
  // nearest emergency today and shows 112/108, and keeps the conversation open.
  // A seizure, fainting, unconsciousness or sudden confusion alongside is
  // critical, because CRITICAL_PATTERNS run first.
  [HEADACHE_WITH_VISION_CHANGE, "headache_with_vision_change_multilingual"],
  [SEVERE_HEADACHE_HINGLISH, "severe_headache_hinglish"],
  [SEVERE_HEADACHE_HI, "severe_headache_hi"],
  [SEVERE_SYMPTOM_HI_2, "severe_symptom_hi_2"],
  // "bahut kamzor" is urgent ONLY with a second signal; alone it stays normal.
  [WEAKNESS_WITH_SECOND_SIGNAL, "weakness_with_second_signal_multilingual"],
];

/** The matchers added for issue #81, shared with AbstentionService.hasUrgencyIndicators. */
const ISSUE_81_MATCHERS: Matcher[] = [
  SEVERE_BLEEDING_LOANWORD_HINGLISH,
  SEVERE_BLEEDING_LOANWORD_HINGLISH_PRE,
  SEVERE_BLEEDING_HI_2,
  SEVERE_BLEEDING_HI_2_PRE,
  BLEEDING_NOT_STOPPING_HINGLISH_2,
  BLEEDING_NOT_STOPPING_HI_2,
  SEVERE_BLEEDING_EN_2,
  BEHOSHI_HINGLISH,
  BEHOSHI_HI,
  BLEEDING_WITH_DIZZINESS,
  CHEMO_FEVER_MULTILINGUAL,
  // QA0904-1
  HEADACHE_WITH_VISION_CHANGE,
  SEVERE_HEADACHE_HINGLISH,
  SEVERE_HEADACHE_HI,
  SEVERE_SYMPTOM_HI_2,
  WEAKNESS_WITH_SECOND_SIGNAL,
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
 * for issue #81 (heavy bleeding, bleeding + dizziness, fever during chemo) or
 * QA0904-1 (headache + vision change, severe headache, very weak + a second signal).
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
