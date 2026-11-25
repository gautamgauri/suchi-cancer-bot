/**
 * Which questions Suchi answers from verified practical material (issue #260).
 *
 * A practical question is about paying for treatment, finding a hospital,
 * documents, travel or a place to stay. Suchi answers those deterministically:
 * from the verified financial support file, from the hospital directory, or
 * with one plain reply saying it has no confirmed information.
 *
 * THE BOUNDARY WITH MEDICAL QUESTIONS IS CONSERVATIVE. A message is medical,
 * and takes the existing pipeline unchanged, if it contains ANY of:
 *   - a symptom or a body complaint (pain, lump, ulcer, bleeding, fever,
 *     vomiting, cough, breathlessness, swelling, weakness and so on), in
 *     English, romanised Hindi or Devanagari;
 *   - a named treatment or procedure (chemotherapy, radiotherapy, surgery,
 *     operation, transplant, immunotherapy, hormone therapy, dialysis, a PICC
 *     line or port);
 *   - a medicine or drug, or the words medicine, tablet, injection, dawa;
 *   - a dose (dose, dosage, mg);
 *   - a test, scan or report of any kind (test, scan, CT, PET, MRI, X-ray,
 *     biopsy, report, result, marker);
 *   - prognosis or staging (survive, survival, cure, curable, prognosis, life
 *     expectancy, chance, stage, grade, metastatic, spread, terminal,
 *     recover, "theek ho").
 *   - a growth, count or blood word (tumour, gilti, gaanth, blood, platelets,
 *     haemoglobin, neutropenia), recurrence ("came back", relapse), a
 *     decision about treatment ("stop treatment") or another system of
 *     medicine (ayurvedic, homeopathy, desi ilaj);
 *   - a procedure or drug name by its suffix (-ectomy, -oscopy, -otomy,
 *     -ostomy, -mab, -nib, -platin, -taxel, -rubicin);
 *   - ANY distress, self-harm, death or urgency word (die, death, point of
 *     living, jeena, marna, मर, burden, bojh, ending it, suicide, pills,
 *     overdose, poison, emergency, urgent, ICU, ventilator, unconscious, not
 *     waking, paralysis, hopeless, give up, scared, alone and variants).
 *     These are over-inclusive on purpose: when in doubt, not practical.
 * "Blood cancer" alone is a cancer type and does not count.
 * The generic words "cancer", "treatment", "ilaj" and "इलाज" are NOT medical
 * content on their own: they name what is being paid for or looked for, not
 * a clinical question. Naming a cancer type ("blood cancer") is not medical
 * content either. Everything else about the message is irrelevant: one
 * medical word anywhere sends the whole message down the medical path.
 *
 * This file decides only which kind of reply a practical message gets. The
 * safety screens have already run and returned for every message they catch.
 */

import { detectPlace, detectState, PlaceResult } from "../utils/location-detector";

// ─── Medical content (the conservative boundary) ─────────────────────────

const MEDICAL_LATIN: RegExp[] = [
  // Symptoms and complaints. Stems end in \w* where the word has endings, so
  // "hoga" after "theek ho" and "bachega" after "bach" are caught.
  /\b(pain\w*|aches?|aching|hurts?|hurting|lumps?|swelling|swollen|bleed\w*|bled|blood(?!\s+cancers?\b)\w*)\b/i,
  /\b(fever\w*|temperature|vomit\w*|nausea|nauseous|cough\w*|breathless\w*|breath|breathing|breathe)\b/i,
  /\b(ulcers?|sores?|wounds?|rash|rashes|itch\w*|fatigue|tired\w*|weak|weakness|dizz\w*|faint\w*|headaches?)\b/i,
  /\b(diarrh\w*|dast|loose\s+motions?|constipat\w*|stools?|weight\s+loss|losing\s+weight|appetite|discharge|numb|numbness|tingling|seizures?|fits)\b/i,
  /\b(confus\w*|jaundice|peeliya|piliya|pilia|yellow\w*|swallow\w*|hoarse\w*|not\s+healing|non[- ]healing|symptoms?|infection\w*|pus|cramps?)\b/i,
  /\b(tumou?rs?|growth|gilti|gilthi|ganth|gaanth|gath|gaath|dard|bukhar|bukhaar|khoon|khun|ulti|ultee|khansi|khaasi|khasi|sujan|soojan|ghav|ghaav|chhala|chhale|kamzori|kamjori|chakkar|saans|sans|jalan|kharash|thakan|thakaan)\b/i,
  /\b(platelets?|ha?emoglobin|hb|wbc|rbc|neutropeni\w*|counts?\s+(is\s+|are\s+)?(very\s+)?(low|high|down))\b/i,
  // Named treatments and procedures, and the suffixes procedure names share
  /\b(chemo\w*|kimo\w*|keemo\w*|kemo\w*|radiation|radiotherap\w*|radio\s+therapy|sikai|sekai|surg\w*|operat\w*|oparation|opration|sarjari|transplant\w*|bmt|bone\s+marrow|transfusion\w*|immunotherap\w*|targeted\s+therapy|hormon\w*\s+therapy|dialysis|picc|chemoport|port\s+line|catheter|stent|palliative|brachytherap\w*)\b/i,
  /\b\w+(ectomy|ectomies|oscopy|oscopies|otomy|ostomy)\b/i,
  // Medicines, drugs and doses, and the suffixes cancer drug names share
  /\b(medicines?|medication\w*|drugs?|tablets?|capsules?|injections?|dawa|dawai|dawaai|dawaiyan|goli|painkillers?|morphine|paracetamol|tamoxifen|letrozole|imatinib|trastuzumab|herceptin|cisplatin|paclitaxel|nivolumab|pembrolizumab|keytruda|opdivo)\b/i,
  /\b\w{3,}(mab|nib|platin|taxel|rubicin)\b/i,
  /\b(dose|doses|dosage|\d+\s*mg|milligrams?)\b/i,
  // Tests, scans, reports and results
  /\b(tests?|testing|scans?|ct|pet|mri|x-?rays?|mammogra\w*|ultrasound|sonography|biops\w*|pathology|reports?|results?|markers?|psa|cbc|fnac|pap\s+smear)\b/i,
  // Prognosis, staging, recurrence and decisions about treatment
  /\b(surviv\w*|cure|cured|curable|prognosis|life\s+expectancy|chances?|stage|stages|staging|grade|metasta\w*|spread\w*|terminal|recover\w*|relapse\w*|recurr\w*|(come|came|comes|coming)\s+back|returned|wapas\s+aa\w*)\b/i,
  /\b(theek\s+ho\w*|thik\s+ho\w*|bach\s*(ega|egi|enge|ega|na|ne|ti|ta)\b|bachega|bachegi|bachenge|bach\s+ja\w*|bach\s+sak\w*)/i,
  /\b(stop\w*\s+(the\s+)?(treatment|ilaa?j|therapy)|(treatment|ilaa?j)\s+band\w*|ayurved\w*|homo?eopath\w*|naturopath\w*|unani|siddha|herbal|desi\s+(ilaa?j|dawa\w*|nuskh\w*)|alternative|home\s+remed\w*|gharelu)\b/i,
];

const MEDICAL_DEVANAGARI =
  /(दर्द|बुखार|गांठ|गाँठ|गिल्टी|ट्यूमर|खून|ब्लड|उल्टी|खांसी|खाँसी|सूजन|घाव|छाला|छाले|थकान|कमजोरी|कमज़ोरी|चक्कर|सांस|साँस|जलन|लक्षण|पीलिया|दस्त|प्लेटलेट|हीमोग्लोबिन|कीमो|केमो|किमो|रेडिएशन|रेडियेशन|रेडियो|विकिरण|सिकाई|सिंकाई|सेकाई|सर्जरी|शल्य|ऑपरेशन|आपरेशन|ओपरेशन|ट्रांसप्लांट|दवा|दवाई|गोली|गोलियां|इंजेक्शन|जांच|जाँच|टेस्ट|रिपोर्ट|स्कैन|बायोप्सी|स्टेज|फैल|वापस\s*आ|ठीक\s*हो|बच\s*जा|बचेग|बचेंग|बचेगी|बच\s*सक|आयुर्वेद|होम्योपैथ|होमियोपैथ|देसी\s*इलाज|देसी\s*दवा|जड़ी|इलाज\s*बंद)/;

/**
 * Distress, self-harm, death and urgency words. A message with any of them is
 * never given a practical reply, so the screens' and the ordinary pipeline's
 * handling applies exactly as before. Over-inclusive by design.
 */
const DISTRESS_LATIN: RegExp[] = [
  /\b(die|dies|died|dying|death|deaths|dead|deadly|kill\w*|suicid\w*|self[- ]?harm\w*|ending\s+it|end\s+it|end\s+(my|our|his|her)\s+life|take\s+my\s+life)\b/i,
  /\b(point\s+(of|in)\s+living|reason\s+to\s+live|want\s+to\s+live|live\s+any\s*more|living\s+any\s*more|not\s+live|will\s+\w+(\s+\w+)?\s+live|how\s+long\s+.{0,30}\s+live|jeena|jeene|jina|jine|jeevan|zindagi|marna|marne|marenge|marega|maregi|mar\s+ja\w*|mar\s+jau\w*|mar\s+gay\w*|maut|khudkushi|aatmahatya)\b/i,
  /\b(burden|bojh|hopeless\w*|no\s+hope|give\s+up|giving\s+up|gave\s+up|can'?t\s+go\s+on|cannot\s+go\s+on|worthless|depress\w*|anxious|anxiety|panic\w*|scared|afraid|terrified|frightened|crying|cry|worr\w*|tension|pareshaa?n|alone|lonely|nirash|udaas|haar\s+gay\w*)\b/i,
  /\b(pills?|overdose\w*|poison\w*|zeher|zehar|zahar|emergency|urgent\w*|urgently|icu|ventilator\w*|oxygen|unconscious\w*|not\s+waking|won'?t\s+wake|not\s+responding|unresponsive|paraly\w*|lakwa|stroke|collaps\w*|accident\w*|chok\w*|behosh\w*|serious|critical|sinking|ambulance)\b/i,
];

const DISTRESS_DEVANAGARI =
  /(मर\s*(ना|ने|जा|जाऊ|जाऊं|जाऊँ|जाए|गया|गई|गए|ेंगे|ेगा|ेगी)|मरना|मरने|मौत|मृत्यु|आत्महत्या|ख़ुदकुशी|खुदकुशी|जान\s*दे|जीना|जीने|ज़िंदगी|जिंदगी|बोझ|ज़हर|जहर|बेहोश|लकवा|आईसीयू|वेंटिलेटर|ऑक्सीजन|इमरजेंसी|आपातकाल|एम्बुलेंस|उम्मीद\s*नहीं|हिम्मत|डर|अकेल|निराश|परेशान|रो\s*रह|हार\s*गय|गंभीर)/;

/** True when the message has any distress, self-harm, death or urgency word. */
export function hasDistressOrUrgency(text: string): boolean {
  const t = text.normalize("NFC");
  return DISTRESS_LATIN.some((re) => re.test(t)) || DISTRESS_DEVANAGARI.test(t);
}

/**
 * True when the message has any medical content, or any distress or urgency
 * word, under the rule at the top of this file. Such a message is never
 * answered by the practical replies.
 */
export function hasMedicalContent(text: string): boolean {
  const t = text.normalize("NFC");
  return MEDICAL_LATIN.some((re) => re.test(t)) || MEDICAL_DEVANAGARI.test(t) || hasDistressOrUrgency(t);
}

// ─── Paying for treatment ────────────────────────────────────────────────

export type PayTopic = "pmjay" | "senior" | "central_funds" | "pmnrf" | "railways" | "cghs" | "esic";

/** What a PM-JAY question asks about, used to pick the facts to show. */
export type PmjayAspect = "eligibility" | "card" | "documents" | "hospital" | "amount" | "no_card";

const PMJAY = /\b(ayushman|pm-?jay|pmjay|jan\s+arogya|golden\s+card)\b/i;
const PMJAY_HI = /आयुष्मान/;
const SENIOR = /\b(vay\s+vandana|senior\s+citizens?|(aged?|over|above)\s+7\d|7\d\+|(is|are|hai|hain)\s+(7|8|9)\d\b|(7|8|9)\d\s*(years?|yrs?|saal)\b)/i;
const CENTRAL_FUNDS =
  /\b(rashtriya\s+arogya\s+nidhi|arogya\s+nidhi|health\s+minister'?s?|hmcpf|hmdg|cancer\s+patients?'?\s+fund|discretionary\s+grant|central\s+(government|govt)\s+(fund|funds|grant|help|scheme\s+for\s+poor)|government\s+fund)\b/i;
const PMNRF =
  /\b(pmnrf|prime\s+minister'?s?\s+(national\s+)?relief\s+fund|pm'?s?\s+(national\s+)?relief\s+fund|pradhan\s*mantri\s+(rahat|rashtriya\s+rahat)\s+kosh)\b/i;
const RAILWAYS = /\b(train|trains|railways?|rail|irctc)\b/i;
const RAILWAYS_HI = /(ट्रेन|रेल)/;
const CGHS = /\b(cghs|central\s+government\s+health\s+scheme|central\s+(government|govt)\s+(employee|employees|pensioner|pensioners|servant))\b/i;
const ESIC = /\b(esic|esi|employees'?\s+state\s+insurance)\b/i;
const SCHEME_WORDS = /\b(schemes?|yojana|yojna|government|govt|sarkari|sarkaari|free|insurance|card|cover|covers|covered|pay|pays|money|financial|help|support)\b/i;
const SCHEME_WORDS_HI = /(योजना|सरकारी|मुफ्त|मुफ़्त|कार्ड|पैसा|पैसे|मदद|सहायता)/;
const GENERIC_MONEY =
  /\b(free\s+(cancer\s+)?(treatment|ilaj|ilaaj|care)|afford|can'?t\s+pay|cannot\s+pay|unable\s+to\s+pay|financial\s+(help|assistance|support|aid)|money\s+(help|for\s+(the\s+)?treatment)|poor\s+(family|families|patients?|people)|garib|gareeb|paise?\s+nahi|paisa\s+nahi|no\s+money|bpl|below\s+(the\s+)?poverty)\b/i;
const GENERIC_MONEY_HI = /(गरीब|ग़रीब|मुफ्त|मुफ़्त|पैसे\s*नहीं|आर्थिक\s*(मदद|सहायता))/;

const ASPECTS: Array<{ aspect: PmjayAspect; re: RegExp }> = [
  { aspect: "eligibility", re: /\b(eligib\w*|qualif\w*|patr|kaun\s+(le|ban)\s+sakta|check)\b|पात्र/i },
  { aspect: "card", re: /\b(card|banwa\w*|banva\w*|banaye\w*|banega|apply|register|enrol\w*)\b|कार्ड/i },
  { aspect: "documents", re: /\b(documents?|papers?|kagaz\w*|kaagaz\w*|carry|bring)\b|(दस्तावेज़|दस्तावेज|कागज़|कागज)/i },
  { aspect: "hospital", re: /\b(hospitals?|empanel\w*|where|kahan|kaha|kahaan|kidhar)\b|(अस्पताल|कहाँ|कहां)/i },
  { aspect: "amount", re: /\b(how\s+much|kitna|kitne|amount|lakh|limit|rupees?|rs)\b|(कितने|कितना|रुपये|लाख)/i },
  { aspect: "no_card", re: /\b(card\s+nahi|no\s+card|don'?t\s+have\s+(an?\s+)?(ayushman\s+)?card|card\s+nahin)\b|कार्ड\s*नहीं/i },
];

// ─── Practical questions with no verified answer ─────────────────────────

/** A place to stay. "Stay" alone is not enough: "stay positive" is not lodging. */
const LODGING =
  /\b(place\s+to\s+stay|places\s+to\s+stay|where\s+(can|do|should|will)\s+(we|i|they)\s+stay|stay\s+(near|close\s+to|during|while)|lodging|accommodation|dharamshala|dharmshala|hostel|hotels?|guest\s*house|rehne\s+ki|rukne\s+ki|rehne\s+ka|rukne\s+ka)\b|(रहने\s*की|ठहरने|धर्मशाला)/i;

const UNVERIFIED_PRACTICAL_LATIN =
  /\b(costs?|price|prices|charges|fees|expenses?|kharcha|kharch|kitna\s+(paisa|kharcha|lagega|lagta)|insurance|mediclaim|loans?|crowdfund\w*)\b|\bhow\s+much\b.{0,60}\b(cost|costs|rupees?|rs|money|pay|charge|charges|fee|fees|spend)\b/i;
const UNVERIFIED_PRACTICAL_HI = /(खर्च|कितने\s*रुपये|बीमा|किराया)/;

// ─── Where to go ─────────────────────────────────────────────────────────

const FACILITY = /\b(hospitals?|centres?|centers?|clinics?|oncologists?|doctors?|aspatal|aspataal|haspatal)\b/i;
const FACILITY_HI = /(अस्पताल|हॉस्पिटल|हस्पताल|केंद्र|सेंटर|डॉक्टर)/;
const SEEKING = /\b(where|which|best|good|nearest|near|any|list|kahan|kaha|kahaan|kidhar|kaun|kaunsa|kon|accha|acha|achha|recommend|suggest)\b/i;
const SEEKING_HI = /(कहाँ|कहां|किधर|कौन|अच्छा|नज़दीक|नजदीक|पास)/;
const FACILITY_IN_PLACE = /\b(hospitals?|centres?|centers?|clinics?|treatment|oncologists?|doctors?)\s+(in|near|at|around)\b/i;
const TREATMENT_WHERE =
  /\b(where|kahan|kaha|kahaan|kidhar)\b.{0,40}\b(treatment|treated|ilaj|ilaaj|care)\b|\b(treatment|ilaj|ilaaj)\b.{0,40}\b(where|kahan|kaha|kahaan|kidhar)\b/i;
const TREATMENT_WHERE_HI = /(इलाज|उपचार).{0,40}(कहाँ|कहां|किधर)|(कहाँ|कहां|किधर).{0,40}(इलाज|उपचार)/;
/** Errands this change does not answer: appointments, admissions, OPD. */
const ERRAND = /\b(appointment|registration|register|admission|admit|opd|visiting\s+hours|second\s+opinion)\b|(अपॉइंटमेंट|ओपीडी|दूसरी\s*राय)/i;

// ─── Routing ─────────────────────────────────────────────────────────────

export type PracticalRoute =
  | {
      kind: "pay";
      topics: PayTopic[];
      pmjayAspects: PmjayAspect[];
      /** A state the verified file covers, or one it does not (`stateCovered`). */
      state: string | null;
    }
  | { kind: "where"; place: PlaceResult | null }
  | { kind: "unverified" };

/**
 * True when the message asks where to find a hospital or treatment, with or
 * without a place. Used by the intent router as well, so that a hospital
 * question is not taken for a money question.
 */
export function isPlaceSeekingQuestion(text: string): boolean {
  const t = text.normalize("NFC");
  if (ERRAND.test(t)) return false;
  const place = detectPlace(t);
  const facility = FACILITY.test(t) || FACILITY_HI.test(t);
  const seeking = SEEKING.test(t) || SEEKING_HI.test(t);
  const treatmentWhere = TREATMENT_WHERE.test(t) || TREATMENT_WHERE_HI.test(t);
  if (treatmentWhere) return true;
  if (place && (facility || FACILITY_IN_PLACE.test(t))) return true;
  if (place && /\b(treatment|ilaj|ilaaj)\s+(in|near|at|mein)\b/i.test(t)) return true;
  if (place && facility && seeking) return true;
  // No place named: only a direct request for a hospital counts, so that
  // "doctor ne kaun sa test karne ko bola" is not a place question.
  return NO_PLACE_SEEKING.some((re) => re.test(t));
}

const NO_PLACE_SEEKING: RegExp[] = [
  /\b(which|best|good|nearest|any|recommend|suggest)\s+(cancer\s+|government\s+|govt\s+|private\s+)?(hospitals?|centres?|centers?|clinics?|oncologists?)\b/i,
  /\b(hospitals?|centres?|centers?|aspatal)\b.{0,30}\b(kaun\s*s[aie]|kahan|kaha|kahaan|kidhar|nearest|near\s+me)\b/i,
  /\b(kaun\s*s[aie]|sabse\s+acch?h?a)\s+(cancer\s+)?(hospital|aspatal)\b/i,
  /(कौन\s*सा|सबसे\s*अच्छा|नज़दीकी|नजदीकी)\s*(कैंसर\s*)?(अस्पताल|हॉस्पिटल)/,
  /(अस्पताल|हॉस्पिटल).{0,30}(कौन\s*सा|कहाँ|कहां)/,
];

function payTopics(t: string, stateNamed: boolean): PayTopic[] {
  const topics: PayTopic[] = [];
  if (CGHS.test(t)) topics.push("cghs");
  if (ESIC.test(t)) topics.push("esic");
  if (PMNRF.test(t)) topics.push("pmnrf");
  if (CENTRAL_FUNDS.test(t) && !topics.includes("cghs")) topics.push("central_funds");
  if (RAILWAYS.test(t) || RAILWAYS_HI.test(t)) topics.push("railways");
  const pmjay = PMJAY.test(t) || PMJAY_HI.test(t);
  if (SENIOR.test(t) && (pmjay || /\b(card|scheme|yojana)\b/i.test(t))) topics.push("senior");
  if (pmjay && !topics.includes("senior")) topics.push("pmjay");
  if (topics.length === 0 && !stateNamed && (GENERIC_MONEY.test(t) || GENERIC_MONEY_HI.test(t))) {
    topics.push("pmjay");
  }
  return topics;
}

/**
 * The practical route for a message, or null when the message is not a
 * practical question or has any medical content. A null route means the
 * message takes the existing pipeline unchanged.
 */
export function routePracticalQuestion(text: string): PracticalRoute | null {
  const t = text.normalize("NFC");
  if (hasMedicalContent(t)) return null;

  // A place to stay: nothing verified yet.
  if (LODGING.test(t)) return { kind: "unverified" };

  // Where to go comes before money, so "hospitals in Bangalore that accept
  // Ayushman" reaches the directory (assessment cause 3). A question about
  // where free treatment is, with no place named, is a money question: the
  // PM-JAY facts include how to find an empanelled hospital.
  const place = detectPlace(t);
  const moneyCue = GENERIC_MONEY.test(t) || GENERIC_MONEY_HI.test(t) || PMJAY.test(t) || PMJAY_HI.test(t);
  if (isPlaceSeekingQuestion(t) && (place !== null || !moneyCue)) {
    return { kind: "where", place };
  }

  const state = detectState(t) ?? place?.state ?? null;
  const schemeWords = SCHEME_WORDS.test(t) || SCHEME_WORDS_HI.test(t);
  const topics = payTopics(t, state !== null && schemeWords);
  const pmjayAspects = ASPECTS.filter((a) => a.re.test(t)).map((a) => a.aspect);

  if (topics.length > 0) {
    return { kind: "pay", topics, pmjayAspects, state: schemeWords || topics.includes("pmjay") ? state : null };
  }
  if (state && schemeWords) {
    return { kind: "pay", topics: [], pmjayAspects, state };
  }
  if (UNVERIFIED_PRACTICAL_LATIN.test(t) || UNVERIFIED_PRACTICAL_HI.test(t)) {
    return { kind: "unverified" };
  }
  return null;
}

/**
 * True when a message is a practical question (money, documents, travel,
 * lodging) with no medical content. Used where the pipeline would otherwise
 * refuse in medical words ("NCI sources", "consult a clinician").
 */
export function isPracticalNonMedical(text: string): boolean {
  const route = routePracticalQuestion(text);
  return route !== null && route.kind !== "where";
}
