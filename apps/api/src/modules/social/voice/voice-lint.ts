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
  /\b(like|share|repost|retweet|forward)\s+(this|if|it|with|to)\b/i,
  /\bplease\s+(share|forward|like|repost)\b/i,
  /\btag\s+(a|someone|your|a friend|us)\b/i,
  /\bcomment\s+(below|yes|if|with)\b/i,
  /\bin the comments\b/i,
  /\bdrop\s+a\b/i,
  /\btype\s+["']?(yes|amen)\b/i,
  /\bfollow\s+(us|our page)\b/i,
  /\bfollow\s+for\s+more\b/i,
  /\bsubscribe\b/i,
  /\bsave\s+this\s+post\b/i,
  /\bspread\s+(the\s+word|awareness)\b/i,
  /\bshare\s+widely\b/i,
  /\bpass\s+(it|this|the number|the word)\s+on\b/i,
  /\bwell placed to\b/i,
];

const FEAR = [
  "deadly", "killer", "silent killer", "scary", "terrifying", "shocking", "alarming",
  "devastating", "horrifying", "death sentence", "don't ignore", "do not ignore", "before it's too late",
  "before it is too late", "don't wait", "do not wait", "don't delay", "do not delay", "could be cancer",
  "may be cancer", "might be cancer", "could kill", "life-threatening", "dangerous", "risk your life",
  "die", "dies", "death", "deaths", "dying", "panic", "frightening", "worst",
];

const PROMISES = [
  /\bcur(e|es|ed|ing|able)\b/i,
  /\bguarantee(d|s)?\b/i,
  /\b100\s?%/,
  /\bmiracle\b/i,
  /\bwill (heal|survive|recover|beat|get better|be fine|be cured|be okay|be ok)\b/i,
  /\b(beat|beating|defeat|defeating|overcome|overcoming) (cancer|it|the disease)\b/i,
  /\bcancer[- ]free\b/i,
  /\bfree of cancer\b/i,
  /\bsave (your|a|their) life\b/i,
  /\b(full|complete) recovery\b/i,
  /\bno side[- ]effects\b/i,
  /\b(completely|totally|100%) safe\b/i,
  /\bproven to\b/i,
  /\balways works\b/i,
  /\bbest (treatment|hospital|doctor|care)\b/i,
];

const WAR_WORDS = /\b(victims?|battles?|battling|fights?|fighting|fighters?|warriors?|survivors?|war on|brave(ly)?)\b/i;

const READER_HAS_CANCER = [
  /\byour (cancer|tumou?r|diagnosis|biopsy|chemo\w*|radiation|radiotherapy|surgery|illness|disease|condition|prognosis|stage|scans?|scan results|oncologist|treatment|reports? show)\b/i,
  /\b(you|you may|you might|you could) (have|have got) cancer\b/i,
  /\bif you have cancer\b/i,
  /\b(you|you've|you have|you were|you are) (been |just )?diagnosed\b/i,
  /\bwhen you (were|are|get) diagnosed\b/i,
  /\b(as|if you are) a (cancer )?patient\b/i,
  /\byou(?:'re| are) (a )?(cancer )?patient\b/i,
  /\byour (fight|journey|road) (with|against)\b/i,
];

/** A named doctor, e.g. "Dr Sharma", "Dr. A. Kumar", "Doctor Rao". */
const NAMED_DOCTOR = /\b(Dr\.?|Doctor)\s+(?:[A-Z]\.\s*)*[A-Z][a-z]+/;

/**
 * "A, B and C" where each item is one to three words: a group of three. A
 * phrase after the comma that opens with a preposition, an article or a
 * pronoun ("..., at empanelled public and private hospitals") is not a list
 * item, so it does not count. A simple rule. It misses triads written as
 * three sentences, and the owner's reading catches those.
 */
const TRIAD = /(?:^|[^\w'-])([\w'-]+(?:\s[\w'-]+){0,2}),\s([\w'-]+(?:\s[\w'-]+){0,2}),?\s(?:and|or)\s([\w'-]+(?:\s[\w'-]+){0,2})(?=[\s.,;:?!]|$)/gi;
const NOT_A_LIST_ITEM = new Set([
  "to", "at", "in", "on", "with", "for", "from", "by", "of", "the", "a", "an", "and", "or", "but", "so",
  "which", "who", "that", "where", "when", "if", "as", "than", "then", "it", "they", "we", "you", "he",
  "she", "is", "are", "was", "can", "will", "may", "one", "whatever", "because", "while", "after", "before",
]);

export function findTriad(text: string): string | null {
  for (const m of text.matchAll(TRIAD)) {
    const first = m[1].split(/\s/);
    const second = m[2].split(/\s/)[0].toLowerCase();
    const third = m[3].split(/\s/)[0].toLowerCase();
    if ([first[0].toLowerCase(), second, third].some((w) => NOT_A_LIST_ITEM.has(w))) continue;
    // "Afterwards, keep ..." : a single opening word before a comma is not an item.
    const before = text.slice(0, (m.index ?? 0) + m[0].indexOf(m[1])).trimEnd();
    if (first.length === 1 && (before === "" || /[.?!]$/.test(before))) continue;
    return m[0].trim();
  }
  return null;
}

/** Closing lines that sound like a slogan or a sign-off. */
const CLOSER = [
  /\b(is|are) (power|strength|everything|key|the first step)\b/i,
  /\bmakes? (all )?the difference\b/i,
  /\b(starts|begins) with (you|one|a single)\b/i,
  /\byou are not alone\b/i,
  /\btogether,? we\b/i,
  /\bone step at a time\b/i,
  /\bsmall steps?\b/i,
  /\bevery (family|patient|step|question) (counts|matters|deserves)\b/i,
  /\bhope (is|lives|begins)\b/i,
  /\bwe are (here|with you)\b/i,
];

/** The final sentence may not be a sign-off about Suchi. */
const SIGNOFF = /^(suchi|sccf|we)\b[^.?!]*\b(can|is|are|will)\b[^.?!]*\b(help|there|here|explain|answer|guide|support)\b/i;

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
    if (new RegExp(`(^|[^a-z'])${escapeRe(w)}([^a-z']|$)`).test(low)) hits.push({ code: "fear", reason: `fear language "${w}"` });
  }
  if (NAMED_DOCTOR.test(noUrls)) hits.push({ code: "doctor_named", reason: "do not name a doctor" });
  const triad = findTriad(noUrls.replace(/#\S+/g, " "));
  if (triad) hits.push({ code: "triad", reason: "a group of three", excerpt: triad.slice(0, 100) });

  const sentences = noUrls
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z]{3}/i.test(s) && !/^#/.test(s) && !/^(source|sources|report)\b/i.test(s));
  const last = sentences[sentences.length - 1] ?? "";
  if (CLOSER.some((rx) => rx.test(last))) hits.push({ code: "closer", reason: "the post ends on a slogan", excerpt: last.slice(0, 100) });
  if (SIGNOFF.test(last)) hits.push({ code: "signoff", reason: "the post ends on a sign-off about Suchi. Stop when the useful thing is said.", excerpt: last.slice(0, 100) });
  for (let i = 0; i + 2 < sentences.length; i++) {
    const first = (s: string) => s.split(/\s+/)[0].toLowerCase();
    if (first(sentences[i]) === first(sentences[i + 1]) && first(sentences[i]) === first(sentences[i + 2]) && !sentences[i].endsWith("?")) {
      hits.push({ code: "stacked", reason: "three sentences in a row start the same way", excerpt: sentences[i].slice(0, 80) });
      break;
    }
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
