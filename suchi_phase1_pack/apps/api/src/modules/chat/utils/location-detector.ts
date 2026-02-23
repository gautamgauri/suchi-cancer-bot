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
  { canonical: 'Muzaffarpur', state: 'Bihar', aliases: ['muzaffarpur', 'muzzafarpur', 'muzafarpur', 'muzaffurpur'] },
  { canonical: 'Patna', state: 'Bihar', aliases: ['patna', 'patnaa'] },
  { canonical: 'Gaya', state: 'Bihar', aliases: ['gaya', 'gayaa', 'bodh gaya', 'bodhgaya'] },
  { canonical: 'Bhagalpur', state: 'Bihar', aliases: ['bhagalpur', 'bhagalpoor'] },
  { canonical: 'Darbhanga', state: 'Bihar', aliases: ['darbhanga', 'darbangha'] },
  { canonical: 'Purnia', state: 'Bihar', aliases: ['purnia', 'purnea', 'purneya'] },
  { canonical: 'Arrah', state: 'Bihar', aliases: ['arrah', 'ara', 'arah'] },
  { canonical: 'Begusarai', state: 'Bihar', aliases: ['begusarai', 'begusrai'] },
  { canonical: 'Katihar', state: 'Bihar', aliases: ['katihar', 'katiyar'] },
  { canonical: 'Munger', state: 'Bihar', aliases: ['munger', 'monghyr', 'munghyr'] },
  { canonical: 'Chhapra', state: 'Bihar', aliases: ['chhapra', 'chapra', 'chapara'] },
  { canonical: 'Samastipur', state: 'Bihar', aliases: ['samastipur', 'samasthipur'] },
  { canonical: 'Hajipur', state: 'Bihar', aliases: ['hajipur', 'hajeepur'] },
  { canonical: 'Sasaram', state: 'Bihar', aliases: ['sasaram', 'sasaaram'] },
  { canonical: 'Dehri', state: 'Bihar', aliases: ['dehri', 'dehri on sone'] },
  { canonical: 'Siwan', state: 'Bihar', aliases: ['siwan', 'seewan'] },
  { canonical: 'Motihari', state: 'Bihar', aliases: ['motihari', 'motihaari'] },
  { canonical: 'Nawada', state: 'Bihar', aliases: ['nawada', 'nawaada'] },
  { canonical: 'Bagaha', state: 'Bihar', aliases: ['bagaha', 'bagahaa'] },
  { canonical: 'Bettiah', state: 'Bihar', aliases: ['bettiah', 'betiah', 'betiyaa'] },
  { canonical: 'Jehanabad', state: 'Bihar', aliases: ['jehanabad', 'jahanabad'] },
  { canonical: 'Aurangabad', state: 'Bihar', aliases: ['aurangabad'] },
  { canonical: 'Buxar', state: 'Bihar', aliases: ['buxar', 'baksar'] },
  { canonical: 'Kishanganj', state: 'Bihar', aliases: ['kishanganj', 'kishangunj'] },
  // Jharkhand
  { canonical: 'Ranchi', state: 'Jharkhand', aliases: ['ranchi', 'raanchi'] },
  { canonical: 'Jamshedpur', state: 'Jharkhand', aliases: ['jamshedpur', 'jamsedpur', 'tatanagar'] },
  { canonical: 'Dhanbad', state: 'Jharkhand', aliases: ['dhanbad', 'dhanabaad'] },
  { canonical: 'Bokaro', state: 'Jharkhand', aliases: ['bokaro', 'bokaro steel city'] },
  // Major metros
  { canonical: 'Delhi', state: 'Delhi', aliases: ['delhi', 'new delhi', 'dilli'] },
  { canonical: 'Mumbai', state: 'Maharashtra', aliases: ['mumbai', 'bombay'] },
  { canonical: 'Kolkata', state: 'West Bengal', aliases: ['kolkata', 'calcutta'] },
  { canonical: 'Chennai', state: 'Tamil Nadu', aliases: ['chennai', 'madras'] },
  { canonical: 'Bengaluru', state: 'Karnataka', aliases: ['bengaluru', 'bangalore', 'bangaluru'] },
  { canonical: 'Hyderabad', state: 'Telangana', aliases: ['hyderabad', 'hyderabaad'] },
  { canonical: 'Lucknow', state: 'Uttar Pradesh', aliases: ['lucknow', 'lakhnau'] },
  { canonical: 'Varanasi', state: 'Uttar Pradesh', aliases: ['varanasi', 'banaras', 'benaras', 'kashi'] },
  { canonical: 'Ahmedabad', state: 'Gujarat', aliases: ['ahmedabad', 'amdavad'] },
  { canonical: 'Pune', state: 'Maharashtra', aliases: ['pune', 'poona'] },
  { canonical: 'Jaipur', state: 'Rajasthan', aliases: ['jaipur', 'jaipoor'] },
  { canonical: 'Chandigarh', state: 'Chandigarh', aliases: ['chandigarh', 'chandigadh'] },
  { canonical: 'Bhopal', state: 'Madhya Pradesh', aliases: ['bhopal', 'bhopaal'] },
  { canonical: 'Prayagraj', state: 'Uttar Pradesh', aliases: ['prayagraj', 'allahabad', 'ilahabad'] },
  { canonical: 'Guwahati', state: 'Assam', aliases: ['guwahati', 'gauhati'] },
  // Key cancer treatment hubs
  { canonical: 'Vellore', state: 'Tamil Nadu', aliases: ['vellore', 'velor'] },
  { canonical: 'Thiruvananthapuram', state: 'Kerala', aliases: ['thiruvananthapuram', 'trivandrum'] },
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
