/**
 * Retrieval-query noise removal (issue #182).
 *
 * WHY: a message carries more than its topic. "suchi, cancer ke bare me ek line
 * me batao" addresses the bot by name and asks for a ONE-LINE answer; only
 * "cancer" is what to look up. Both extras used to reach retrieval verbatim:
 * the lexical arm searched ('line' & 'cancer'), which matches every
 * "first-line / second-line treatment" chunk, so drug and metastatic-disease
 * chunks were retrieved for "what is cancer" and "Cancer Basics" was not.
 *
 * SCOPE: this cleans only the text used to SEARCH the knowledge base. The user's
 * message, the LLM prompt and every safety check still see the original words —
 * the answer should still be one line.
 *
 * Deliberately narrow: an answer-length phrase is removed only when it is shaped
 * like a directive ("in one line", "ek line me", "एक लाइन में"), never "line" on
 * its own — "first-line treatment", "one line of therapy", "PICC line" are topics.
 */

/** Postpositions that turn "ek line" into "in one line" in romanised Hindi. */
const HINGLISH_IN = "(?:me|mein|main|mai|mei|men)";

const DIRECTIVE_PATTERNS: RegExp[] = [
  // English: "in one line", "in 2 lines", "in a sentence", "in a few words" — but not "in one line of treatment".
  /\bin\s+(?:just\s+|only\s+)?(?:one|1|a|two|2|three|3|a\s+few|few)\s+(?:lines?|sentences?|words?)\b(?!\s+of\b)/gi,
  /\bin\s+(?:short|brief)\b/gi,
  // Hinglish: "ek line me", "do line mein", "kuch shabdon mein", "short me", "sankshep mein".
  new RegExp(
    `\\b(?:ek|do|teen|1|2|3|kuch|chand)\\s+(?:line|lines|lain|sentence|sentences|vakya|vaakya|vakyon|shabd|shabdon|words?)\\s+${HINGLISH_IN}\\b`,
    "gi"
  ),
  new RegExp(`\\b(?:short|sankshep|sankshipt)\\s+${HINGLISH_IN}\\b`, "gi"),
  // Devanagari: "एक लाइन में", "दो वाक्यों में", "संक्षेप में". \b does not work for Devanagari.
  /(?<=^|\s)(?:एक|दो|तीन|कुछ)\s+(?:लाइन|लाईन|लाइनों|पंक्ति|पंक्तियों|वाक्य|वाक्यों|शब्द|शब्दों)\s+में(?=$|\s|[?.!,।])/g,
  /(?<=^|\s)(?:संक्षेप|संक्षिप्त)\s+में(?=$|\s|[?.!,।])/g,
];

/** Addressing the bot: "suchi,", "hi suchi!", "Suchi ji" at the start, ", suchi?" at the end. */
const LEADING_VOCATIVE = /^\s*(?:(?:hi+|hello|hey|namaste|namaskar|dear)[\s,!]+)?suchi(?:\s+ji)?(?=$|[\s,:;!.?\-–—])[\s,:;!.\-–—]*/i;
const TRAILING_VOCATIVE = /[\s,]+suchi(?:\s+ji)?(?=[\s?!.।]*$)/i;

function tidy(text: string): string {
  return text
    .replace(/\s+([,.;:!?।])/g, "$1") // "cancer ," → "cancer,"
    .replace(/[,;:]+(?=[?.!।]|$)/g, "") // "cancer,?" → "cancer?"
    .replace(/^[\s,;:.!\-–—]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Remove the bot's name and answer-length directives from a retrieval query.
 * Returns the input unchanged when nothing would be left.
 */
export function stripRetrievalNoise(query: string): string {
  if (typeof query !== "string" || query.trim() === "") return query;

  let out = query.replace(LEADING_VOCATIVE, "").replace(TRAILING_VOCATIVE, "");
  for (const pattern of DIRECTIVE_PATTERNS) {
    out = out.replace(pattern, " ");
  }
  if (out === query) return query; // nothing matched: leave the query byte-for-byte as it was
  out = tidy(out);

  return /[\p{L}\p{Nd}]/u.test(out) ? out : query;
}
