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

    // Also add a purely-English medical equivalent if we have enough terms
    if (translatedTerms.length >= 2) {
      const medicalQuery = translatedTerms.join(" ");
      if (medicalQuery !== translated) {
        parallelQueries.push(medicalQuery);
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
