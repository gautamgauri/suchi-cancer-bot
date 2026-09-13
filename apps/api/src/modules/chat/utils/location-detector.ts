/**
 * Location entity extractor — detects Indian city names from voice transcripts.
 * Uses exact match, fuzzy Levenshtein matching (distance ≤ 2), and context patterns.
 * Follows the same pattern as cancer-type-detector.ts.
 */

export interface LocationResult {
  city: string;
  state: string;
  confidence: number;
}

interface CityEntry {
  canonical: string;
  state: string;
  aliases: string[];
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

/** Context patterns that precede city names */
const CONTEXT_PATTERNS = [
  /(?:from|in|near|at|lives?\s+in|living\s+in|reside\s+in|based\s+in|staying\s+in)\s+(\w+)/gi,
  // Hindi patterns: से (se), में (mein), का (ka)
  /(\w+)\s+(?:se|से|mein|में|ka|का)\b/gi,
  // "I am from X" / "main X se hoon"
  /(?:main|mein|hum)\s+(\w+)\s+(?:se|ka|ki|ke)\b/gi,
];

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

/**
 * Try to find a city match for a given word using exact alias match or fuzzy matching.
 */
function matchCity(word: string): { entry: CityEntry; confidence: number } | null {
  const lower = word.toLowerCase();

  // Skip very short words (likely not city names)
  if (lower.length < 3) return null;

  // 1. Exact alias match
  for (const entry of INDIAN_CITIES) {
    if (entry.aliases.includes(lower) || entry.canonical.toLowerCase() === lower) {
      return { entry, confidence: 1.0 };
    }
  }

  // 2. Fuzzy match (Levenshtein distance ≤ 2)
  let bestMatch: { entry: CityEntry; distance: number } | null = null;

  for (const entry of INDIAN_CITIES) {
    for (const alias of [entry.canonical.toLowerCase(), ...entry.aliases]) {
      // Only fuzzy match if word length is similar (within 3 chars)
      if (Math.abs(alias.length - lower.length) > 2) continue;

      const dist = levenshtein(lower, alias);
      if (dist <= 2 && dist > 0) {
        if (!bestMatch || dist < bestMatch.distance) {
          bestMatch = { entry, distance: dist };
        }
      }
    }
  }

  if (bestMatch) {
    const confidence = bestMatch.distance === 1 ? 0.8 : 0.6;
    return { entry: bestMatch.entry, confidence };
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

/**
 * Detect location (Indian city) from text transcript.
 * @param text - The transcribed text to analyze
 * @returns LocationResult if a city is detected, null otherwise
 */
export function detectLocation(text: string): LocationResult | null {
  if (!text || text.trim().length === 0) return null;

  // 1. Try context-pattern extraction first (higher confidence)
  for (const pattern of CONTEXT_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1];
      const cityMatch = matchCity(candidate);
      if (cityMatch) {
        return {
          city: cityMatch.entry.canonical,
          state: cityMatch.entry.state,
          confidence: cityMatch.confidence,
        };
      }
    }
  }

  // 2. Fallback: scan all words for city names
  const words = text.split(/[\s,;.!?]+/).filter((w) => w.length >= 3);
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
