/**
 * Romanised-Hindi (Hinglish) / Devanagari red flags that no layer caught
 * (independent classifier review, Sep 2026). Each rule is the twin of an
 * English rule already in emergency-fast-path.ts, at the SAME tier:
 *
 *   vomiting blood / blood in stool or urine / bleeding won't stop  → critical
 *   can't breathe / breathlessness / choking                         → critical
 *   heart attack                                                     → critical
 *   unconscious / collapsed / seizure                                → critical
 *   stroke / sudden numbness                                         → critical
 *   chest pain (plain, reported)                                     → urgent
 *   high fever (fever above 101/102…)                                → urgent
 *
 * NOT PART OF THE REPAIRABLE SURFACE (see safety.rules.ts).
 *
 * Devanagari has no `\b` in JS regex (it is ASCII-only), so Devanagari pieces
 * carry no word boundaries; where a short stem could sit inside a longer word
 * (मल inside कमल / मलेरिया) `(?<![ऀ-ॿ])` / `(?![ऀ-ॿ])` stand in for `\b`.
 * Nukta letters may arrive precomposed or decomposed (NFC decomposes them), so
 * stems stop before the nukta or accept both forms.
 */

interface Matcher {
  test(text: string): boolean;
}

/** Hinglish "in" (postposition). */
const HL_IN = "(?:me|mein|mai|main|men|mei)";
const HL_NOT = "(?:nahi|nahin|nhi|nai|na)";
const HL_BLOOD = "(?:khoon|khun|blood)";
const DV_NOT_AFTER_LETTER = "(?<![\\u0900-\\u097F])";
const DV_NOT_BEFORE_LETTER = "(?![\\u0900-\\u097F])";
/** "khoon ki jaanch / test / report / kami" is about a blood test or anaemia, not bleeding. */
const HL_NOT_A_TEST = String.raw`(?!\s+(?:ki|ka|ke)\s+(?:jaanch|janch|jach|jaach|test|report|kami|group)\b)`;
const DV_NOT_A_TEST = "(?!\\s*(?:की|का|के)\\s*(?:जा[ंँ]च|टेस्ट|रिपोर्ट|कमी))";
/** A question about the condition, not a report of it ("mirgi kya hoti hai", "kaise sambhalein"). */
const HL_EDUCATIONAL_Q = new RegExp(
  String.raw`\b(?:kya\s+(?:hota|hoti|hote|hai|h)|kaise|kaisa|kyu|kyun|kyon|kyo|matlab|meaning|what\s+is|how\s+to)\b`,
  "i",
);
const DV_EDUCATIONAL_Q = /क्या\s*(?:होता|होती|होते|है)|कैसे|क्यों|क्यूं|मतलब/;
/** Something is happening now ("ho rahi", "aa raha", "abhi", "aaj") — a report, even if phrased as "why". */
const HL_HAPPENING_NOW = /\b(?:rah[aie]|rh[aie]|ho\s+ga(?:y[aie]|i|e)|lag\s+rah\w*|lagi|lage|abhi|aaj|kal\s+se|subah\s+se|raat\s+se)\b/i;
const DV_HAPPENING_NOW = /रह[ाीे]|हो\s*ग(?:या|यी|ई|ए)|लग\s*रह|लगी|अभी|आज/;
/** A question ABOUT a condition ("saans phoolna kya hai", "mirgi ka daura kya hota hai"), not a report of one. */
function isQuestionNotReport(text: string): boolean {
  return (
    (HL_EDUCATIONAL_Q.test(text) || DV_EDUCATIONAL_Q.test(text)) &&
    !HL_HAPPENING_NOW.test(text) &&
    !DV_HAPPENING_NOW.test(text)
  );
}
/** Wrap a matcher so it does not fire on a question about the condition. */
function reportOnly(m: Matcher): Matcher {
  return { test: (text: string) => m.test(text) && !isQuestionNotReport(text) };
}

// ─── Critical ───────────────────────────────────────────────────────────

/** "ulti me khoon", "khun ki ulti", "khoon wali ulti", "vomit me blood". */
const VOMITING_BLOOD_HINGLISH = new RegExp(
  String.raw`\b(?:ulti|ultee|ultiyan|ultiyaan|vomit\w*)\s+${HL_IN}\s+(?:\S+\s+)?${HL_BLOOD}\b${HL_NOT_A_TEST}` +
    String.raw`|\b${HL_BLOOD}\s+(?:ki|ka|ke|wali|vali|wala)\s+(?:ulti|ultee|ultiyan|ultiyaan|vomit\w*)\b`,
  "i",
);

/** Stool / urine words (Hinglish). */
const HL_STOOL_URINE =
  "(?:peshab|pesab|peshaab|pishab|pishaab|pesaab|urine|latrine|letrin|laitrin|latrin|potty|pakhana|pakhane|paikhana|paikhane|pakhaane|tatti|toilet|stool|mal|motion|shauch)";
/** "peshab me khoon", "latrine me khoon", "pakhane ke saath khoon", "khoon wala peshab". */
const BLOOD_IN_STOOL_URINE_HINGLISH = new RegExp(
  String.raw`\b${HL_STOOL_URINE}\s+(?:${HL_IN}|se|ke\s+sath|ke\s+saath)\s+(?:\S+\s+)?${HL_BLOOD}\b${HL_NOT_A_TEST}` +
    String.raw`|\b${HL_BLOOD}\s+(?:wala|wali|vala|vali|ke\s+sath|ke\s+saath)\s+${HL_STOOL_URINE}\b`,
  "i",
);
/** "पेशाब में खून", "पाखाने में खून", "मल के साथ खून", "खून वाला पेशाब". */
const DV_STOOL_URINE =
  `(?:(?:पेशाब|पेसाब|मूत्र|पाखान|पैखान|लैट्रिन|लेट्रिन|टॉयलेट)\\S*|टट्टी|शौच|${DV_NOT_AFTER_LETTER}मल${DV_NOT_BEFORE_LETTER})`;
const BLOOD_IN_STOOL_URINE_HI = new RegExp(
  `${DV_STOOL_URINE}\\s*(?:में|से|के\\s*साथ)\\s*(?:\\S+\\s*)?खून${DV_NOT_A_TEST}` +
    `|खून\\s*(?:वाला|वाली|के\\s*साथ)\\s*${DV_STOOL_URINE}`,
);

/** "khoon nahi ruk raha", "blood nahi ruk rha", "bleeding abhi bhi nahi thami". */
const BLEEDING_NOT_STOPPING_HINGLISH_3 = new RegExp(
  String.raw`\b(?:${HL_BLOOD}|bleeding)\s+(?:\S+\s+){0,2}?${HL_NOT}\s+(?:ruk|rukk|tham|thum|band)\w*`,
  "i",
);
/** "खून नहीं रुक रहा", "ब्लीडिंग अभी भी नहीं थम रही". */
const BLEEDING_NOT_STOPPING_HI_3 = /(?:खून|ब्लीडिंग|रक्तस्राव)\s*(?:\S+\s*){0,2}?नहीं\s*(?:रुक|थम|बंद)/;

/**
 * Breathing difficulty with a bounded gap (0-20 chars) between "saans" and the
 * difficulty word: "saans lene me bahut takleef", "saans nahi aa rahi",
 * "saans phool rahi", "सांस लेने में बहुत तकलीफ". The older rules required the
 * two words to be adjacent. "takleef kam / nahi" (better / none) and a "nahi"
 * not followed by a breathing verb ("saans ka tarika nahi pata") do not count.
 */
const BREATHING_DIFFICULTY_HINGLISH = new RegExp(
  String.raw`\b(?:saa?ns(?:e|on)?|swaa?s|shwaa?s)\b[\s\S]{0,20}?\b(?:` +
    String.raw`(?:takleef|takleeph|taklif|taklef|takalif|mushkil|muskil|dikkat|dikkt|dikat|pareshani)\b(?!\s+(?:kam|nahi|nahin|nhi|na)\b)` +
    String.raw`|(?:phool|phul|fool|ful)\w*` +
    String.raw`|${HL_NOT}\s+(?:aa|a|aati|ati|aata|ata|aayi|ayi|aa\s+rah\w*|a\s+rah\w*|le|li|lee|lena|le\s+pa\w*|pa\s+rah\w*|paa\s+rah\w*)\b` +
    String.raw`|(?:ruk|atak|atk|ukhad|ukhar)\w*` +
    String.raw`)`,
  "i",
);
const BREATHING_DIFFICULTY_HI = new RegExp(
  "(?:सा[ंँ]स|श्वास)[\\s\\S]{0,20}?(?:" +
    "(?:तकली(?:फ\\u093C?|\\u095E)|मुश्किल|दिक्कत|परेशानी)(?!\\s*(?:कम|नहीं))" +
    "|फ[ूु]ल" +
    "|नहीं\\s*(?:आ\\s*(?:रह|पा)|आती|आता|आई|ले\\s*(?:पा|रह)|ली\\s*जा|पा\\s*रह)" +
    "|रुक|अटक|उखड" +
    ")",
);

/** "dam ghut raha hai", "dum ghutt raha" — Devanagari twin is choking_hi (दम घुट रह). */
const CHOKING_HINGLISH = /\b(?:dam|dum)\s+(?:ghut|ghutt|ghot)\w*/i;

/** "dil ka daura pada", "heart attack aaya"; Devanagari "दिल का दौरा पड़ा". */
const HEART_ATTACK_HINGLISH =
  /\bdil\s+ka\s+(?:daura|dora)\s+(?:pad|padh|par|aa|aaya|aya|hua|ho)\w*|\b(?:hart|heart)\s*(?:atek|attak|atak|attack)\s+(?:aa|aaya|aya|hua|ho|pad)\w*/i;
const HEART_ATTACK_HI = /दिल\s*का\s*दौरा\s*(?:पड|आ|हुआ|हो)|हार्ट\s*अटैक\s*(?:आ|हुआ|हो|पड)/;

/** "hosh nahi aa raha", "hosh me nahi hai" — not the idiom "hosh hi nahi raha ki …" (forgot). */
const UNCONSCIOUS_HINGLISH_3 = new RegExp(
  String.raw`\bhosh\s+(?:${HL_IN}\s+)?(?:hi\s+)?${HL_NOT}\s+(?:aa|a|aaya|aya|aayi|ayi|hai|h|he|hain|hua|ho)\b`,
  "i",
);

/** Seizure: "fits aa rahe", "jhatke aa rahe", "mirgi ka daura", "daura pad raha". */
const SEIZURE_HINGLISH: Matcher = {
  test: (text: string) =>
    /\bfits?\s+(?:aa|aaya|aya|aaye|aye|aayi|ayi|aati|aate|aa\s+rah\w*|a\s+rah\w*|pad\w*|padh\w*)\b/i.test(text) ||
    /\bjhatke\s+(?:aa|a|lag)\s*(?:rahe|rhe|gaye|gye|te|ne)\b/i.test(text) ||
    /\b(?:daura|dora|daure|dore)\s+(?:pad|padh|par)\w*/i.test(text) ||
    // "mirgi ka daura" is a report on its own, but not inside a question about it.
    (/\b(?:mirgi|mirgee|mirgii)\s+(?:ka|ke)\s+(?:daura|dora|daure|dore)\b/i.test(text) && !isQuestionNotReport(text)),
};
const SEIZURE_HI = /झटके\s*(?:आ|लग)\s*(?:रहे|गए|गये|ते|ने)|फिट्स?\s*(?:आ|पड)|दौरा\s*पड/;

/** Collapsed and not getting up / responding: "papa gir gaye aur uth nahi rahe". */
const COLLAPSED_HINGLISH = new RegExp(
  String.raw`\bgir\s+(?:gaye|gayi|gaya|gye|gyi|gya|gae|gai|pade|padi|pada|padhe|padhi)\b[\s\S]{0,40}?` +
    String.raw`\b(?:(?:uth|utth|hil|bol)\w*\s+${HL_NOT}\b|${HL_NOT}\s+(?:uth|utth|hil|bol)\w*|hosh|behosh)` +
    String.raw`|\bcollapse\s+(?:ho|kar)\w*`,
  "i",
);
const COLLAPSED_HI = /गिर\s*(?:गए|गये|गई|गयी|गया|पड)[\s\S]{0,40}?(?:(?:उठ|हिल|बोल)\S*\s*नहीं|नहीं\s*(?:उठ|हिल|बोल)|होश|बेहोश)/;

/**
 * Sudden numbness / paralysis (stroke_en: "sudden numbness", "paralysis").
 * Numbness WITHOUT "sudden" is not matched: tingling / numb hands and feet is
 * a common chemo side effect (neuropathy), not an emergency.
 */
const STROKE_HINGLISH =
  /\b(?:achanak|achaanak|ekdam|ek\s+dam|sudden\w*)\b[\s\S]{0,40}?\b(?:sunn\w*|sun\s+ho\w*|jhunjhun\w*|lakw?a|lakua)|\b(?:sunn\w*|sun\s+ho\w*)[\s\S]{0,40}?\b(?:achanak|achaanak|ekdam|ek\s+dam|sudden\w*)\b|\b(?:lakwa|lakva|laqwa|lakua)\s+(?:mar|maar|pad|padh|ho|hua|aa|aaya|aya|lag)\w*/i;
const STROKE_HI = /अचानक[\s\S]{0,40}?(?:सुन्न|लकवा)|सुन्न[\s\S]{0,40}?अचानक|लकवा\s*(?:मार|पड|हो|हुआ|आ|लग)/;

// ─── Urgent ─────────────────────────────────────────────────────────────

/**
 * Plain reported chest pain — "seene me dard hai", "chhati me dard", "सीने में
 * दर्द". Severe chest pain stays critical (chest_pain_hinglish, severe_chest_pain_hi).
 * Negated ("dard nahi") and questions about it ("kyu hota hai") are not reports.
 */
const CHEST_PAIN_HINGLISH_RE = new RegExp(
  String.raw`\b(?:seene|seena|seeney|seenay|chhati|chhaati|chati|chaati|chest)\s+${HL_IN}\s+(?:\S+\s+){0,2}?(?:dard|pain)\b(?!\s+${HL_NOT}\b)`,
  "i",
);
const CHEST_PAIN_HINGLISH: Matcher = {
  test: (text: string) => CHEST_PAIN_HINGLISH_RE.test(text) && !isQuestionNotReport(text),
};
const CHEST_PAIN_HI: Matcher = {
  test: (text: string) =>
    /(?:सीने|सीना|छाती)\s*(?:में\s*)?(?:\S+\s*){0,2}?दर्द(?!\s*नहीं)/.test(text) && !isQuestionNotReport(text),
};

/** "tez bukhar", "bahut tej fever" — high_fever_hinglish only sees the intensifier AFTER bukhar. */
const HIGH_FEVER_HINGLISH_PRE =
  /\b(?:tez|tej|bahut|bohot|bahot|zyada|jyada|kaafi|kafi)\s+(?:(?:tez|tej)\s+)?(?:bukh?aa?r|fever)\b(?!\s+(?:nahi|nahin|nhi|na)\b)/i;
/** "bukhar 102", "fever 103 hai", "बुखार 102" — a reading at or above 101 °F / 38.5 °C. */
const HIGH_FEVER_NUMERIC =
  /(?:\b(?:bukh?aa?r|fever|temperature|temp|tapman)\b|बुखार|तापमान)\s*(?:\S+\s+)?(?:10[1-6](?:\.\d)?|38\.[5-9]|39(?:\.\d)?|4[01](?:\.\d)?)(?![\d.])/i;

/** [matcher, label] pairs, critical tier. */
export const INDIC_CRITICAL_PATTERNS: Array<[Matcher, string]> = [
  [VOMITING_BLOOD_HINGLISH, "vomiting_blood_hinglish"],
  [BLOOD_IN_STOOL_URINE_HINGLISH, "blood_in_body_fluid_hinglish"],
  [BLOOD_IN_STOOL_URINE_HI, "blood_in_body_fluid_hi"],
  [BLEEDING_NOT_STOPPING_HINGLISH_3, "bleeding_not_stopping_hinglish_3"],
  [BLEEDING_NOT_STOPPING_HI_3, "bleeding_not_stopping_hi_3"],
  [reportOnly(BREATHING_DIFFICULTY_HINGLISH), "breathing_difficulty_hinglish"],
  [reportOnly(BREATHING_DIFFICULTY_HI), "breathing_difficulty_hi"],
  [CHOKING_HINGLISH, "choking_hinglish"],
  [HEART_ATTACK_HINGLISH, "heart_attack_hinglish"],
  [HEART_ATTACK_HI, "heart_attack_hi"],
  [UNCONSCIOUS_HINGLISH_3, "unconscious_hinglish_3"],
  [SEIZURE_HINGLISH, "seizure_hinglish"],
  [SEIZURE_HI, "seizure_hi_2"],
  [COLLAPSED_HINGLISH, "collapsed_hinglish"],
  [COLLAPSED_HI, "collapsed_hi"],
  [STROKE_HINGLISH, "stroke_hinglish"],
  [STROKE_HI, "stroke_hi"],
];

/** [matcher, label] pairs, urgent tier. */
export const INDIC_URGENT_PATTERNS: Array<[Matcher, string]> = [
  [CHEST_PAIN_HINGLISH, "chest_pain_hinglish_plain"],
  [CHEST_PAIN_HI, "chest_pain_hi_plain"],
  [HIGH_FEVER_HINGLISH_PRE, "high_fever_hinglish_pre"],
  [HIGH_FEVER_NUMERIC, "high_fever_numeric"],
];

/** Every label defined here — lets tests assert that none of the NEW rules fire on a negative. */
export const INDIC_RED_FLAG_LABELS: string[] = [...INDIC_CRITICAL_PATTERNS, ...INDIC_URGENT_PATTERNS].map(([, l]) => l);
