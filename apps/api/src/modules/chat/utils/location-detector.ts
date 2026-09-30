/**
 * Location entity extractor — detects Indian city names from chat and voice text.
 * Uses exact alias match, locative context cues, and (for long words in a place
 * position only) fuzzy Levenshtein matching.
 *
 * The detected city drives hospital distance ordering, so a false positive is
 * not harmless: "What are the best hospitals" once read as Arrah ("at are"),
 * "report aa gaya hai" as Gaya, "bukhar" as Buxar. See detectLocation.
 */

import { HINGLISH_FUNCTION_WORDS } from '../../rag/kb-fts-query';

export interface LocationResult {
  city: string;
  state: string;
  confidence: number;
}

interface CityEntry {
  canonical: string;
  state: string;
  aliases: string[];
  /**
   * [latitude, longitude] of the town itself — NOT of the district that shares
   * its name, which can sit tens of kilometres away.
   *
   * Geocoded once, offline, by `scripts/geocode-hospitals.py --cities` against
   * public Nominatim, and committed here so nothing is resolved at runtime. Each
   * value cleared two hard gates: the returned address had to name both this
   * city and its state, and the point had to fall inside India. Optional only so
   * a future entry can be added before it is geocoded — every entry present
   * today carries one.
   *
   * Locality precision. Adequate for ordering cancer centres that are tens of
   * kilometres apart; never adequate for a travel time or a street address.
   */
  coords?: [number, number];
}

/** Indian cities map — Bihar focus + major metros */
const INDIAN_CITIES: CityEntry[] = [
  // Bihar
  { canonical: 'Muzaffarpur', state: 'Bihar', aliases: ['muzaffarpur', 'muzzafarpur', 'muzafarpur', 'muzaffurpur'], coords: [26.1183, 85.3858] },
  { canonical: 'Patna', state: 'Bihar', aliases: ['patna', 'patnaa'], coords: [25.6093, 85.1235] },
  { canonical: 'Gaya', state: 'Bihar', aliases: ['gaya', 'gayaa', 'bodh gaya', 'bodhgaya'], coords: [24.7964, 85.008] },
  { canonical: 'Bhagalpur', state: 'Bihar', aliases: ['bhagalpur', 'bhagalpoor'], coords: [25.2495, 86.9828] },
  { canonical: 'Darbhanga', state: 'Bihar', aliases: ['darbhanga', 'darbangha'], coords: [26.157, 85.8995] },
  { canonical: 'Purnia', state: 'Bihar', aliases: ['purnia', 'purnea', 'purneya'], coords: [25.7774, 87.4731] },
  { canonical: 'Arrah', state: 'Bihar', aliases: ['arrah', 'ara', 'arah'], coords: [25.5603, 84.6632] },
  { canonical: 'Begusarai', state: 'Bihar', aliases: ['begusarai', 'begusrai'], coords: [25.4139, 86.1349] },
  { canonical: 'Katihar', state: 'Bihar', aliases: ['katihar', 'katiyar'], coords: [25.5434, 87.569] },
  { canonical: 'Munger', state: 'Bihar', aliases: ['munger', 'monghyr', 'munghyr'], coords: [25.3774, 86.4731] },
  { canonical: 'Chhapra', state: 'Bihar', aliases: ['chhapra', 'chapra', 'chapara'], coords: [25.7784, 84.7515] },
  { canonical: 'Samastipur', state: 'Bihar', aliases: ['samastipur', 'samasthipur'], coords: [25.8597, 85.7839] },
  { canonical: 'Hajipur', state: 'Bihar', aliases: ['hajipur', 'hajeepur'], coords: [25.6906, 85.209] },
  { canonical: 'Sasaram', state: 'Bihar', aliases: ['sasaram', 'sasaaram'], coords: [24.951, 84.0149] },
  { canonical: 'Dehri', state: 'Bihar', aliases: ['dehri', 'dehri on sone'], coords: [24.9078, 84.1901] },
  { canonical: 'Siwan', state: 'Bihar', aliases: ['siwan', 'seewan'], coords: [26.2185, 84.3585] },
  { canonical: 'Motihari', state: 'Bihar', aliases: ['motihari', 'motihaari'], coords: [26.6507, 84.9115] },
  { canonical: 'Nawada', state: 'Bihar', aliases: ['nawada', 'nawaada'], coords: [24.8932, 85.5452] },
  { canonical: 'Bagaha', state: 'Bihar', aliases: ['bagaha', 'bagahaa'], coords: [27.0979, 84.0894] },
  { canonical: 'Bettiah', state: 'Bihar', aliases: ['bettiah', 'betiah', 'betiyaa'], coords: [26.8023, 84.5074] },
  { canonical: 'Jehanabad', state: 'Bihar', aliases: ['jehanabad', 'jahanabad'], coords: [25.2232, 84.9565] },
  { canonical: 'Aurangabad', state: 'Bihar', aliases: ['aurangabad'], coords: [24.7537, 84.3747] },
  { canonical: 'Buxar', state: 'Bihar', aliases: ['buxar', 'baksar'], coords: [25.5716, 83.973] },
  { canonical: 'Kishanganj', state: 'Bihar', aliases: ['kishanganj', 'kishangunj'], coords: [26.1014, 87.9508] },
  // Jharkhand
  { canonical: 'Ranchi', state: 'Jharkhand', aliases: ['ranchi', 'raanchi'], coords: [23.3701, 85.325] },
  { canonical: 'Jamshedpur', state: 'Jharkhand', aliases: ['jamshedpur', 'jamsedpur', 'tatanagar'], coords: [22.8015, 86.203] },
  { canonical: 'Dhanbad', state: 'Jharkhand', aliases: ['dhanbad', 'dhanabaad'], coords: [23.7953, 86.431] },
  { canonical: 'Bokaro', state: 'Jharkhand', aliases: ['bokaro', 'bokaro steel city'], coords: [23.6544, 86.1456] },
  // Major metros
  { canonical: 'Delhi', state: 'Delhi', aliases: ['delhi', 'new delhi', 'dilli'], coords: [28.6665, 77.217] },
  { canonical: 'Mumbai', state: 'Maharashtra', aliases: ['mumbai', 'bombay'], coords: [19.055, 72.8692] },
  { canonical: 'Kolkata', state: 'West Bengal', aliases: ['kolkata', 'calcutta'], coords: [22.5726, 88.3639] },
  { canonical: 'Chennai', state: 'Tamil Nadu', aliases: ['chennai', 'madras'], coords: [13.0837, 80.2702] },
  { canonical: 'Bengaluru', state: 'Karnataka', aliases: ['bengaluru', 'bangalore', 'bangaluru'], coords: [12.9768, 77.5901] },
  { canonical: 'Hyderabad', state: 'Telangana', aliases: ['hyderabad', 'hyderabaad'], coords: [17.3606, 78.4741] },
  { canonical: 'Lucknow', state: 'Uttar Pradesh', aliases: ['lucknow', 'lakhnau'], coords: [26.8381, 80.9346] },
  { canonical: 'Varanasi', state: 'Uttar Pradesh', aliases: ['varanasi', 'banaras', 'benaras', 'kashi'], coords: [25.3356, 83.0076] },
  { canonical: 'Ahmedabad', state: 'Gujarat', aliases: ['ahmedabad', 'amdavad'], coords: [23.0215, 72.5801] },
  { canonical: 'Pune', state: 'Maharashtra', aliases: ['pune', 'poona'], coords: [18.5214, 73.8545] },
  { canonical: 'Jaipur', state: 'Rajasthan', aliases: ['jaipur', 'jaipoor'], coords: [26.9155, 75.819] },
  { canonical: 'Chandigarh', state: 'Chandigarh', aliases: ['chandigarh', 'chandigadh'], coords: [30.7334, 76.7797] },
  { canonical: 'Bhopal', state: 'Madhya Pradesh', aliases: ['bhopal', 'bhopaal'], coords: [23.2585, 77.402] },
  { canonical: 'Prayagraj', state: 'Uttar Pradesh', aliases: ['prayagraj', 'allahabad', 'ilahabad'], coords: [25.4381, 81.8338] },
  { canonical: 'Guwahati', state: 'Assam', aliases: ['guwahati', 'gauhati'], coords: [26.1806, 91.7539] },
  // Key cancer treatment hubs
  { canonical: 'Vellore', state: 'Tamil Nadu', aliases: ['vellore', 'velor'], coords: [12.9072, 79.131] },
  { canonical: 'Thiruvananthapuram', state: 'Kerala', aliases: ['thiruvananthapuram', 'trivandrum'], coords: [8.4882, 76.9476] },
];

/**
 * Confidence a detected city must reach before anything ACTS on it — orders the
 * hospital directory by distance, prints a "~N km away" figure, heads a list
 * "Nearest cancer centres to <city>", or is persisted to Session.city.
 *
 * 0.9 admits exactly two kinds of evidence: a city named with a locative cue
 * ("from Patna", "Patna me", "main Gaya se hoon") and an unambiguous city name
 * standing on its own ("Muzaffarpur breast cancer"). Everything below it — a
 * fuzzy spelling match, a homograph like "Gaya" that is only capitalised — is
 * returned by `detectLocation` for logging but must never drive geography: a
 * wrong city is worse than no city, because it sends the patient to centres
 * measured from somewhere they are not.
 */
export const LOCATION_CONFIDENCE_FOR_GEOGRAPHY = 0.9;

/** Word tokens: Latin runs and Devanagari runs (JS `\w`/`\b` do not see Devanagari). */
const TOKEN_RE = /[A-Za-z]+|[ऀ-ॿ]+/g;

/** A cue immediately BEFORE a word that marks it as a place ("from X", "in X"). */
const BEFORE_CUES = new Set(['from', 'in', 'near', 'at', 'around', 'nearby']);

/**
 * A locative cue immediately AFTER a word ("X se", "X me", "X district").
 * Strong enough to make even a homograph ("gaya") a place.
 */
const STRONG_AFTER_CUES = new Set([
  'se', 'me', 'mein', 'mai', 'main', 'mei', 'district', 'zila', 'jila', 'jile', 'city',
  'sheher', 'shahar', 'से', 'में', 'मे', 'जिला', 'जिले',
]);

/**
 * A genitive / associative cue after a word ("X ka hospital", "X ke paas",
 * "X wale"). Good evidence for an unambiguous city name, NOT for a homograph:
 * "pata chal gaya ki cancer hai" is a verb followed by "ki", not Gaya.
 */
const WEAK_AFTER_CUES = new Set(['ka', 'ki', 'ke', 'wala', 'wale', 'wali', 'का', 'की', 'के', 'वाले', 'वाला']);

/**
 * City aliases that are also ordinary words. "gaya" is the Hinglish past tense
 * of "to go" ("report aa gaya hai"); "ara" is too short and common a syllable
 * to trust bare. These only count as the city with a locative cue. Any alias
 * that is also a Hinglish function word is treated the same way.
 */
const LOCATION_HOMOGRAPHS = new Set(['gaya', 'gayaa', 'ara']);

/**
 * Words that sit one or two edits from a city alias and must never be
 * fuzzy-matched to it: "bukhar" (fever) → Buxar, "hunger" → Munger,
 * "branch" → Ranchi. Hinglish function words are covered separately.
 */
const FUZZY_NOISE_WORDS = new Set([
  'bukhar', 'bukhaar', 'kamzori', 'hunger', 'danger', 'branch', 'finger', 'ginger', 'burger',
]);

/** Fuzzy matching is only attempted on words at least this long. */
const MIN_FUZZY_LENGTH = 6;

/** Is `lower` a word that can never be fuzzy-matched to a city? */
function isNonPlaceWord(lower: string): boolean {
  return HINGLISH_FUNCTION_WORDS.has(lower) || FUZZY_NOISE_WORDS.has(lower);
}

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

/** Exact match of a (lower-cased) word or phrase against canonical names and aliases. */
function exactCity(lower: string): CityEntry | null {
  for (const entry of INDIAN_CITIES) {
    if (entry.canonical.toLowerCase() === lower || entry.aliases.includes(lower)) {
      return entry;
    }
  }
  return null;
}

/**
 * Fuzzy match a single Latin word. Only long words (≥ 6 letters) are tried —
 * short Hinglish words sit within two edits of too many short city names
 * (kya→gaya, papa→patna) — and the allowed distance scales with length.
 */
function fuzzyCity(lower: string): { entry: CityEntry; distance: number } | null {
  if (lower.length < MIN_FUZZY_LENGTH || !/^[a-z]+$/.test(lower) || isNonPlaceWord(lower)) {
    return null;
  }
  const maxDistance = lower.length >= 8 ? 2 : 1;
  let best: { entry: CityEntry; distance: number } | null = null;
  for (const entry of INDIAN_CITIES) {
    for (const alias of [entry.canonical.toLowerCase(), ...entry.aliases]) {
      if (alias.includes(' ') || Math.abs(alias.length - lower.length) > 2) continue;
      const dist = levenshtein(lower, alias);
      if (dist > 0 && dist <= maxDistance && (!best || dist < best.distance)) {
        best = { entry, distance: dist };
      }
    }
  }
  return best;
}

/** Longest multi-word alias, in tokens ("bokaro steel city"). */
const MAX_ALIAS_TOKENS = Math.max(
  ...INDIAN_CITIES.flatMap((e) => e.aliases.map((a) => a.split(' ').length))
);

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

interface Token {
  raw: string;
  lower: string;
  index: number;
}

/** True when a token opens a sentence, so its capital letter says nothing. */
function isSentenceInitial(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  return before.length === 0 || /[.!?।\n]$/.test(before);
}

/**
 * Detect location (Indian city) from text transcript.
 *
 * Every word is scored and the strongest candidate wins (earliest on a tie), so
 * a city named exactly anywhere beats a fuzzy guess elsewhere in the sentence.
 *
 * Confidence ladder:
 * - 1.0  exact name with a locative cue ("from Arrah", "Patna me", "Gaya se"),
 *        or a multi-word alias ("Bodh Gaya", "New Delhi")
 * - 0.9  unambiguous exact name standing alone ("Muzaffarpur breast cancer"),
 *        or a capitalised homograph with a genitive cue ("Gaya ke paas")
 * - 0.8  fuzzy, one edit, with a cue ("from Muzafferpur")
 * - 0.6  fuzzy, two edits, with a cue; or a homograph that is merely
 *        capitalised mid-sentence ("... aa Gaya hai")
 *
 * Only results at or above {@link LOCATION_CONFIDENCE_FOR_GEOGRAPHY} may drive
 * hospital geography or be persisted — use {@link detectLocationForGeography}.
 *
 * Devanagari city names are not in the table yet; a Devanagari cue after a
 * Latin city name ("Patna से") is understood.
 *
 * @param text - The transcribed text to analyze
 * @returns LocationResult if a city is detected, null otherwise
 */
export function detectLocation(text: string): LocationResult | null {
  if (!text || text.trim().length === 0) return null;

  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    tokens.push({ raw: m[0], lower: m[0].toLowerCase(), index: m.index ?? 0 });
  }

  let best: { entry: CityEntry; confidence: number } | null = null;
  const consider = (entry: CityEntry, confidence: number): void => {
    if (!best || confidence > best.confidence) best = { entry, confidence };
  };

  for (let i = 0; i < tokens.length; i++) {
    // Multi-word aliases first ("bodh gaya" must not be read as a bare "gaya").
    let phraseLen = 0;
    for (let n = Math.min(MAX_ALIAS_TOKENS, tokens.length - i); n >= 2; n--) {
      const phrase = tokens.slice(i, i + n).map((t) => t.lower).join(' ');
      const entry = exactCity(phrase);
      if (entry) {
        consider(entry, 1.0);
        phraseLen = n;
        break;
      }
    }
    if (phraseLen > 0) {
      i += phraseLen - 1;
      continue;
    }

    const tok = tokens[i];
    const prev = tokens[i - 1]?.lower;
    const next = tokens[i + 1]?.lower;
    const beforeCue = prev !== undefined && BEFORE_CUES.has(prev);
    const strongCue = beforeCue || (next !== undefined && STRONG_AFTER_CUES.has(next));
    const weakCue = next !== undefined && WEAK_AFTER_CUES.has(next);

    const exact = exactCity(tok.lower);
    if (exact) {
      const homograph = LOCATION_HOMOGRAPHS.has(tok.lower) || HINGLISH_FUNCTION_WORDS.has(tok.lower);
      if (!homograph) {
        consider(exact, strongCue || weakCue ? 1.0 : 0.9);
      } else {
        const capitalised = /^[A-Z]/.test(tok.raw);
        if (strongCue) consider(exact, 1.0);
        else if (capitalised && weakCue) consider(exact, 0.9);
        else if (capitalised && !isSentenceInitial(text, tok.index)) consider(exact, 0.6);
        // Otherwise it is the verb ("aa gaya"), not the city.
      }
      continue;
    }

    // Fuzzy only where the sentence says a place goes here.
    if (strongCue || weakCue) {
      const fuzzy = fuzzyCity(tok.lower);
      if (fuzzy) consider(fuzzy.entry, fuzzy.distance === 1 ? 0.8 : 0.6);
    }
  }

  if (!best) return null;
  const { entry, confidence } = best as { entry: CityEntry; confidence: number };
  return { city: entry.canonical, state: entry.state, confidence };
}

/**
 * {@link detectLocation}, but only when the result is confident enough to act
 * on (≥ {@link LOCATION_CONFIDENCE_FOR_GEOGRAPHY}). Callers that order hospitals
 * by distance, print distances, or persist the city must use this.
 */
export function detectLocationForGeography(text: string): LocationResult | null {
  const result = detectLocation(text);
  return result && result.confidence >= LOCATION_CONFIDENCE_FOR_GEOGRAPHY ? result : null;
}
