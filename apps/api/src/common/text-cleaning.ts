/**
 * Shared text-cleaning primitives for every surface that shows or speaks
 * assistant text.
 *
 * Citations are for auditors, not users (OD-003 in docs/OPEN_DECISIONS.md;
 * FR-WA-011 records the same policy for WhatsApp). The structured citation data
 * travels separately in the API response and the raw text is preserved in the
 * database for evaluation, so a citation marker in user-facing text is an
 * artifact, and stripping is the fail-CLOSED direction: a marker the user was
 * never meant to see costs nothing when removed, while a raw knowledge-base
 * identifier that reaches them costs trust (issues #68, #87).
 *
 * Why this module exists: PR #82 hardened these patterns for the DISPLAY
 * surface only, and the voice/TTS surface kept the original fail-open versions
 * (issue #87, Path 1). Rather than porting the patterns a second time and
 * letting the two drift again, both surfaces now call the functions here.
 *
 * NOTHING in this file touches clinical or safety wording. It removes machine
 * identifiers and markup only.
 */

/**
 * A complete `[citation:docId:chunkId]` marker.
 *
 * Marker content excludes `[`, `]` and newlines. A real marker never contains
 * them, and excluding `[` means this pattern cannot start on an *unterminated*
 * marker and run forward into a later complete one, swallowing the legitimate
 * prose in between — the silent data-loss bug PR #82 closed for display.
 */
const CITATION_MARKER_PATTERN = /\[citation:[^[\]\n]*\]/g;

/**
 * An UNTERMINATED marker — the generation stopped inside it, so the closing
 * bracket never arrived (issue #68):
 *
 *   ...might be effective [citation:kb_en_nci_types_breast_diagnosis_..._v1:kb_
 *
 * Applied after complete markers have already been removed, so any remaining
 * `[citation:` opener is unterminated by definition. Content is restricted to
 * the characters real document/chunk ids use, so the strip stops at the first
 * space and can never eat prose that follows a malformed marker mid-text.
 */
const UNTERMINATED_CITATION_MARKER_PATTERN = /\[citation:[A-Za-z0-9_.:-]*/g;

/**
 * The generation can also stop inside the literal `[citation:` prefix itself,
 * leaving e.g. `[cita` at the very end of the text. Anchored to end-of-text so
 * a legitimate `[c...` anywhere else is untouched.
 */
const TRUNCATED_CITATION_PREFIX_PATTERN = /\[c(?:i(?:t(?:a(?:t(?:i(?:o(?:n)?)?)?)?)?)?)?$/;

/**
 * `[source:...]` markers, same three shapes. The voice stripper has always
 * removed these; the display cleaner gains them here, which can only remove
 * more machine identifiers, never fewer.
 */
const SOURCE_MARKER_PATTERN = /\[source:[^[\]\n]*\]/g;
const UNTERMINATED_SOURCE_MARKER_PATTERN = /\[source:[A-Za-z0-9_.:-]*/g;
const TRUNCATED_SOURCE_PREFIX_PATTERN = /\[s(?:o(?:u(?:r(?:c(?:e)?)?)?)?)?$/;

/** Numbered references like [1], [2] left over from LLM output. */
const NUMBERED_REF_PATTERN = /\s*\[\d{1,3}\]/g;

/** A numbered reference truncated at end-of-text, e.g. a trailing `[12`. */
const TRUNCATED_NUMBERED_REF_PATTERN = /\s*\[\d{1,3}$/;

/** The raw "**Sources:** [citation:...]" section appended by citation repair. */
const RAW_SOURCES_SECTION_PATTERN = /\n\n\*\*Sources:\*\*\s*(?:\[citation:[^[\]\n]*\]\s*)+/g;

/**
 * A "**Sources:**" header left dangling at the end because every marker under
 * it was stripped (which happens when the section itself was truncated).
 */
const DANGLING_SOURCES_HEADER_PATTERN = /\n*[ \t]*\*\*Sources:\*\*[ \t]*$/;

/**
 * Leftover empty bold markers like "** **".
 *
 * Horizontal whitespace only. `\s*` also matched newlines, so the closing `**`
 * of one bold line, the paragraph break, and the opening `**` of the next line
 * were treated as a single empty span and deleted — the critical escalation
 * header shipped as "…medical emergency.Call for help NOW:" (issue #135).
 */
const EMPTY_BOLD_PATTERN = /\*\*[ \t]*\*\*/g;

/**
 * Punctuation orphaned by a removed marker (issue #81, finding 3).
 *
 * A marker sitting between a clause and its terminator leaves debris behind:
 *
 *   ...बढ़ सकता है [citation:a:b], [citation:c:d]। डेक्सामेथासोन...
 *   ...बढ़ सकता है , । डेक्सामेथासोन...        <- what the reader saw
 *
 * These rules match on the punctuation characters themselves — including the
 * Devanagari danda `।` and double danda `॥`. They deliberately do NOT use `\b`:
 * JavaScript word boundaries are ASCII-only and are meaningless against
 * Devanagari, a bug this project has shipped before.
 */
/** Horizontal whitespace stranded before punctuation: " ।" -> "।", " ," -> ",". */
const SPACE_BEFORE_PUNCTUATION_PATTERN = /[ \t]+([,;:।॥!?]|\.(?!\.))/g;
/** A separator left dangling in front of a terminator: ", ।" -> "।", ",." -> ".". */
const SEPARATOR_BEFORE_TERMINATOR_PATTERN = /[,;:]+[ \t]*(?=[।॥.!?])/g;
/** Punctuation duplicated by a strip: "।।" -> "।", ", ," -> ",". */
const REPEATED_PUNCTUATION_PATTERN = /([,;:।॥])[ \t]*(?=\1)/g;

/**
 * Remove citation/source markers in every shape they arrive in: complete,
 * unterminated (generation cut off mid-marker), and truncated-prefix.
 *
 * Order matters. Complete markers go first so that what remains of a
 * `[citation:` opener is unterminated by definition; the unterminated pattern's
 * restricted charset then stops at the first space instead of eating prose.
 */
export function stripCitationMarkers(text: string): string {
  if (!text) return text;

  return text
    .replace(RAW_SOURCES_SECTION_PATTERN, "")
    .replace(CITATION_MARKER_PATTERN, "")
    .replace(UNTERMINATED_CITATION_MARKER_PATTERN, "")
    .replace(TRUNCATED_CITATION_PREFIX_PATTERN, "")
    .replace(SOURCE_MARKER_PATTERN, "")
    .replace(UNTERMINATED_SOURCE_MARKER_PATTERN, "")
    .replace(TRUNCATED_SOURCE_PREFIX_PATTERN, "")
    .replace(NUMBERED_REF_PATTERN, "")
    .replace(TRUNCATED_NUMBERED_REF_PATTERN, "")
    .replace(DANGLING_SOURCES_HEADER_PATTERN, "");
}

/** Tidy the whitespace and punctuation debris a marker strip leaves behind. */
export function stripCitationDebris(text: string): string {
  if (!text) return text;

  return text
    .replace(EMPTY_BOLD_PATTERN, "")
    .replace(/ {2,}/g, " ")
    .replace(SPACE_BEFORE_PUNCTUATION_PATTERN, "$1")
    .replace(SEPARATOR_BEFORE_TERMINATOR_PATTERN, "")
    .replace(REPEATED_PUNCTUATION_PATTERN, "")
    .trim();
}

/**
 * Internal prompt scaffolding that reached the patient (issue #152).
 *
 * The response contracts in `llm.service.ts` are written as numbered, ALL-CAPS
 * imperatives addressed to the model ("1. ACKNOWLEDGE the diagnosis
 * empathetically:", "7. QUESTIONS FOR DOCTOR:"). Two consecutive scheduled
 * WhatsApp QA runs delivered those headings verbatim in the reply bubble: the
 * model reproduced the scaffold instead of only being steered by it. A reader
 * got instructions addressed to the model where the answer should have been.
 *
 * This is the same fail-CLOSED bargain as the citation strip above. A heading
 * the reader was never meant to see costs nothing when removed; staff-speak
 * delivered to someone who just heard the word "cancer" costs trust.
 *
 * SCOPE — deliberately narrow. This removes LABELS ONLY and keeps every word of
 * the answer that follows them, so it can never delete clinical content:
 *
 *   "1. ACKNOWLEDGE the diagnosis empathetically: I understand receiving…"
 *     -> "I understand receiving…"
 *
 * It matches a CLOSED vocabulary lifted from the contracts themselves (see the
 * list below), and every numbered form additionally requires the `N.` prefix
 * the contracts use. Matching ALL-CAPS plus a number is what keeps ordinary
 * prose — including a legitimate title-case "Treatment options:" heading the
 * model writes for the reader — untouched.
 *
 * This does NOT change any contract wording. Restating the contracts so they
 * stop being deliverable-shaped is the real fix and is clinical-prompt surface,
 * so it goes through SCCF review separately; this is the delivery-boundary net
 * that stops the leak reaching patients in the meantime.
 */
const CONTRACT_HEADING_KEYWORDS = [
  // Longest first: the alternation must not settle for a shorter prefix.
  "QUESTIONS FOR DOCTOR",
  "PREPARATION CHECKLIST",
  "SUPPORT RESOURCES",
  "CAREGIVER-SPECIFIC",
  "URGENT RED FLAGS",
  "TREATMENT OPTIONS",
  "WHAT IT COULD BE",
  "STAGING OVERVIEW",
  "ACKNOWLEDGE",
  "WHAT TO DO",
  "RECOMMEND",
  "REASSURE",
  "TIMELINE",
  "EXPLAIN",
  "START",
  "TESTS",
];

/**
 * A numbered contract heading: an optional bold wrapper, the `N.` the contract
 * writes, one of the keywords above, the short lowercase descriptor the
 * contract trails it with, and the `:`/`—` terminator.
 *
 * `(?![A-Za-z])` rather than `\b` after the keyword: JavaScript word boundaries
 * are ASCII-only and are meaningless against Devanagari, a bug this project has
 * shipped before (see the punctuation patterns above). The descriptor is capped
 * and forbidden from crossing a newline or a second terminator so a match can
 * never run forward and swallow the prose it precedes.
 */
const CONTRACT_HEADING_PATTERN = new RegExp(
  "(^|\\s)" +
    "\\*{0,2}\\d{1,2}[.)]\\s*\\*{0,2}\\s*" +
    "(?:" + CONTRACT_HEADING_KEYWORDS.join("|") + ")" +
    "(?![A-Za-z])" +
    "[^\\n:—]{0,80}?" +
    "\\s*(?:[:—]|(?=\\n))\\s*\\*{0,2}\\s*",
  "g"
);

/**
 * The contract's own title line, if the model echoes the whole block.
 */
const CONTRACT_TITLE_PATTERN =
  /(^|\s)\*{0,2}RESPONSE CONTRACT(?: FOR [A-Z -]+)?(?: QUERIES)?\s*(?:\([^)\n]*\))?\s*:?\s*\*{0,2}\s*/g;

/**
 * `Educational answer:` and its siblings are prompt SECTION LABELS
 * (`prompts/explain-mode.ts:24`, `prompts/navigate-mode.ts:16`,
 * `llm.service.ts:1034`), not reader-facing headings — the web escalation
 * banner already drops this one. The raw label survives in the stored text for
 * evaluation; it just stops being delivered.
 */
const SECTION_LABEL_PATTERN =
  /(^|\s)\*{0,2}Educational answer\*{0,2}\s*[:：]\s*\*{0,2}\s*/gi;

/**
 * A machine salutation. The model has no name for the reader, so "Dear User" /
 * "डियर यूजर" is scaffolding leaking through a template, never something a
 * person wrote to them.
 */
const MACHINE_SALUTATION_PATTERN =
  /(^|\s)\*{0,2}(?:Dear User|डियर यूजर)\*{0,2}\s*[,،:।]?\s*/gi;

/**
 * Remove internal prompt scaffolding from text about to be shown or spoken to a
 * patient (issue #152). Labels only — the answer after each label is kept.
 */
export function stripPromptScaffolding(text: string): string {
  if (!text) return text;

  return text
    .replace(CONTRACT_TITLE_PATTERN, "$1")
    .replace(CONTRACT_HEADING_PATTERN, "$1")
    .replace(SECTION_LABEL_PATTERN, "$1")
    .replace(MACHINE_SALUTATION_PATTERN, "$1");
}

/**
 * Last-stop safety net for TTS-bound text (issue #87).
 *
 * Each voice surface already shapes markdown its own way — the condenser turns
 * `1.` into "Step 1,", the voice stripper unwraps bold before matching
 * disclaimers — so this does NOT replace that work. It runs afterwards and
 * removes whatever syntax survived, because a speech synthesiser has no way to
 * render `**` or `###` and there is no legitimate reason for either to reach it.
 *
 * Text-only: markup is removed, the words inside it are kept.
 */
export function stripResidualMarkdownForSpeech(text: string): string {
  if (!text) return text;

  return (
    text
      // Fenced code blocks: drop the fence, keep the contents.
      .replace(/^\s*```[^\n]*$/gm, "")
      // Images before links — an image is a link with a leading `!`.
      .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
      .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
      // Headings, blockquotes and horizontal rules are line-level.
      .replace(/^\s{0,3}#{1,6}[ \t]*/gm, "")
      .replace(/^\s{0,3}>[ \t]?/gm, "")
      .replace(/^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "")
      // Emphasis: unwrap the paired forms first so the words survive.
      .replace(/~~([^~\n]+)~~/g, "$1")
      .replace(/__([^_\n]+)__/g, "$1")
      .replace(/(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g, "$1")
      // Anything left is unpaired markup. Nothing spoken needs an asterisk or a
      // backtick, so remove them outright rather than guessing at intent.
      .replace(/[*`]/g, "")
      .replace(/__+/g, "")
      // Debris from the removals.
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * The full clean applied to text that is about to be spoken: markers first,
 * then their debris, then any surviving markdown.
 */
export function cleanForSpeech(text: string): string {
  if (!text) return text;
  return stripResidualMarkdownForSpeech(
    stripCitationDebris(stripPromptScaffolding(stripCitationMarkers(text)))
  );
}
