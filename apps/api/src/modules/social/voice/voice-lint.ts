/**
 * The owner's voice rules for anything posted in SCCF's name, as code.
 *
 * Part one is a faithful port of the owner's prose linter (the checks for
 * dashes, semicolons, colon reveals, banned words and antithesis). It lives
 * here so it runs in production without any file outside the repository.
 * Part two adds the rules for social posts: emoji, hashtags, openers,
 * exclamation marks, listicles, engagement bait, fear, outcome promises,
 * war language and anything that tells the reader they have cancer.
 *
 * Every check returns a short code and a plain reason, so a failed draft can
 * be regenerated with the reasons fed back, and a held draft can be shown to
 * the owner with the same reasons.
 */
import { Platform } from "../social.types";

export interface VoiceViolation {
  code: string;
  reason: string;
  excerpt?: string;
}

// ---------------------------------------------------------------------------
// Part one. Port of the owner's prose linter. Keep these lists in step with it.
// ---------------------------------------------------------------------------

export const BANNED_PHRASES = [
  "deliberately", "genuinely", "meaningful", "meaningfully", "precisely",
  "fundamentally", "journey", "at the intersection of", "meeting point of",
  "goes beyond", "worth noting", "honest caveat", "not only", "not just",
  "rather than",
];

const ANTITHESIS: Array<[RegExp, string]> = [
  [/,\s+not\s+\w+/i, '", not X" antithesis'],
  [/\b(is|are|was) not\b[^.?!]{0,60}[.?!]\s+(It|They|This)\s+(is|are|was)\b/i, '"X is not Y. It is Z." antithesis'],
  [/,\s+or less\b|\bor less\b[.?!]/i, '"more X, or less" tail'],
];

const DASH = /[\u2014\u2013]/;

const STRIP: RegExp[] = [
  /`[^`]*`/g,                       // inline code
  /https?:\/\/\S+/g,                // URLs
  /<!--.*?-->/g,                    // html comments
  /<[^>]+>/g,                       // html tags
  /\b\d{1,2}:\d{2}\b/g,             // times
  /(?<!\*)\*[^*\n]+\*(?!\*)/g,      // *italic titles*
];

function stripLine(line: string): string {
  let out = line;
  for (const rx of STRIP) out = out.replace(rx, " ");
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The owner's prose rules. Same behaviour as prose-lint.py lint_text(). */
export function lintProse(text: string): VoiceViolation[] {
  const hits: VoiceViolation[] = [];
  let inCode = false;
  let off = false;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (s.includes("prose-lint: off")) { off = true; continue; }
    if (s.includes("prose-lint: on")) { off = false; continue; }
    if (s.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode || off || !s) continue;
    if (/^\|?[\s:\-|]+\|?$/.test(s)) continue;
    const isTitle = /^\*\*[^*]+\*\*$/.test(s);
    const line = stripLine(raw);
    // One difference from the Python linter: a line of hashtags ("#CancerCare")
    // is post text, so it is checked. A Markdown heading ("# Title") is not.
    const isHeading = s.startsWith("#") && !/^#[\p{L}\p{N}_]/u.test(s);
    const excerpt = s.slice(0, 120);
    if (DASH.test(line)) {
      hits.push({ code: "dash", reason: "em or en dash. Use 'to' for ranges, a hyphen for compounds, or split the sentence.", excerpt });
    }
    if (isHeading || isTitle) continue;
    if (line.includes(";")) hits.push({ code: "semicolon", reason: "semicolon. Split into two sentences.", excerpt });
    const colon = /:\s/g;
    let m: RegExpExecArray | null;
    while ((m = colon.exec(line)) !== null) {
      const before = line.slice(0, m.index).replace(/[*_>#\-\d.)]+/g, " ").split(/\s+/).filter(Boolean);
      if (before.length >= 4) {
        hits.push({ code: "colon_reveal", reason: "colon used to reveal a point. Write it as a sentence.", excerpt });
        break;
      }
    }
    const low = line.toLowerCase();
    for (const w of BANNED_PHRASES) {
      if (new RegExp(`\\b${escapeRe(w)}\\b`).test(low)) {
        hits.push({ code: "banned_phrase", reason: `banned phrase "${w}"`, excerpt });
      }
    }
    for (const [rx, why] of ANTITHESIS) {
      if (rx.test(line)) hits.push({ code: "antithesis", reason: why, excerpt });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Part two. Rules for social posts.
// ---------------------------------------------------------------------------

const EMOJI = /\p{Extended_Pictographic}/gu;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;
const URL_RE = /https?:\/\/\S+/g;

const OPENER_CLICHES: Array<[RegExp, string]> = [
  [/\bdid you know\b/i, '"Did you know"'],
  [/\bhere'?s what you need to know\b|\bhere is what you need to know\b/i, '"Here\'s what you need to know"'],
  [/\bwhat you need to know\b/i, '"what you need to know"'],
  [/\byou won'?t believe\b/i, '"you won\'t believe"'],
  [/\blet'?s talk about\b/i, '"let\'s talk about"'],
];

const ENGAGEMENT_BAIT = [
  /\b(like|share|repost|retweet)\s+(this|if)\b/i,
  /\btag\s+(a|someone|your|a friend)\b/i,
  /\bcomment\s+(below|yes|if)\b/i,
  /\bdrop\s+a\b/i,
  /\btype\s+["']?(yes|amen)\b/i,
  /\bfollow\s+(us\s+)?for\s+more\b/i,
  /\bsave\s+this\s+post\b/i,
  /\bspread\s+the\s+word\b/i,
  /\bshare\s+widely\b/i,
];

const FEAR = [
  "deadly", "killer", "silent killer", "scary", "terrifying", "shocking", "alarming",
  "devastating", "horrifying", "death sentence", "don't ignore", "do not ignore", "before it's too late",
];

const PROMISES = [
  /\bcur(e|es|ed|ing|able)\b/i,
  /\bguarantee(d|s)?\b/i,
  /\b100\s?%/,
  /\bmiracle\b/i,
  /\bwill (heal|survive|recover|beat)\b/i,
  /\bbeat(ing)? cancer\b/i,
  /\bcancer[- ]free\b/i,
  /\bsave (your|a) life\b/i,
];

const WAR_WORDS = /\b(victims?|battles?|battling|fights?|fighting|fighters?|warriors?|survivors?|war on)\b/i;

const READER_HAS_CANCER = [
  /\byour (cancer|tumou?r|diagnosis|biopsy|chemo|chemotherapy|illness|disease|scan results)\b/i,
  /\b(you|you may|you might|you could) (have|have got) cancer\b/i,
  /\bif you have cancer\b/i,
  /\bwhen you (were|are) diagnosed\b/i,
];

export const MARKETING_WORDS = [
  "empower", "empowering", "empowerment", "transform", "transformative", "revolutionary",
  "revolutionise", "revolutionize", "game-changer", "game changer", "unlock", "holistic",
  "seamless", "seamlessly", "leverage", "cutting-edge", "world-class", "best-in-class",
  "one-stop", "amazing", "incredible", "unparalleled", "state-of-the-art", "synergy",
  "impactful", "thrilled", "excited to announce", "proud to announce", "groundbreaking",
];

const LISTICLE_LINE = /^\s*([•·▪◾►➡✅✔☑👉*+\-]|\d+[.)/]\s|\d+\/\s?)/u;

/** Characters counted by X: a URL is always 23, everything else 1 per code point. */
export function xWeightedLength(text: string): number {
  const urls = text.match(URL_RE) ?? [];
  const rest = text.replace(URL_RE, "");
  return [...rest].length + urls.length * 23;
}

export interface PlatformLimits {
  maxChars: number;
  maxEmoji: number;
  maxHashtags: number;
}

/**
 * Hard limits. X and Instagram are the platforms' own caps (X 280 with URLs
 * counted as 23; Instagram caption 2,200). LinkedIn and Facebook are ours:
 * short posts read better and the LinkedIn commentary cap is not stated in
 * the Posts API page.
 */
export const LIMITS: Record<Platform, PlatformLimits> = {
  linkedin:  { maxChars: 1300, maxEmoji: 0, maxHashtags: 0 },
  facebook:  { maxChars: 1200, maxEmoji: 1, maxHashtags: 2 },
  instagram: { maxChars: 2200, maxEmoji: 1, maxHashtags: 2 },
  x:         { maxChars: 280,  maxEmoji: 1, maxHashtags: 0 },
};

export const CARD_TEXT_MAX = 120;

export function firstSentence(text: string): string {
  const body = text.replace(URL_RE, " ").trim();
  const m = /^[\s\S]*?[.?!](\s|$)/.exec(body);
  return (m ? m[0] : body).trim();
}

/** Social-post rules for one platform's text. */
export function lintSocial(platform: Platform, text: string, cardText?: string): VoiceViolation[] {
  const hits: VoiceViolation[] = [];
  const limits = LIMITS[platform];
  const noUrls = text.replace(URL_RE, " ");
  const low = noUrls.toLowerCase();

  const length = platform === "x" ? xWeightedLength(text) : [...text].length;
  if (length > limits.maxChars) {
    hits.push({ code: "too_long", reason: `${length} characters, the limit for ${platform} is ${limits.maxChars}` });
  }

  const emoji = noUrls.match(EMOJI) ?? [];
  if (emoji.length > limits.maxEmoji) {
    hits.push({ code: "emoji", reason: limits.maxEmoji === 0 ? `no emoji on ${platform}` : `at most ${limits.maxEmoji} emoji` });
  }

  const tags = noUrls.match(HASHTAG) ?? [];
  if (tags.length > limits.maxHashtags) {
    hits.push({ code: "hashtags", reason: limits.maxHashtags === 0 ? `no hashtags on ${platform}` : `at most ${limits.maxHashtags} hashtags` });
  }
  if (tags.length > 0) {
    // Hashtags only on the final line of the post.
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    const last = lines[lines.length - 1] ?? "";
    const tagsOnLast = (last.match(HASHTAG) ?? []).length;
    if (tagsOnLast !== tags.length) hits.push({ code: "hashtag_position", reason: "hashtags go together on the last line" });
  }

  if (noUrls.includes("!")) hits.push({ code: "exclamation", reason: "no exclamation marks" });

  const opener = firstSentence(text);
  if (opener.endsWith("?")) hits.push({ code: "question_opener", reason: "do not open with a question", excerpt: opener.slice(0, 120) });

  for (const [rx, label] of OPENER_CLICHES) {
    if (rx.test(noUrls)) hits.push({ code: "cliche", reason: `${label} is not allowed` });
  }
  for (const rx of ENGAGEMENT_BAIT) {
    if (rx.test(noUrls)) { hits.push({ code: "engagement_bait", reason: "no engagement bait" }); break; }
  }
  for (const w of FEAR) {
    if (low.includes(w)) hits.push({ code: "fear", reason: `fear language "${w}"` });
  }
  for (const rx of PROMISES) {
    if (rx.test(noUrls)) { hits.push({ code: "promise", reason: "no promises of outcomes" }); break; }
  }
  // War language is allowed only inside a quotation.
  const unquoted = noUrls.replace(/"[^"]*"|“[^”]*”/g, " ");
  if (WAR_WORDS.test(unquoted)) {
    hits.push({ code: "war_language", reason: 'avoid "victim", "battle", "fight" and "survivor" unless quoting' });
  }
  for (const rx of READER_HAS_CANCER) {
    if (rx.test(noUrls)) { hits.push({ code: "reader_has_cancer", reason: "never say or imply that the reader has cancer" }); break; }
  }
  for (const w of MARKETING_WORDS) {
    if (new RegExp(`\\b${escapeRe(w)}\\b`, "i").test(noUrls)) hits.push({ code: "marketing", reason: `marketing word "${w}"` });
  }
  for (const line of text.split(/\r?\n/)) {
    if (LISTICLE_LINE.test(line) && !/^\s*#/.test(line)) {
      hits.push({ code: "listicle", reason: "no list formatting with symbols or numbers", excerpt: line.trim().slice(0, 80) });
      break;
    }
  }
  if (platform === "instagram") {
    if (!cardText || !cardText.trim()) {
      hits.push({ code: "card_missing", reason: "Instagram needs card text" });
    } else {
      if ([...cardText].length > CARD_TEXT_MAX) hits.push({ code: "card_too_long", reason: `card text over ${CARD_TEXT_MAX} characters` });
      for (const v of lintProse(cardText)) hits.push({ ...v, code: `card_${v.code}` });
      if (cardText.includes("!")) hits.push({ code: "card_exclamation", reason: "no exclamation marks on the card" });
      if ((cardText.match(EMOJI) ?? []).length > 0) hits.push({ code: "card_emoji", reason: "no emoji on the card" });
      if (firstSentence(cardText).endsWith("?")) hits.push({ code: "card_question_opener", reason: "the card does not open with a question" });
    }
  }
  return hits;
}

/** Both parts together. */
export function lintVoice(platform: Platform, text: string, cardText?: string): VoiceViolation[] {
  return [...lintProse(text), ...lintSocial(platform, text, cardText)];
}
