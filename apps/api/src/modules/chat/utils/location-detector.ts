/**
 * Place recognition for Indian cities and states, in Latin script, romanised
 * Hindi and Devanagari.
 *
 * Matching rules (issue #260 assessment, cause 4):
 *  1. Exact matches first: a city's canonical name or one of its aliases, then
 *     multi-word aliases ("new delhi", "bodh gaya"), then states.
 *  2. Fuzzy matching only for words of six letters or more, against aliases of
 *     six letters or more, and only at an edit distance of one. Before this a
 *     two-letter difference was accepted for any word of three letters or
 *     more, so "Kochi" was read as "kashi" (Varanasi), "Tata" as Patna and
 *     "Any" as "ara" (Arrah).
 *  3. Common words and words from hospital names are never matched fuzzily.
 *  4. A few aliases are also ordinary words ("gaya" is the Hinglish past tense
 *     of "go"). They count only after a place word such as "in", "near" or
 *     "from", or before "mein", "se" or "ke paas".
 *  5. Devanagari names are matched exactly, never fuzzily.
 */

export interface LocationResult {
  city: string;
  state: string;
  confidence: number;
}

/** A recognised place: a city with its state, or a state on its own. */
export interface PlaceResult {
  city: string | null;
  state: string;
  confidence: number;
}

interface CityEntry {
  canonical: string;
  state: string;
  aliases: string[];
  /**
   * Aliases that are also ordinary words. Matched only in a place context
   * (rule 4 above), never in the plain word scan.
   */
  contextOnly?: string[];
  /**
   * [latitude, longitude] of the town itself — NOT of the district that shares
   * its name, which can sit tens of kilometres away.
   *
   * Geocoded once, offline, by `scripts/geocode-hospitals.py --cities` against
   * public Nominatim, and committed here so nothing is resolved at runtime. Each
   * value cleared two hard gates: the returned address had to name both this
   * city and its state, and the point had to fall inside India. Optional so an
   * entry can be added before it is geocoded. An entry without coordinates is
   * recognised and mapped to its state, and the hospital search then uses the
   * city and state rungs instead of distance.
   *
   * Locality precision. Adequate for ordering cancer centres that are tens of
   * kilometres apart; never adequate for a travel time or a street address.
   */
  coords?: [number, number];
}

/**
 * Indian cities. The first block is the original Bihar-focused table with its
 * geocoded points. The second adds every city the hospital directory holds
 * that the table lacked, and two cities named in the assessment's questions
 * (Kochi, Ludhiana). The added entries carry no coordinates yet.
 */
const INDIAN_CITIES: CityEntry[] = [
  // Bihar
  { canonical: 'Muzaffarpur', state: 'Bihar', aliases: ['muzaffarpur', 'muzzafarpur', 'muzafarpur', 'muzaffurpur', 'मुजफ्फरपुर', 'मुज़फ़्फ़रपुर', 'मुज़फ्फरपुर'], coords: [26.1183, 85.3858] },
  { canonical: 'Patna', state: 'Bihar', aliases: ['patna', 'patnaa', 'पटना'], coords: [25.6093, 85.1235] },
  { canonical: 'Gaya', state: 'Bihar', aliases: ['bodh gaya', 'bodhgaya', 'gayaa', 'बोधगया'], contextOnly: ['gaya', 'गया'], coords: [24.7964, 85.008] },
  { canonical: 'Bhagalpur', state: 'Bihar', aliases: ['bhagalpur', 'bhagalpoor', 'भागलपुर'], coords: [25.2495, 86.9828] },
  { canonical: 'Darbhanga', state: 'Bihar', aliases: ['darbhanga', 'darbangha', 'दरभंगा'], coords: [26.157, 85.8995] },
  { canonical: 'Purnia', state: 'Bihar', aliases: ['purnia', 'purnea', 'purneya', 'पूर्णिया'], coords: [25.7774, 87.4731] },
  { canonical: 'Arrah', state: 'Bihar', aliases: ['arrah', 'arah'], contextOnly: ['ara', 'आरा'], coords: [25.5603, 84.6632] },
  { canonical: 'Begusarai', state: 'Bihar', aliases: ['begusarai', 'begusrai', 'बेगूसराय'], coords: [25.4139, 86.1349] },
  { canonical: 'Katihar', state: 'Bihar', aliases: ['katihar', 'katiyar', 'कटिहार'], coords: [25.5434, 87.569] },
  { canonical: 'Munger', state: 'Bihar', aliases: ['munger', 'monghyr', 'munghyr', 'मुंगेर'], coords: [25.3774, 86.4731] },
  { canonical: 'Chhapra', state: 'Bihar', aliases: ['chhapra', 'chapra', 'chapara', 'छपरा'], coords: [25.7784, 84.7515] },
  { canonical: 'Samastipur', state: 'Bihar', aliases: ['samastipur', 'samasthipur', 'समस्तीपुर'], coords: [25.8597, 85.7839] },
  { canonical: 'Hajipur', state: 'Bihar', aliases: ['hajipur', 'hajeepur', 'हाजीपुर'], coords: [25.6906, 85.209] },
  { canonical: 'Sasaram', state: 'Bihar', aliases: ['sasaram', 'sasaaram', 'सासाराम'], coords: [24.951, 84.0149] },
  { canonical: 'Dehri', state: 'Bihar', aliases: ['dehri', 'dehri on sone', 'डेहरी'], coords: [24.9078, 84.1901] },
  { canonical: 'Siwan', state: 'Bihar', aliases: ['siwan', 'seewan', 'सीवान'], coords: [26.2185, 84.3585] },
  { canonical: 'Motihari', state: 'Bihar', aliases: ['motihari', 'motihaari', 'मोतिहारी'], coords: [26.6507, 84.9115] },
  { canonical: 'Nawada', state: 'Bihar', aliases: ['nawada', 'nawaada', 'नवादा'], coords: [24.8932, 85.5452] },
  { canonical: 'Bagaha', state: 'Bihar', aliases: ['bagaha', 'bagahaa', 'बगहा'], coords: [27.0979, 84.0894] },
  { canonical: 'Bettiah', state: 'Bihar', aliases: ['bettiah', 'betiah', 'betiyaa', 'बेतिया'], coords: [26.8023, 84.5074] },
  { canonical: 'Jehanabad', state: 'Bihar', aliases: ['jehanabad', 'jahanabad', 'जहानाबाद'], coords: [25.2232, 84.9565] },
  { canonical: 'Aurangabad', state: 'Bihar', aliases: ['aurangabad', 'औरंगाबाद'], coords: [24.7537, 84.3747] },
  { canonical: 'Buxar', state: 'Bihar', aliases: ['buxar', 'baksar', 'बक्सर'], coords: [25.5716, 83.973] },
  { canonical: 'Kishanganj', state: 'Bihar', aliases: ['kishanganj', 'kishangunj', 'किशनगंज'], coords: [26.1014, 87.9508] },
  // Jharkhand
  { canonical: 'Ranchi', state: 'Jharkhand', aliases: ['ranchi', 'raanchi', 'रांची', 'राँची'], coords: [23.3701, 85.325] },
  { canonical: 'Jamshedpur', state: 'Jharkhand', aliases: ['jamshedpur', 'jamsedpur', 'tatanagar', 'जमशेदपुर'], coords: [22.8015, 86.203] },
  { canonical: 'Dhanbad', state: 'Jharkhand', aliases: ['dhanbad', 'dhanabaad', 'धनबाद'], coords: [23.7953, 86.431] },
  { canonical: 'Bokaro', state: 'Jharkhand', aliases: ['bokaro', 'bokaro steel city', 'बोकारो'], coords: [23.6544, 86.1456] },
  // Major metros
  { canonical: 'Delhi', state: 'Delhi', aliases: ['delhi', 'new delhi', 'dilli', 'दिल्ली', 'नई दिल्ली'], coords: [28.6665, 77.217] },
  { canonical: 'Mumbai', state: 'Maharashtra', aliases: ['mumbai', 'bombay', 'मुंबई', 'मुम्बई'], coords: [19.055, 72.8692] },
  { canonical: 'Kolkata', state: 'West Bengal', aliases: ['kolkata', 'calcutta', 'कोलकाता', 'कलकत्ता'], coords: [22.5726, 88.3639] },
  { canonical: 'Chennai', state: 'Tamil Nadu', aliases: ['chennai', 'madras', 'चेन्नई'], coords: [13.0837, 80.2702] },
  { canonical: 'Bengaluru', state: 'Karnataka', aliases: ['bengaluru', 'bangalore', 'bangaluru', 'बेंगलुरु', 'बैंगलोर', 'बंगलौर'], coords: [12.9768, 77.5901] },
  { canonical: 'Hyderabad', state: 'Telangana', aliases: ['hyderabad', 'hyderabaad', 'हैदराबाद'], coords: [17.3606, 78.4741] },
  { canonical: 'Lucknow', state: 'Uttar Pradesh', aliases: ['lucknow', 'lakhnau', 'लखनऊ'], coords: [26.8381, 80.9346] },
  { canonical: 'Varanasi', state: 'Uttar Pradesh', aliases: ['varanasi', 'banaras', 'benaras', 'kashi', 'वाराणसी', 'बनारस', 'काशी'], coords: [25.3356, 83.0076] },
  { canonical: 'Ahmedabad', state: 'Gujarat', aliases: ['ahmedabad', 'amdavad', 'अहमदाबाद'], coords: [23.0215, 72.5801] },
  { canonical: 'Pune', state: 'Maharashtra', aliases: ['pune', 'poona', 'पुणे'], coords: [18.5214, 73.8545] },
  { canonical: 'Jaipur', state: 'Rajasthan', aliases: ['jaipur', 'jaipoor', 'जयपुर'], coords: [26.9155, 75.819] },
  { canonical: 'Chandigarh', state: 'Chandigarh', aliases: ['chandigarh', 'chandigadh', 'चंडीगढ़', 'चंडीगढ'], coords: [30.7334, 76.7797] },
  { canonical: 'Bhopal', state: 'Madhya Pradesh', aliases: ['bhopal', 'bhopaal', 'भोपाल'], coords: [23.2585, 77.402] },
  { canonical: 'Prayagraj', state: 'Uttar Pradesh', aliases: ['prayagraj', 'allahabad', 'ilahabad', 'प्रयागराज', 'इलाहाबाद'], coords: [25.4381, 81.8338] },
  { canonical: 'Guwahati', state: 'Assam', aliases: ['guwahati', 'gauhati', 'गुवाहाटी'], coords: [26.1806, 91.7539] },
  // Key cancer treatment hubs
  { canonical: 'Vellore', state: 'Tamil Nadu', aliases: ['vellore', 'velor', 'वेल्लोर'], coords: [12.9072, 79.131] },
  { canonical: 'Thiruvananthapuram', state: 'Kerala', aliases: ['thiruvananthapuram', 'trivandrum', 'तिरुवनंतपुरम'], coords: [8.4882, 76.9476] },

  // Added for issue #260: cities the hospital directory holds that this table
  // lacked, and two cities named in the assessment's questions. Not geocoded.
  { canonical: 'Silchar', state: 'Assam', aliases: ['silchar', 'सिलचर'] },
  { canonical: 'Raipur', state: 'Chhattisgarh', aliases: ['raipur', 'रायपुर'] },
  { canonical: 'Gurugram', state: 'Haryana', aliases: ['gurugram', 'gurgaon', 'गुरुग्राम', 'गुड़गांव', 'गुड़गाँव'] },
  { canonical: 'Manipal', state: 'Karnataka', aliases: ['manipal', 'मणिपाल'] },
  { canonical: 'Nagpur', state: 'Maharashtra', aliases: ['nagpur', 'नागपुर'] },
  { canonical: 'Shillong', state: 'Meghalaya', aliases: ['shillong', 'शिलांग'] },
  { canonical: 'Bhubaneswar', state: 'Odisha', aliases: ['bhubaneswar', 'bhubaneshwar', 'bhuvaneshwar', 'bbsr', 'भुवनेश्वर'] },
  { canonical: 'Cuttack', state: 'Odisha', aliases: ['cuttack', 'katak', 'कटक'] },
  { canonical: 'Puducherry', state: 'Puducherry', aliases: ['puducherry', 'pondicherry', 'pondy', 'पुडुचेरी', 'पांडिचेरी'] },
  { canonical: 'Jodhpur', state: 'Rajasthan', aliases: ['jodhpur', 'जोधपुर'] },
  { canonical: 'Rishikesh', state: 'Uttarakhand', aliases: ['rishikesh', 'ऋषिकेश'] },
  { canonical: 'Kalyani', state: 'West Bengal', aliases: ['kalyani', 'कल्याणी'] },
  { canonical: 'Siliguri', state: 'West Bengal', aliases: ['siliguri', 'shiliguri', 'सिलीगुड़ी', 'सिलिगुड़ी'] },
  { canonical: 'Deoghar', state: 'Jharkhand', aliases: ['deoghar', 'devghar', 'देवघर'] },
  { canonical: 'Kochi', state: 'Kerala', aliases: ['kochi', 'cochin', 'ernakulam', 'कोच्चि'] },
  { canonical: 'Ludhiana', state: 'Punjab', aliases: ['ludhiana', 'लुधियाना'] },
];

interface StateEntry {
  canonical: string;
  aliases: string[];
}

/** States and union territories, matched exactly (multi-word names included). */
const INDIAN_STATES: StateEntry[] = [
  { canonical: 'Andaman and Nicobar Islands', aliases: ['andaman and nicobar', 'andaman', 'अंडमान'] },
  { canonical: 'Andhra Pradesh', aliases: ['andhra pradesh', 'andhra', 'आंध्र प्रदेश', 'आंध्र'] },
  { canonical: 'Arunachal Pradesh', aliases: ['arunachal pradesh', 'arunachal', 'अरुणाचल प्रदेश', 'अरुणाचल'] },
  { canonical: 'Assam', aliases: ['assam', 'asom', 'असम'] },
  { canonical: 'Bihar', aliases: ['bihar', 'बिहार'] },
  { canonical: 'Chandigarh', aliases: ['chandigarh', 'चंडीगढ़'] },
  { canonical: 'Chhattisgarh', aliases: ['chhattisgarh', 'chattisgarh', 'छत्तीसगढ़', 'छत्तीसगढ'] },
  { canonical: 'Dadra and Nagar Haveli and Daman and Diu', aliases: ['dadra and nagar haveli', 'daman and diu', 'dadra', 'daman'] },
  { canonical: 'Delhi', aliases: ['delhi', 'दिल्ली'] },
  { canonical: 'Goa', aliases: ['goa', 'गोवा'] },
  { canonical: 'Gujarat', aliases: ['gujarat', 'gujrat', 'गुजरात'] },
  { canonical: 'Haryana', aliases: ['haryana', 'हरियाणा'] },
  { canonical: 'Himachal Pradesh', aliases: ['himachal pradesh', 'himachal', 'हिमाचल प्रदेश', 'हिमाचल'] },
  { canonical: 'Jammu and Kashmir', aliases: ['jammu and kashmir', 'jammu & kashmir', 'jammu', 'kashmir', 'जम्मू', 'कश्मीर'] },
  { canonical: 'Jharkhand', aliases: ['jharkhand', 'झारखंड', 'झारखण्ड'] },
  { canonical: 'Karnataka', aliases: ['karnataka', 'कर्नाटक'] },
  { canonical: 'Kerala', aliases: ['kerala', 'keralam', 'केरल'] },
  { canonical: 'Ladakh', aliases: ['ladakh', 'लद्दाख'] },
  { canonical: 'Lakshadweep', aliases: ['lakshadweep', 'लक्षद्वीप'] },
  { canonical: 'Madhya Pradesh', aliases: ['madhya pradesh', 'मध्य प्रदेश'] },
  { canonical: 'Maharashtra', aliases: ['maharashtra', 'महाराष्ट्र'] },
  { canonical: 'Manipur', aliases: ['manipur', 'मणिपुर'] },
  { canonical: 'Meghalaya', aliases: ['meghalaya', 'मेघालय'] },
  { canonical: 'Mizoram', aliases: ['mizoram', 'मिज़ोरम', 'मिजोरम'] },
  { canonical: 'Nagaland', aliases: ['nagaland', 'नागालैंड'] },
  { canonical: 'Odisha', aliases: ['odisha', 'orissa', 'ओडिशा', 'उड़ीसा', 'ओड़िशा'] },
  { canonical: 'Puducherry', aliases: ['puducherry', 'pondicherry', 'पुडुचेरी'] },
  { canonical: 'Punjab', aliases: ['punjab', 'पंजाब'] },
  { canonical: 'Rajasthan', aliases: ['rajasthan', 'राजस्थान'] },
  { canonical: 'Sikkim', aliases: ['sikkim', 'सिक्किम'] },
  { canonical: 'Tamil Nadu', aliases: ['tamil nadu', 'tamilnadu', 'तमिलनाडु', 'तमिल नाडु'] },
  { canonical: 'Telangana', aliases: ['telangana', 'तेलंगाना'] },
  { canonical: 'Tripura', aliases: ['tripura', 'त्रिपुरा'] },
  { canonical: 'Uttar Pradesh', aliases: ['uttar pradesh', 'उत्तर प्रदेश'] },
  { canonical: 'Uttarakhand', aliases: ['uttarakhand', 'uttaranchal', 'उत्तराखंड', 'उत्तराखण्ड'] },
  { canonical: 'West Bengal', aliases: ['west bengal', 'bengal', 'पश्चिम बंगाल', 'बंगाल'] },
];

/**
 * Words that are never matched fuzzily to a city: common English and
 * Hinglish words, and words from hospital names. A hospital's name is not
 * the place the patient is in ("Tata Memorial" is in Mumbai, not Patna).
 */
const NEVER_FUZZY = new Set([
  'tata', 'memorial', 'apollo', 'fortis', 'medanta', 'paras', 'aiims', 'kidwai', 'mahavir',
  'homi', 'bhabha', 'kokilaben', 'reliance', 'narayana', 'manipal', 'max', 'healthcare',
  'hospital', 'hospitals', 'cancer', 'centre', 'center', 'centres', 'centers', 'clinic',
  'treatment', 'government', 'private', 'scheme', 'ayushman', 'family', 'father', 'mother',
  'patient', 'patients', 'doctor', 'doctors', 'better', 'nearest', 'chemo', 'radiation',
  'surgery', 'insurance', 'concession', 'railway', 'helpline', 'please', 'should', 'there',
  'where', 'which', 'really', 'second', 'opinion', 'children', 'anywhere', 'appointment',
  'between', 'before', 'during', 'office', 'person', 'people', 'parents', 'husband',
  'daughter', 'brother', 'sister', 'medicine', 'medicines', 'ilaaj', 'paisa', 'kahan',
]);

/** Context patterns that precede city names */
const CONTEXT_PATTERNS = [
  // `\b` first, so the "in" of "pain" or "brain" is not read as a place word.
  /\b(?:from|in|near|at|lives?\s+in|living\s+in|reside\s+in|based\s+in|staying\s+in)\s+(\w+)/gi,
  // Hindi patterns: से (se), में (mein), का (ka)
  /(\w+)\s+(?:se|से|mein|में|ka|का)\b/gi,
  // "I am from X" / "main X se hoon"
  /(?:main|mein|hum)\s+(\w+)\s+(?:se|ka|ki|ke)\b/gi,
  // Devanagari: "X में", "X से", "X के पास". `\w` and `\b` are ASCII-only in
  // JavaScript, so these use explicit Devanagari and whitespace classes.
  /([ऀ-ॿ]+)\s+(?:में|से|के\s+पास|के\s+नज़दीक|के\s+नजदीक)(?![ऀ-ॿ])/g,
];

/** Letters of Latin script and of Devanagari, for word boundaries. */
const LETTER = 'A-Za-z\\u0900-\\u097F';

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

const IS_DEVANAGARI = /[ऀ-ॿ]/;

/** Shortest word and alias length that may be matched fuzzily. */
const FUZZY_MIN_LENGTH = 6;

/**
 * Try to find a city match for a single word: exact alias match, then fuzzy
 * matching under the rules at the top of this file. `inContext` is true when
 * the word follows or precedes a place word, which is when an alias that is
 * also an ordinary word may count.
 */
function matchCity(word: string, inContext = false): { entry: CityEntry; confidence: number } | null {
  const lower = word.toLowerCase();

  // Skip very short words (likely not city names). Devanagari names are
  // short in characters, so the floor applies to Latin script only.
  if (!IS_DEVANAGARI.test(lower) && lower.length < 3) return null;

  // 1. Exact alias match
  for (const entry of INDIAN_CITIES) {
    const ordinaryWord = entry.contextOnly?.includes(lower) ?? false;
    if (!ordinaryWord && (entry.aliases.includes(lower) || entry.canonical.toLowerCase() === lower)) {
      return { entry, confidence: 1.0 };
    }
    if (inContext && ordinaryWord) {
      return { entry, confidence: 1.0 };
    }
  }

  // 2. Fuzzy match: Latin script, six letters or more, distance one.
  if (IS_DEVANAGARI.test(lower) || lower.length < FUZZY_MIN_LENGTH || NEVER_FUZZY.has(lower)) {
    return null;
  }

  let bestMatch: CityEntry | null = null;
  for (const entry of INDIAN_CITIES) {
    for (const alias of [entry.canonical.toLowerCase(), ...entry.aliases]) {
      if (IS_DEVANAGARI.test(alias) || alias.length < FUZZY_MIN_LENGTH) continue;
      if (Math.abs(alias.length - lower.length) > 1) continue;
      if (levenshtein(lower, alias) === 1) {
        bestMatch = entry;
        break;
      }
    }
    if (bestMatch) break;
  }

  return bestMatch ? { entry: bestMatch, confidence: 0.8 } : null;
}

/**
 * Resolve the coordinates of a known city, using the same canonical
 * INDIAN_CITIES table `detectLocation` uses (canonical names + aliases).
 *
 * Exists so the hospital directory can order centres by real distance from the
 * city the patient named. Returns null for a city not in the table, which the
 * caller must treat as "no distance signal" — never as "distance zero".
 *
 * @returns [latitude, longitude], or null when the city is unknown or ungeocoded
 */
export function resolveCoordsForCity(
  city: string | null | undefined
): [number, number] | null {
  if (!city || city.trim().length === 0) return null;
  const lower = city.trim().toLowerCase();
  for (const entry of INDIAN_CITIES) {
    if (entry.canonical.toLowerCase() === lower || entry.aliases.includes(lower)) {
      return entry.coords ?? null;
    }
  }
  return null;
}

/**
 * Resolve the state a known city belongs to, using the same canonical
 * INDIAN_CITIES table `detectLocation` uses (canonical names + aliases).
 *
 * Exists so callers that only carry a city string (e.g. a hospital-directory
 * lookup) can still widen to the correct state pool instead of losing the
 * geography entirely. No new geography is introduced here — it reads the table
 * that already backs detection.
 *
 * @returns canonical state name, or null when the city is not in the table
 */
export function resolveStateForCity(city: string | null | undefined): string | null {
  if (!city || city.trim().length === 0) return null;
  const lower = city.trim().toLowerCase();
  for (const entry of INDIAN_CITIES) {
    if (entry.canonical.toLowerCase() === lower || entry.aliases.includes(lower)) {
      return entry.state;
    }
  }
  return null;
}

/** Find a whole-word occurrence of a phrase in Latin script or Devanagari. */
function containsPhrase(lowerText: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![${LETTER}])${escaped}(?![${LETTER}])`, 'i').test(lowerText);
}

/**
 * Detect location (Indian city) from text transcript.
 * @param text - The transcribed text to analyze
 * @returns LocationResult if a city is detected, null otherwise
 */
export function detectLocation(text: string): LocationResult | null {
  if (!text || text.trim().length === 0) return null;
  const normalised = text.normalize('NFC');

  // 1. Try context-pattern extraction first (higher confidence)
  for (const pattern of CONTEXT_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(normalised)) !== null) {
      const candidate = match[1];
      const cityMatch = matchCity(candidate, true);
      if (cityMatch) {
        return {
          city: cityMatch.entry.canonical,
          state: cityMatch.entry.state,
          confidence: cityMatch.confidence,
        };
      }
    }
  }

  // 2. Multi-word aliases ("new delhi", "bodh gaya", "नई दिल्ली").
  const lowerText = normalised.toLowerCase();
  for (const entry of INDIAN_CITIES) {
    for (const alias of entry.aliases) {
      if (/\s/.test(alias) && containsPhrase(lowerText, alias)) {
        return { city: entry.canonical, state: entry.state, confidence: 0.9 };
      }
    }
  }

  // 3. Fallback: scan all words for city names
  const words = normalised
    .split(/[\s,;.!?।()"'“”‘’:/-]+/)
    .filter((w) => w.length >= 3 || IS_DEVANAGARI.test(w));
  for (const word of words) {
    const cityMatch = matchCity(word);
    if (cityMatch) {
      // Slightly lower confidence for non-contextual matches
      return {
        city: cityMatch.entry.canonical,
        state: cityMatch.entry.state,
        confidence: Math.max(0.5, cityMatch.confidence - 0.1),
      };
    }
  }

  return null;
}

/**
 * Detect a state or union territory named in the text, by exact name or alias.
 * Longer names are tried first, so "west bengal" wins over "bengal".
 */
export function detectState(text: string): string | null {
  if (!text || text.trim().length === 0) return null;
  const lowerText = text.normalize('NFC').toLowerCase();
  const candidates = INDIAN_STATES.flatMap((s) => s.aliases.map((alias) => ({ state: s.canonical, alias })));
  candidates.sort((a, b) => b.alias.length - a.alias.length);
  for (const c of candidates) {
    if (containsPhrase(lowerText, c.alias)) return c.state;
  }
  return null;
}

/**
 * Detect a place: a city (with its state) if one is named, otherwise a state.
 * Returns null when neither is recognised.
 */
export function detectPlace(text: string): PlaceResult | null {
  const city = detectLocation(text);
  if (city) return { city: city.city, state: city.state, confidence: city.confidence };
  const state = detectState(text);
  return state ? { city: null, state, confidence: 0.9 } : null;
}

/** Canonical names of every state and union territory the table knows. */
export function knownStates(): string[] {
  return INDIAN_STATES.map((s) => s.canonical);
}
