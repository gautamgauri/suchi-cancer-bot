import { ChannelName, GeneratedPack } from "./generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchemaViolation {
  rule: string;        // short rule name e.g. "word_count_min"
  description: string; // human-readable
  actual: number | string;
  expected: string;
}

export interface ChannelSchemaResult {
  channel: ChannelName;
  passed: boolean;
  violations: SchemaViolation[];
}

export interface SchemaReport {
  packId: string;
  checkedAt: string;
  allPassed: boolean;
  channels: Record<ChannelName, ChannelSchemaResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Per-channel rule implementations
// ---------------------------------------------------------------------------

/**
 * LinkedIn rules:
 *   - word_count_min  : ≥150 words
 *   - word_count_max  : ≤250 words
 *   - hashtag_count   : 3–5 tokens starting with #
 *   - cta_present     : contains "suchitracancercare.org"
 */
function checkLinkedin(content: string): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  const words = countWords(content);

  if (words < 150) {
    violations.push({
      rule: "word_count_min",
      description: `LinkedIn post is too short (${words} words, minimum 150)`,
      actual: words,
      expected: "≥150 words",
    });
  }

  if (words > 250) {
    violations.push({
      rule: "word_count_max",
      description: `LinkedIn post is too long (${words} words, maximum 250)`,
      actual: words,
      expected: "≤250 words",
    });
  }

  const hashtags = content.match(/#\w+/g) ?? [];
  const hashtagCount = hashtags.length;
  if (hashtagCount < 3 || hashtagCount > 5) {
    violations.push({
      rule: "hashtag_count",
      description: `LinkedIn post has ${hashtagCount} hashtag(s), expected 3–5`,
      actual: hashtagCount,
      expected: "3–5 hashtags",
    });
  }

  if (!content.includes("suchitracancercare.org")) {
    violations.push({
      rule: "cta_present",
      description: 'LinkedIn post missing article URL CTA (expected "suchitracancercare.org")',
      actual: "not found",
      expected: "contains suchitracancercare.org",
    });
  }

  return violations;
}

/**
 * Twitter rules:
 *   - tweet_count  : 5–7 tweets (numbered lines like "1/", "2/", …)
 *   - tweet_length : each tweet ≤280 chars (first violation reported)
 */
function checkTwitter(content: string): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  // Split into individual tweets: lines beginning with a digit followed by "/"
  // e.g. "1/ Text here" or "1/ Text" as first token on a line
  const tweetLines = content
    .split("\n")
    .filter((line) => /^\d+\//.test(line.trim()));

  const tweetCount = tweetLines.length;

  if (tweetCount < 5 || tweetCount > 7) {
    violations.push({
      rule: "tweet_count",
      description: `Twitter thread has ${tweetCount} tweet(s), expected 5–7`,
      actual: tweetCount,
      expected: "5–7 tweets",
    });
  }

  // Check each detected tweet for length ≤280 chars
  for (const line of tweetLines) {
    const trimmed = line.trim();
    if (trimmed.length > 280) {
      violations.push({
        rule: "tweet_length",
        description: `Tweet "${trimmed.substring(0, 40)}…" exceeds 280 chars (${trimmed.length} chars)`,
        actual: trimmed.length,
        expected: "≤280 chars per tweet",
      });
      break; // report only the first violation per the spec
    }
  }

  return violations;
}

/**
 * Instagram rules:
 *   - slide_count  : 6–8 slides (lines starting with "Slide ")
 *   - slide_length : each slide caption ≤80 chars after stripping "Slide N: " prefix
 *                    (first violation reported)
 */
function checkInstagram(content: string): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  // Lines that begin with "Slide " (case-sensitive per spec)
  const slideLines = content
    .split("\n")
    .filter((line) => line.trimStart().startsWith("Slide "));

  const slideCount = slideLines.length;

  if (slideCount < 6 || slideCount > 8) {
    violations.push({
      rule: "slide_count",
      description: `Instagram carousel has ${slideCount} slide(s), expected 6–8`,
      actual: slideCount,
      expected: "6–8 slides",
    });
  }

  // Strip "Slide N: " prefix before counting caption length
  // Pattern: "Slide <number>: " or "Slide <number> — " etc.
  const slidePrefix = /^Slide\s+\d+[:\-–—]\s*/;

  for (const line of slideLines) {
    const caption = line.trimStart().replace(slidePrefix, "").trimEnd();
    if (caption.length > 80) {
      violations.push({
        rule: "slide_length",
        description: `Slide caption "${caption.substring(0, 40)}…" exceeds 80 chars (${caption.length} chars)`,
        actual: caption.length,
        expected: "≤80 chars per slide caption",
      });
      break; // report only the first violation per the spec
    }
  }

  return violations;
}

/**
 * WhatsApp rules:
 *   - message_length : total content ≤400 chars
 *   - cta_present    : contains "suchitracancercare.org"
 */
function checkWhatsapp(content: string): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  const length = content.length;
  if (length > 400) {
    violations.push({
      rule: "message_length",
      description: `WhatsApp message is too long (${length} chars, maximum 400)`,
      actual: length,
      expected: "≤400 chars",
    });
  }

  if (!content.includes("suchitracancercare.org")) {
    violations.push({
      rule: "cta_present",
      description: 'WhatsApp message missing article URL CTA (expected "suchitracancercare.org")',
      actual: "not found",
      expected: "contains suchitracancercare.org",
    });
  }

  return violations;
}

/**
 * YouTube Short rules:
 *   - word_count_min : ≥180 words
 *   - word_count_max : ≤240 words
 */
function checkYoutubeShort(content: string): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  const words = countWords(content);

  if (words < 180) {
    violations.push({
      rule: "word_count_min",
      description: `YouTube Short script is too short (${words} words, minimum 180)`,
      actual: words,
      expected: "≥180 words",
    });
  }

  if (words > 240) {
    violations.push({
      rule: "word_count_max",
      description: `YouTube Short script is too long (${words} words, maximum 240)`,
      actual: words,
      expected: "≤240 words",
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Channel dispatch map
// ---------------------------------------------------------------------------

const CHANNEL_CHECKERS: Record<ChannelName, (content: string) => SchemaViolation[]> = {
  linkedin: checkLinkedin,
  twitter: checkTwitter,
  instagram: checkInstagram,
  whatsapp: checkWhatsapp,
  youtube_short: checkYoutubeShort,
};

const ALL_CHANNELS: ChannelName[] = [
  "linkedin",
  "twitter",
  "instagram",
  "whatsapp",
  "youtube_short",
];

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run deterministic schema validation against each channel in the pack.
 * Channels with status "failed" are skipped (marked as passed with no violations).
 * Returns a SchemaReport with per-channel results.
 */
export function validateSchema(pack: GeneratedPack): SchemaReport {
  const checkedAt = new Date().toISOString();
  const channelResults = {} as Record<ChannelName, ChannelSchemaResult>;

  for (const channelName of ALL_CHANNELS) {
    const channelResult = pack.channels[channelName];

    // Skip failed channels — no content to validate (mirrors safety-checker.ts)
    if (!channelResult || channelResult.status === "failed") {
      channelResults[channelName] = {
        channel: channelName,
        passed: true,
        violations: [],
      };
      continue;
    }

    const checker = CHANNEL_CHECKERS[channelName];
    const violations = checker(channelResult.content);

    channelResults[channelName] = {
      channel: channelName,
      passed: violations.length === 0,
      violations,
    };
  }

  const allPassed = ALL_CHANNELS.every((ch) => channelResults[ch].passed);

  return {
    packId: pack.articleSlug,
    checkedAt,
    allPassed,
    channels: channelResults,
  };
}
