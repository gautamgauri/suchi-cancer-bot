/**
 * Hindi, Hinglish and bilingual greetings for GreetingDetector.
 *
 * The English patterns in greeting-detector.ts are anchored to a Latin
 * greeting at the start, so a greeting written in Devanagari ("नमस्ते सुचि")
 * was never recognised. That includes the prefilled message on the website's
 * "Ask on WhatsApp" links, which is a Hindi line followed by an English line.
 *
 * This matcher is strict. The message is split into words and every word has
 * to be accounted for: each part starts with a greeting word, may name the
 * bot or add a polite "ji", and may end with one fixed "I would like some
 * information" phrase. Any other word, including any medical word, any
 * question and anything in an unknown script, means it is not a greeting and
 * the message is handled exactly as before.
 *
 * It is linear in the input length: one normalisation pass, one split and one
 * walk over the words. No regular expression here can backtrack.
 */

/** Longer text is never a greeting under these rules. */
const MAX_LENGTH = 300;
/** At most this many greeting parts, e.g. a Hindi line and an English line. */
const MAX_PARTS = 3;
/** At most this many address words after one greeting word. */
const MAX_ADDRESS_WORDS = 3;

/** Words that open a greeting. */
const GREETING_WORDS = new Set([
  // Romanised
  "hi",
  "hii",
  "hello",
  "helo",
  "hey",
  "namaste",
  "namastey",
  "namaskar",
  "namaskaar",
  "pranam",
  "pranaam",
  // Devanagari
  "नमस्ते",
  "नमस्कार",
  "प्रणाम",
  "हेलो",
  "हैलो",
  "हलो",
  "हाय",
  "हाई",
]);

/** Words that may follow a greeting word: the bot's name, or a polite "ji". */
const ADDRESS_WORDS = new Set(["suchi", "सुचि", "ji", "जी", "there"]);

/**
 * Fixed "I would like some information" phrases. Each position lists the
 * accepted spellings of that word.
 */
const INFO_PHRASES: ReadonlyArray<ReadonlyArray<ReadonlySet<string>>> = [
  [new Set(["मुझे"]), new Set(["कुछ"]), new Set(["जानकारी"]), new Set(["चाहिए"])],
  [
    new Set(["mujhe"]),
    new Set(["kuch", "kuchh"]),
    new Set(["jankari", "jaankari", "jaankaari"]),
    new Set(["chahiye", "chahie"]),
  ],
  [new Set(["i"]), new Set(["would"]), new Set(["like"]), new Set(["some"]), new Set(["information"])],
];

// Single characters only, so each replace is one linear pass.
const INVISIBLE = /[​-‍﻿]/g;
const SEPARATORS = /[\s,.!?;:।॥…"'‘’“”\-]+/;
const FOLDED_EMOJI = /\u{1F64F}|\u{1F44B}|[\u{1F3FB}-\u{1F3FF}]/gu; // folded hands, waving hand, skin tones

function words(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(INVISIBLE, "")
    .replace(FOLDED_EMOJI, " ")
    .split(SEPARATORS)
    .filter((w) => w.length > 0);
}

/** Length of the info phrase starting at `at`, or 0 when none matches. */
function infoPhraseAt(tokens: string[], at: number): number {
  for (const phrase of INFO_PHRASES) {
    if (at + phrase.length > tokens.length) continue;
    let ok = true;
    for (let i = 0; i < phrase.length; i++) {
      if (!phrase[i].has(tokens[at + i])) {
        ok = false;
        break;
      }
    }
    if (ok) return phrase.length;
  }
  return 0;
}

/**
 * True when the whole message is one or more greeting parts in Hindi,
 * Hinglish or English, such as "नमस्ते सुचि", "pranam ji" or the website's
 * bilingual greeting. Medical keywords are still checked by the caller.
 */
export function isHindiOrBilingualGreeting(text: string): boolean {
  if (text.length > MAX_LENGTH) return false;
  const tokens = words(text);
  if (tokens.length === 0) return false;

  let i = 0;
  let parts = 0;
  while (i < tokens.length) {
    if (parts === MAX_PARTS || !GREETING_WORDS.has(tokens[i])) return false;
    parts++;
    i++;
    let address = 0;
    while (i < tokens.length && address < MAX_ADDRESS_WORDS && ADDRESS_WORDS.has(tokens[i])) {
      address++;
      i++;
    }
    i += infoPhraseAt(tokens, i);
  }
  return true;
}
