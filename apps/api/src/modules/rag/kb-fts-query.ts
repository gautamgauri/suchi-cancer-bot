import { MEDICAL_TERM } from "./cross-lingual.service";

/**
 * Builds the tsquery text for the lexical arm of hybrid retrieval (issue #134).
 *
 * WHY: `KB_FTS_SEARCH_SQL` used to feed the raw question to
 * `websearch_to_tsquery('simple', $1)`. That function ANDs every token, and the
 * 'simple' configuration — chosen so Hindi/Hinglish tokenise at all — removes no
 * stopwords and stems nothing. A chunk therefore had to contain *every* word of
 * the question, including "of", "the", "hai", "kya", "meri". Measured on
 * production (2026-09-12): 0 hits for every natural-language English question
 * and for every Hinglish question, while the same words joined with OR matched
 * thousands of chunks. The lexical arm was healthy and silent, and hybrid
 * scoring still charged it 45% of the weight on long queries.
 *
 * WHAT THIS DOES INSTEAD
 *  1. Splits the (already translated) query into words, drops English stopwords,
 *     Hinglish/Hindi function words and chat filler, and de-duplicates. Quoted
 *     phrases ("hpv test") stay together as phrase terms. A word that
 *     `CrossLingualService`'s `MEDICAL_TERM` recognises is never dropped, whatever
 *     the stopword lists say.
 *  2. Separates the survivors into GENERIC terms — words that appear in nearly
 *     every chunk of a cancer knowledge base ("cancer", "treatment", …) and so
 *     carry almost no lexical signal — and SPECIFIC terms (everything else).
 *  3. Emits an OR of two-term conjunctions, which is the minimum-matched-terms
 *     floor expressed in the tsquery itself:
 *
 *       ('early' & 'warning') | ('early' & 'signs') | ('early' & 'cancer') | …
 *
 *     THE INVARIANT: every conjunction contains at least one SPECIFIC term, so
 *     two generic words can never form a hit on their own ("cancer" + "treatment"
 *     matches ~45 000 production chunks). Generic terms still take part when
 *     paired with a specific one — dropping them outright loses real recall on
 *     "breast cancer", "lung cancer treatment" — and when the query has nothing
 *     but generic words, two of *those* are required instead.
 *  4. Ranks with the same query. Measured against a plain `a | b | c` OR on a real
 *     Postgres, the pairwise form ranks strictly better: plain OR ties chunks that
 *     match 4 terms with chunks that match 3 (ts_rank_cd 0.3 vs 0.3), while the
 *     pairwise form separates them (0.070 / 0.042 / 0.025 / 0.020). Cover density
 *     then rewards chunks where several query terms occur close together, which is
 *     what "this chunk is about the question" looks like lexically.
 *  5. Returns null when nothing but function words is left, so the caller skips
 *     the arm for that turn instead of sending an empty tsquery.
 *
 * TOKENS ARE QUOTED, NOT RE-TOKENISED. Each surviving word is passed to
 * `to_tsquery` as a quoted string ('HER-2/neu'), so Postgres applies the same
 * parser to the query as `to_tsvector` applied to the content. Verified on a real
 * engine: to_tsvector('simple', 'the HER-2/neu receptor') indexes 'her' '-2'
 * '/neu' at consecutive positions and the quoted form expands to
 * 'her' <-> '-2' <-> '/neu', which matches; splitting the token ourselves into
 * "her"/"neu" would NOT match ('/neu' ≠ 'neu'). Single quotes and backslashes are
 * escaped, and only words containing a letter or a decimal digit are emitted, so
 * nothing from user text can reach the tsquery grammar or produce an empty
 * operand.
 *
 * The 'simple' config and the GIN expression index are unchanged: this file only
 * changes the TEXT that goes into to_tsquery, never the indexed expression.
 */

export interface KbFtsQuery {
  /** Text for `to_tsquery('simple', $1)`. */
  tsquery: string;
  /** Terms that made it into the tsquery, in the order they appeared. */
  terms: string[];
  /** Generic knowledge-base terms present in the query (never a hit on their own). */
  genericTerms: string[];
  /** Words removed as stopwords, function words or filler (for debugging retrieval logs). */
  droppedTerms: string[];
  /** How many of the emitted terms a chunk must contain to be a candidate. */
  minMatchedTerms: 1 | 2;
}

/**
 * Upper bound on specific terms that form conjunctions. n specific + m generic
 * terms produce n(n-1)/2 + n·m conjunctions, each of which the GIN extractor
 * turns into index keys; 8 + 3 gives at most 52, still a cheap bitmap scan. Long
 * WhatsApp paragraphs are cut to their first content words — the user's own words
 * come first in the query RagService passes down, expansions after.
 */
export const KB_FTS_MAX_SPECIFIC_TERMS = 8;
export const KB_FTS_MAX_GENERIC_TERMS = 3;

/** Nothing beyond this is a question any more; it is a pasted document. */
const MAX_QUERY_CHARS = 2000;

/** Standard English stopwords (function words) — 'simple' removes none of them. */
const ENGLISH_STOPWORDS = new Set<string>([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't", "as", "at",
  "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "can't", "cannot", "could", "couldn't",
  "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during",
  "each", "either", "else", "ever", "every",
  "few", "for", "from", "further",
  "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here",
  "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
  "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
  "let's", "me", "more", "most", "mustn't", "my", "myself",
  "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out",
  "over", "own",
  "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these",
  "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too",
  "under", "until", "up", "us", "very",
  "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's",
  "where", "where's", "which", "while", "who", "who's", "whom", "whose", "why", "why's", "will", "with", "won't",
  "would", "wouldn't",
  "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves",
  // modals / auxiliaries / frequent verbs that never carry lexical signal
  "may", "might", "must", "shall", "also", "just", "still", "yet", "even", "now", "already",
  "much", "many", "lot", "lots", "well", "way", "thing", "things", "something", "someone", "somebody", "anything",
  "anyone", "anybody", "everything", "everyone", "nothing", "none", "one", "ones",
  "get", "gets", "got", "getting", "go", "going", "goes", "went", "come", "comes", "came",
  "make", "makes", "made", "take", "takes", "took", "give", "gives", "gave", "put",
  "say", "says", "said", "see", "seen", "saw", "look", "looks", "looking",
  "think", "thinks", "thought", "feel", "feels", "felt", "seem", "seems", "seemed",
  "like", "likes", "mean", "means", "meant", "happen", "happens", "happened",
  "want", "wants", "wanted", "need", "needs", "needed", "know", "knows", "knew", "known",
  "tell", "tells", "told", "ask", "asks", "asked", "explain", "explains", "describe",
  "use", "uses", "used", "using", "able", "possible", "okay", "ok", "yes", "yeah",
  // chat filler / politeness
  "please", "plz", "pls", "thanks", "thank", "hello", "hi", "hey", "dear", "sir", "madam", "ma'am", "ji",
  "exact", "exactly", "really", "actually", "basically", "kindly", "quick", "quickly", "detail", "details",
  "information", "info", "regarding", "related",
  // artefacts of RagService's own rewrite ("tell me about X overview")
  "overview",
]);

/**
 * Romanised Hindi (Hinglish) function words and chat filler: the case/postposition
 * particles, pronouns, common auxiliaries, question words and kinship/person words
 * — the last because "meri mausi ko cancer hai" must not spend one of the two
 * required matches on "mausi", a word no English knowledge-base chunk contains.
 * Spelling variants are listed because Hinglish has no orthography.
 *
 * DELIBERATELY ABSENT: the content-bearing Hinglish words that
 * `CrossLingualService` also recognises — ilaaj, dawai, gaanth, bukhar, saans,
 * lakshan, janch, kharcha, sarkari, bachcha. Those are what the question is
 * *about*; `MEDICAL_TERM` guards the ones it knows, and kb-fts-query.spec.ts
 * pins the rest.
 */
const HINGLISH_FUNCTION_WORDS = new Set<string>([
  // copula / auxiliaries
  "hai", "hain", "hu", "hun", "hoon", "ho", "hoga", "hogi", "honge", "hogaa", "hota", "hoti", "hote", "hona", "hone",
  "tha", "thi", "the", "thay", "raha", "rahi", "rahe", "rha", "rhi", "rhe", "gaya", "gayi", "gaye", "gya",
  "gyi", "gye", "sakta", "sakti", "sakte", "sakoon", "sakun", "chahiye", "chaiye", "chahiyeh", "chahiya",
  "chahta", "chahti", "chahte", "paye", "paya", "payi", "diya", "diye", "di", "liya", "liye", "lena",
  "dena", "do", "de", "le", "kar", "karo", "kare", "karen", "karna", "karne", "karni", "karta", "karti", "karte",
  "kiya", "kiye", "kiyi", "kijiye", "kijiyega", "karke", "karwana", "karwaye", "karvana", "karaye", "karani",
  "karana", "wala", "wali", "wale", "vala", "vali", "vale", "waale", "waala", "waali",
  // postpositions / case markers / conjunctions
  "ka", "ki", "ke", "ko", "se", "me", "mein", "main", "mai", "par", "pe", "pr", "tak", "aur", "ya", "yaa",
  "kii", "toh", "to", "bhi", "bhee", "hee", "na", "nahi", "nahin", "nhi", "nahe", "mat", "kyunki",
  "kyuki", "kyonki", "lekin", "magar", "agar", "agr", "jab", "tab", "jo", "jis", "jiska", "jiski", "jiske",
  "iska", "iski", "iske", "isme", "ismein", "isse", "uska", "uski", "uske", "usme", "usmein", "usse", "inka",
  "inki", "inke", "unka", "unki", "unke", "lie", "waste", "vaste", "dauraan", "dauran", "doran",
  "douran", "baad", "pehle", "pahle", "phle", "saath", "sath", "bina", "andar", "bahar", "upar", "niche",
  "neeche", "paas", "pas", "taraf", "bare", "baare", "baray", "wajah", "vajah", "karan", "matlab", "yani",
  // pronouns / determiners
  "mera", "meri", "mere", "mujhe", "mujhko", "muje", "mujh", "hum", "hume", "humein", "hamein", "hamara", "hamari",
  "hamare", "humara", "humari", "humare", "apna", "apni", "apne", "aap", "aapka", "aapki", "aapke", "aapko", "apko",
  "tum", "tumhe", "tumhein", "tumhara", "tumhari", "tumhare", "tera", "teri", "tere", "tujhe", "tu",
  "wo", "woh", "vo", "voh", "ye", "yeh", "yah", "ve", "vah", "yahan", "yaha", "yahaan",
  "wahan", "waha", "vahan", "vaha", "koi", "kuch", "kuchh", "kucch", "sab", "sabhi", "sare", "saare", "har",
  "khud", "unhe", "unhen", "unko", "usko", "isko", "inko",
  // question words
  "kya", "kyaa", "kyu", "kyun", "kyon", "kaise", "kese", "kaisa", "kaisi", "kaisey", "kab", "kabhi", "kahan", "kaha",
  "kahaan", "kahin", "kitna", "kitni", "kitne", "kaun", "kon", "kaunsa", "kaunsi", "kaunse", "konsa", "konsi",
  // adverbs / quantifiers / filler
  "ab", "abhi", "phir", "fir", "bas", "bahut", "bohot", "bhut", "bahot", "thoda", "thodi", "thode", "zyada", "jyada",
  "jada", "kam", "sirf", "bilkul", "shayad", "shaayad", "jaldi", "turant", "achha", "accha", "acha", "theek", "thik",
  "sahi", "haan", "han", "ha", "nai", "nope", "bata", "batao", "bataiye", "bataye", "batayen", "batana", "batai",
  "batado", "bataen", "pucho", "poocho", "puchna", "samjhao", "samjhaye", "samjhaiye", "boliye", "bolo", "bolna",
  "suno", "dekho", "dekhiye", "jaankari", "jankari", "janna", "jaana", "jana", "jaanna", "pata", "malum", "maloom",
  "zaroor", "jaroor", "zaruri", "zaroori", "jaruri", "jaroori", "dhanyavad", "shukriya", "namaste", "namaskar",
  // kinship / person words (never in the English KB; would otherwise consume a match)
  "maa", "ma", "mummy", "mumma", "mata", "papa", "pita", "pitaji", "baap", "bhai", "bhaiya", "behen", "behan",
  "bahan", "didi", "beta", "beti", "bete", "chacha", "chachi",
  "mama", "mami", "mausi", "masi", "maasi", "mausa", "bua", "phupha", "nana", "nani", "dada", "dadi", "tau", "tai",
  "patni", "pati", "biwi", "bibi", "shadi", "saas", "sasur", "bahu", "damad", "dost", "aadmi", "aurat", "ladka",
  "ladki", "log", "logon", "logo", "insaan", "vyakti", "rishtedar", "parivar", "ghar", "gaon", "gaanv", "sheher",
  "shahar",
]);

/** Devanagari function words for queries that reach the arm untranslated. */
const HINDI_FUNCTION_WORDS = new Set<string>([
  "है", "हैं", "हूँ", "हूं", "हो", "होगा", "होगी", "होंगे", "होता", "होती", "होते", "होना", "होने", "था", "थी", "थे",
  "रहा", "रही", "रहे", "गया", "गयी", "गई", "गए", "सकता", "सकती", "सकते", "चाहिए", "चाहिये", "दिया", "लिया", "लिए",
  "करना", "करने", "करता", "करती", "करते", "किया", "कीजिए", "कीजिये", "कर", "करो", "करें", "वाला", "वाली", "वाले",
  "का", "की", "के", "को", "से", "में", "पर", "तक", "और", "या", "तो", "भी", "ही", "न", "ना", "नहीं", "मत", "क्योंकि",
  "लेकिन", "मगर", "अगर", "जब", "तब", "जो", "जिस", "इस", "उस", "इन", "उन", "इसका", "इसकी", "इसके", "उसका", "उसकी",
  "उसके", "उनका", "उनकी", "उनके", "साथ", "बाद", "पहले", "बिना", "दौरान", "बारे", "वजह", "मतलब",
  "मेरा", "मेरी", "मेरे", "मुझे", "मुझको", "हम", "हमें", "हमारा", "हमारी", "हमारे", "अपना", "अपनी", "अपने", "आप", "आपका",
  "आपकी", "आपके", "आपको", "तुम", "तुम्हें", "तुम्हारा", "वह", "वो", "यह", "ये", "वे", "मैं", "यहाँ", "यहां", "वहाँ", "वहां",
  "कोई", "कुछ", "सब", "सभी", "सारे", "हर", "खुद",
  "क्या", "क्यों", "क्यूँ", "कैसे", "कैसा", "कैसी", "कब", "कभी", "कहाँ", "कहां", "कहीं", "कितना", "कितनी", "कितने",
  "कौन", "कौनसा", "कौनसी", "कौन-सा",
  "अब", "अभी", "फिर", "बस", "बहुत", "थोड़ा", "थोड़ी", "ज़्यादा", "ज्यादा", "कम", "सिर्फ", "बिल्कुल", "शायद", "जल्दी",
  "अच्छा", "ठीक", "सही", "हाँ", "हां", "बताओ", "बताइए", "बताइये", "बताएं", "बताना", "बताए", "जानकारी", "जानना", "पता",
  "ज़रूरी", "जरूरी", "ज़रूर", "कृपया", "धन्यवाद", "शुक्रिया", "नमस्ते",
  "माँ", "मां", "मम्मी", "पापा", "पिता", "भाई", "बहन", "दीदी", "बेटा", "बेटी", "चाचा", "चाची", "मामा",
  "मामी", "मौसी", "बुआ", "नाना", "नानी", "दादा", "दादी", "पत्नी", "पति", "दोस्त", "आदमी", "औरत", "लड़का", "लड़की",
  "लोग", "लोगों", "परिवार", "घर", "गाँव", "गांव", "शहर",
]);

/**
 * Words present in nearly every chunk of a CANCER knowledge base. They are
 * legitimate medical terms and they stay in the query — but only ever paired with
 * a specific term, because on production "cancer" alone matches ~45 000 chunks
 * and "cancer" + "treatment" barely fewer.
 */
const GENERIC_KB_TERMS = new Set<string>([
  "cancer", "cancers", "cancerous", "tumor", "tumors", "tumour", "tumours", "disease", "diseases",
  "patient", "patients", "treatment", "treatments", "therapy", "therapies",
  "कैंसर", "ट्यूमर", "इलाज", "मरीज", "रोग", "बीमारी",
]);

/** Leading/trailing characters that are not letters, marks or digits (any script). */
const EDGE_PUNCTUATION = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu;

/**
 * A word only becomes a term if it holds a letter or a DECIMAL digit. Verified on
 * a real engine: to_tsvector('simple', '½') yields no lexeme at all, so quoting
 * such a word produces an empty tsquery operand — Postgres then silently drops it
 * (taking the minimum-matched-terms floor with it) or, if it is the only word,
 * builds an empty tsquery that matches nothing.
 */
const HAS_LEXEME_CHAR = /[\p{L}\p{Nd}]/u;

/** Double quotes of either typographic kind delimit a phrase. */
const QUOTED_PHRASE = /["“”]([^"“”]+)["“”]/g;

/** Quote one word for the tsquery grammar: 'it''s' — the only characters with meaning inside quotes. */
export function quoteTsqueryLexeme(word: string): string {
  return `'${word.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

interface Term {
  /** tsquery fragment: a quoted word, or quoted words joined by <-> for a phrase. */
  fragment: string;
  /** Lower-cased key used for de-duplication and classification. */
  key: string;
  /** Human-readable form for logs. */
  label: string;
  generic: boolean;
}

function normaliseWord(raw: string): string {
  return raw.replace(EDGE_PUNCTUATION, "");
}

function isFunctionWord(key: string): boolean {
  // A medical noun the cross-lingual layer recognises is content, always. This is
  // the guard against a future stopword-list edit quietly deleting "test" or
  // "report" from every query.
  if (MEDICAL_TERM.test(key)) return false;
  return (
    ENGLISH_STOPWORDS.has(key) ||
    HINGLISH_FUNCTION_WORDS.has(key) ||
    HINDI_FUNCTION_WORDS.has(key) ||
    // Single letters and lone digits ("i", "a", "2") match everywhere and mean nothing.
    [...key].length < 2
  );
}

/** Split free text into words, dropping function words and filler. */
function contentWords(text: string): { kept: Array<{ word: string; key: string }>; dropped: string[] } {
  const kept: Array<{ word: string; key: string }> = [];
  const dropped: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const word = normaliseWord(raw);
    if (!word || !HAS_LEXEME_CHAR.test(word)) continue;
    const key = word.toLowerCase();
    if (isFunctionWord(key)) {
      dropped.push(word);
    } else {
      kept.push({ word, key });
    }
  }
  return { kept, dropped };
}

/**
 * Every two-term conjunction that contains at least one specific term. This is
 * the minimum-matched-terms floor: a chunk is a candidate only if it holds two of
 * the query's terms, at least one of which actually discriminates.
 */
function conjunctions(specific: Term[], generic: Term[]): string {
  const out: string[] = [];
  for (let i = 0; i < specific.length; i++) {
    for (let j = i + 1; j < specific.length; j++) {
      out.push(`(${specific[i].fragment} & ${specific[j].fragment})`);
    }
    for (const g of generic) {
      out.push(`(${specific[i].fragment} & ${g.fragment})`);
    }
  }
  return out.join(" | ");
}

/** Pairs among generic terms only — used when the query has no specific term at all. */
function genericOnlyConjunctions(generic: Term[]): string {
  const out: string[] = [];
  for (let i = 0; i < generic.length; i++) {
    for (let j = i + 1; j < generic.length; j++) {
      out.push(`(${generic[i].fragment} & ${generic[j].fragment})`);
    }
  }
  return out.join(" | ");
}

/**
 * Turn a (translated) user query into the tsquery text for KB_FTS_SEARCH_SQL, or
 * `null` when nothing lexical is left to search for.
 */
export function buildKbFtsQuery(rawQuery: string): KbFtsQuery | null {
  if (typeof rawQuery !== "string") return null;
  const query = rawQuery.slice(0, MAX_QUERY_CHARS);

  const terms: Term[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();

  const push = (term: Term) => {
    if (seen.has(term.key)) return;
    seen.add(term.key);
    terms.push(term);
  };

  // 1. Quoted phrases stay phrases. Every word of a phrase is kept — the user
  //    asked for that exact sequence — unless nothing but punctuation remains.
  let rest = query.replace(QUOTED_PHRASE, (_match, inner: string) => {
    const words = inner
      .split(/\s+/)
      .map(normaliseWord)
      .filter((w) => w.length > 0 && HAS_LEXEME_CHAR.test(w));
    if (words.length === 0) return " ";
    const key = words.map((w) => w.toLowerCase()).join(" ");
    if (words.length === 1) {
      if (isFunctionWord(key)) {
        dropped.push(words[0]);
      } else {
        push({ fragment: quoteTsqueryLexeme(words[0]), key, label: words[0], generic: GENERIC_KB_TERMS.has(key) });
      }
    } else {
      push({
        // Parenthesised so the fragment stays one operand however it is combined.
        fragment: `(${words.map(quoteTsqueryLexeme).join(" <-> ")})`,
        key,
        label: `"${words.join(" ")}"`,
        generic: false,
      });
    }
    return " ";
  });
  // An unbalanced quote is just punctuation.
  rest = rest.replace(/["“”]/g, " ");

  // 2. Everything else: content words only.
  const { kept, dropped: droppedWords } = contentWords(rest);
  dropped.push(...droppedWords);
  for (const { word, key } of kept) {
    push({ fragment: quoteTsqueryLexeme(word), key, label: word, generic: GENERIC_KB_TERMS.has(key) });
  }

  if (terms.length === 0) return null;

  let specific = terms.filter((t) => !t.generic);
  let generic = terms.filter((t) => t.generic);
  if (specific.length > KB_FTS_MAX_SPECIFIC_TERMS) {
    dropped.push(...specific.slice(KB_FTS_MAX_SPECIFIC_TERMS).map((t) => t.label));
    specific = specific.slice(0, KB_FTS_MAX_SPECIFIC_TERMS);
  }
  if (generic.length > KB_FTS_MAX_GENERIC_TERMS) {
    dropped.push(...generic.slice(KB_FTS_MAX_GENERIC_TERMS).map((t) => t.label));
    generic = generic.slice(0, KB_FTS_MAX_GENERIC_TERMS);
  }

  // 3. The minimum-matched-terms floor, expressed in the tsquery itself.
  let tsquery: string;
  let used: Term[];
  let minMatchedTerms: 1 | 2;

  if (specific.length === 0) {
    // Only generic words ("cancer ka treatment"). Two of them, or the single one
    // we have — a one-word query cannot be a "flood" the user did not ask for,
    // and LIMIT + rank bound it.
    if (generic.length === 1) {
      tsquery = generic[0].fragment;
      minMatchedTerms = 1;
    } else {
      tsquery = genericOnlyConjunctions(generic);
      minMatchedTerms = 2;
    }
    used = generic;
  } else if (specific.length === 1 && generic.length === 0) {
    tsquery = specific[0].fragment;
    used = specific;
    minMatchedTerms = 1;
  } else {
    tsquery = conjunctions(specific, generic);
    used = [...specific, ...generic];
    minMatchedTerms = 2;
  }

  const usedKeys = new Set(used.map((t) => t.key));
  return {
    tsquery,
    // First-appearance order across both classes, so logs read like the question.
    terms: terms.filter((t) => usedKeys.has(t.key)).map((t) => t.label),
    genericTerms: generic.map((t) => t.label),
    droppedTerms: dropped,
    minMatchedTerms,
  };
}
