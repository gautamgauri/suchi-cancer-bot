/**
 * Cross-Lingual Retrieval Layer — Phase 2
 *
 * Lightweight Hindi↔English query translation for improved retrieval.
 * Uses a static bilingual dictionary (zero LLM cost) to generate
 * parallel queries so Hindi input can retrieve English KB content
 * and vice versa.
 *
 * Design principles:
 *  - Zero LLM calls (charitable project cost constraint)
 *  - Focus on cancer/medical/navigation terminology
 *  - Returns parallel queries rather than single translation
 *  - Falls back gracefully: if no translation found, uses original
 */

import { Injectable, Logger } from "@nestjs/common";

export interface CrossLingualResult {
  /** Original query */
  original: string;
  /** Translated/parallel queries (may include original) */
  parallelQueries: string[];
  /** Detected language */
  detectedLanguage: "en" | "hi" | "mixed";
  /** Terms that were translated */
  translatedTerms: string[];
}

// ─── Hindi → English medical dictionary ──────────────────────────

const HI_EN_DICTIONARY: Array<[RegExp, string]> = [
  // Cancer types — specific (multi-word) types MUST come before the generic
  // /कैंसर/, otherwise "स्तन कैंसर" gets the bare word replaced first and
  // "breast cancer" never forms (longest-match-first ordering).
  [/स्तन\s*कैंसर/g, "breast cancer"],
  [/फेफड़े?\s*(का|के|की)?\s*कैंसर/g, "lung cancer"],
  [/गर्भाशय\s*(का|के|की)?\s*कैंसर/g, "cervical cancer"],
  [/मुंह\s*(का|के|की)?\s*कैंसर/g, "oral cancer"],
  [/खून\s*(का|के|की)?\s*कैंसर/g, "blood cancer"],
  [/पेट\s*(का|के|की)?\s*कैंसर/g, "stomach cancer"],
  [/लिवर\s*(का|के|की)?\s*कैंसर/g, "liver cancer"],
  [/गुर्दे?\s*(का|के|की)?\s*कैंसर/g, "kidney cancer"],
  [/प्रोस्टेट\s*कैंसर/g, "prostate cancer"],
  [/ब्रेन\s*(ट्यूमर|कैंसर)/g, "brain cancer"],
  [/कैंसर/g, "cancer"],

  // Pregnancy & family context (issue #126: a pregnancy question retrieved
  // breast-milk content because none of these words reached the English KB)
  [/गर्भवती/g, "pregnant"],
  [/गर्भावस्था/g, "pregnancy"],
  [/गर्भ\s*में/g, "in the womb"],
  [/स्तनपान/g, "breastfeeding"],
  [/बच्चे|बच्चा|शिशु/g, "baby"],
  [/नुकसान/g, "harm"],

  // Symptoms
  [/लक्षण/g, "symptoms"],
  [/गांठ/g, "lump"],
  [/दर्द/g, "pain"],
  [/खून\s*आना/g, "bleeding"],
  [/बुखार/g, "fever"],
  [/थकान/g, "fatigue"],
  [/वज़न\s*(कम|घटना)/g, "weight loss"],
  [/भूख\s*(नहीं|कम)/g, "loss of appetite"],
  [/उल्टी/g, "vomiting"],
  [/दस्त/g, "diarrhea"],
  [/सूजन/g, "swelling"],
  [/खांसी/g, "cough"],
  [/सांस/g, "breath"],

  // Treatment
  [/इलाज/g, "treatment"],
  [/कीमो(थेरेपी)?/g, "chemotherapy"],
  [/रेडिएशन/g, "radiation"],
  [/सर्जरी|ऑपरेशन/g, "surgery"],
  [/दवा(ई|इयां)?/g, "medicine"],
  [/बायोप्सी/g, "biopsy"],
  [/जांच/g, "test"],
  [/रिपोर्ट/g, "report"],

  // Navigation
  [/अस्पताल|हॉस्पिटल/g, "hospital"],
  [/डॉक्टर/g, "doctor"],
  [/ओपीडी/g, "OPD"],
  [/अपॉइंटमेंट/g, "appointment"],
  [/कागज़ात|दस्तावेज़/g, "documents"],

  // Government/Schemes
  [/सरकारी/g, "government"],
  [/योजना|स्कीम/g, "scheme"],
  [/आयुष्मान/g, "Ayushman Bharat"],
  [/गरीबी\s*रेखा/g, "below poverty line"],
  [/बीमा/g, "insurance"],
  [/मदद|सहायता/g, "help"],

  // Question words / common verbs
  [/कैसे/g, "how"],
  [/क्या/g, "what"],
  [/कहां|कहाँ/g, "where"],
  [/कब/g, "when"],
  [/कौन\s*सा?/g, "which"],
  [/कितना/g, "how much"],
  [/चाहिए/g, "needed"],
  [/ज़रूरी/g, "required"],
  [/बताइए|बताओ|बताएं/g, "tell me about"],
];

// ─── Hinglish → English dictionary ───────────────────────────────

const HINGLISH_EN_DICTIONARY: Array<[RegExp, string]> = [
  // Common Hinglish sentence patterns
  [/\bmujhe\b/gi, "I need"],
  [/\bjaankari\b/gi, "information"],
  [/\bjankari\b/gi, "information"],
  [/\bke\s*baare\s*mein\b/gi, "about"],
  [/\bke\s*bare\s*me\b/gi, "about"],
  [/\bbatao\b/gi, "tell me"],
  [/\bbataiye\b/gi, "tell me"],
  [/\bbataye\b/gi, "tell me"],
  [/\bkya\s*hai\b/gi, "what is"],
  [/\bkya\s*hota\s*hai\b/gi, "what is"],

  // Cancer types in Hinglish
  [/\bmunh?\s*(ka|ke|ki)?\s*cancer\b/gi, "oral cancer"],
  [/\bpet\s*(ka|ke|ki)?\s*cancer\b/gi, "stomach cancer"],
  [/\bkhoon\s*(ka|ke|ki)?\s*cancer\b/gi, "blood cancer"],
  [/\bphephde?\s*(ka|ke|ki)?\s*cancer\b/gi, "lung cancer"],

  // Pregnancy & family context (issue #126)
  [/\b(pregnant|pregnent|garbhw?a?vati|garbhwati)\b/gi, "pregnant"],
  [/\bpet\s*se\s*hai\b/gi, "is pregnant"],
  [/\b(bachch?a|bacch?a|bachch?e|bacch?e|bachch?on|shishu)\b/gi, "baby"],
  [/\bnuk?saan\b/gi, "harm"],
  [/\bbreast\s*feeding\b/gi, "breastfeeding"],

  // Medical terms
  [/\bilaaj\b/gi, "treatment"],
  [/\bdawai?\b/gi, "medicine"],
  [/\bhospital\s*(ka|ki|ke)\s*(time|samay|timing)\b/gi, "hospital timing"],
  [/\bkaise\s*(pata|jaane)\b/gi, "how to know"],
  [/\bkaise\s*hota\b/gi, "how does it happen"],
  [/\bkaun\s*sa\b/gi, "which"],
  [/\baage\s*kya\b/gi, "what next"],
  [/\bpaise?\s*(ki|ka|ke)\b/gi, "money for"],
  [/\bcard\s*kaise\s*ban(ega|vaye)\b/gi, "how to get card"],
  [/\bgaanth\b/gi, "lump"],
  [/\bbukhar\b/gi, "fever"],
  [/\bdard\b/gi, "pain"],
  [/\bkhoon\b/gi, "blood"],
  [/\bsaans\b/gi, "breathing"],
  [/\bkaagaz(aat)?\b/gi, "documents"],
  [/\bkharcha\b/gi, "cost"],
  [/\bsarkari\b/gi, "government"],
  [/\blakshan\b/gi, "symptoms"],
  [/\bjach\b/gi, "test"],
  [/\bjanch\b/gi, "test"],
  [/\bsurjari\b/gi, "surgery"],
  [/\bchahiye\b/gi, "needed"],
];

// ─── Keyword-query gate and scenario expansions ──────────────────

/**
 * A translated term counts towards the English keyword query only if it is a
 * medical noun (or phrase containing one). Function words that the dictionaries
 * also translate — "tell me", "what", "how", "needed", "I need", "information",
 * "about", "help" — must never form a query on their own.
 */
const MEDICAL_TERM =
  /\b(cancer|tumou?r|symptoms?|lump|pain|bleeding|blood|fever|fatigue|vomiting|diarrhea|swelling|cough|breath(ing)?|weight loss|appetite|treatment|chemotherapy|radiation|surgery|medicine|biopsy|test|report|hospital|doctor|OPD|appointment|scheme|insurance|Ayushman|pregnan(t|cy)|womb|baby|breastfeeding|harm)\b/i;

/** Extra English queries for situations everyday Hindi/Hinglish words under-specify. */
const SCENARIO_EXPANSIONS: Array<{ when: RegExp[]; unless: RegExp[]; add: string }> = [
  {
    // Pregnant + baby/child + cancer/treatment/medicine → the fetus, not a nursing infant.
    when: [/\bpregnan(t|cy)\b|\bin the womb\b/i, /\b(baby|child|fetus)\b/i, /\b(cancer|treatment|chemotherapy|medicine|radiation|surgery)\b/i],
    unless: [/\b(breastfeed(ing)?|nursing|breast milk|lactation)\b/i],
    add: "cancer treatment during pregnancy effects on the unborn baby fetus",
  },
];

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class CrossLingualService {
  private readonly logger = new Logger(CrossLingualService.name);

  /**
   * Generate parallel queries for cross-lingual retrieval.
   * Returns original + translated versions.
   */
  generateParallelQueries(query: string): CrossLingualResult {
    const language = this.detectLanguage(query);
    const translatedTerms: string[] = [];
    const parallelQueries: string[] = [query]; // Always include original

    // Short-circuit ONLY for pure English (no Devanagari at all). A query that
    // classifies "en" by ratio but still contains Devanagari medical terms
    // (e.g. "treatment for स्तन cancer stage 2") must still be translated for the
    // English KB — the Devanagari nouns are the highest-value retrieval terms.
    // We keep detectedLanguage as classified; only the translation runs.
    const hasDevanagari = /[ऀ-ॿ]/.test(query);
    if (language === "en" && !hasDevanagari) {
      // Pure English — no translation needed for the English-primary KB.
      return {
        original: query,
        parallelQueries: [query],
        detectedLanguage: "en",
        translatedTerms: [],
      };
    }

    // Hindi or mixed → translate to English
    let translated = query;

    // Apply Hindi → English dictionary
    for (const [pattern, replacement] of HI_EN_DICTIONARY) {
      const before = translated;
      translated = translated.replace(pattern, replacement);
      if (translated !== before) {
        translatedTerms.push(replacement);
      }
    }

    // Apply Hinglish → English dictionary
    for (const [pattern, replacement] of HINGLISH_EN_DICTIONARY) {
      const before = translated;
      translated = translated.replace(pattern, replacement);
      if (translated !== before) {
        translatedTerms.push(replacement);
      }
    }

    // Clean up: remove extra spaces, trim
    translated = translated.replace(/\s+/g, " ").trim();

    // Only add translated version if it's meaningfully different
    if (translated !== query && translatedTerms.length > 0) {
      parallelQueries.push(translated);
    }

    // Also add a purely-English medical equivalent — but only from MEDICAL terms.
    // Before this gate the keyword query for "…dawai se bachcha affected hoga?
    // exact batao" was literally "tell me medicine" (issue #126): two translated
    // function words with no medical noun, which retrieves noise.
    const medicalTerms = translatedTerms.filter((t) => MEDICAL_TERM.test(t));
    if (medicalTerms.length >= 2) {
      const medicalQuery = medicalTerms.join(" ");
      if (medicalQuery !== translated && !parallelQueries.includes(medicalQuery)) {
        parallelQueries.push(medicalQuery);
      }
    }

    // Scenario expansions: a Hinglish/Hindi question can describe a clinical
    // situation with everyday words the English KB never uses ("bachcha" for an
    // unborn baby). Add one explicit English scenario query so the right section
    // ranks (issue #126: the pregnancy question matched the *nursing* baby text).
    for (const expansion of SCENARIO_EXPANSIONS) {
      if (
        expansion.when.every((re) => re.test(translated)) &&
        !expansion.unless.some((re) => re.test(translated)) &&
        !parallelQueries.includes(expansion.add)
      ) {
        parallelQueries.push(expansion.add);
        translatedTerms.push(expansion.add);
      }
    }

    // Extract medical topic noun phrases from the (partially translated) query
    // for clean retrieval — e.g., "oral cancer", "breast cancer symptoms"
    const topicPatterns = [
      /\b(oral|breast|lung|cervical|prostate|colorectal|stomach|liver|kidney|brain|blood|skin|pancreatic|ovarian|bladder)\s+cancer\b/gi,
      /\b(cancer)\s+(symptoms|treatment|diagnosis|screening|prevention|causes|stages?|signs)\b/gi,
      /\b(symptoms|treatment|diagnosis|screening)\s+of\s+(cancer|[a-z]+\s+cancer)\b/gi,
    ];
    for (const pattern of topicPatterns) {
      const matches = translated.match(pattern) || query.match(pattern);
      if (matches) {
        for (const match of matches) {
          const topicQuery = match.trim();
          if (topicQuery.length > 3 && !parallelQueries.includes(topicQuery)) {
            parallelQueries.push(topicQuery);
          }
        }
      }
    }

    this.logger.debug({
      event: "cross_lingual_translation",
      original: query.substring(0, 50),
      language,
      translatedTerms,
      parallelQueryCount: parallelQueries.length,
    });

    return {
      original: query,
      parallelQueries,
      detectedLanguage: language,
      translatedTerms,
    };
  }

  /**
   * Detect the primary language of a query.
   * Also detects Romanized Hindi (Hinglish) by checking for common Hindi words in Latin script.
   */
  private detectLanguage(text: string): "en" | "hi" | "mixed" {
    const devanagariCount = (text.match(/[\u0900-\u097F]/g) || []).length;
    const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
    const total = devanagariCount + latinCount;

    if (total === 0) return "en"; // Empty or only symbols

    const devanagariRatio = devanagariCount / total;

    if (devanagariRatio > 0.6) return "hi";
    // Threshold of 0.2 (not 0.1): a lone Hindi word inside an otherwise English
    // sentence (e.g. "...in Hindi कैंसर") should read as English, while a
    // genuinely code-mixed query (~40%+ Devanagari) reads as mixed.
    if (devanagariRatio > 0.2) return "mixed";

    // Check for Romanized Hindi (Hinglish) — all Latin script but Hindi words
    const hinglishMarkers = /\b(mujhe|jaankari|jankari|baare\s*mein|bare\s*me|batao|bataiye|chahiye|kaise|kya\s*hai|ilaaj|dawai|gaanth|bukhar|saans|lakshan|janch|aage\s*kya|paise|sarkari|kharcha)\b/gi;
    const matches = text.match(hinglishMarkers) || [];
    if (matches.length >= 1) return "mixed";

    return "en";
  }
}
