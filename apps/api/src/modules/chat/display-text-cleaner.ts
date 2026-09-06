/**
 * Clean assistant response text for user display.
 *
 * Citations are for auditors, not readers: the structured citation data is
 * returned separately in the API response and the raw text is preserved in the
 * database for evaluation, so anything that looks like a citation marker in the
 * display string is an artifact and is stripped.
 *
 * Stripping is the fail-CLOSED direction. A citation the reader was never meant
 * to see costs nothing when removed; a raw knowledge-base identifier that
 * reaches the reader costs trust (issue #68).
 */

/**
 * A complete `[citation:docId:chunkId]` marker.
 *
 * Marker content excludes `[`, `]` and newlines. A real marker never contains
 * them, and excluding `[` means this pattern cannot start on an *unterminated*
 * marker and run forward into a later complete one, swallowing the legitimate
 * prose in between.
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

/** Leftover empty bold markers like "** **". */
const EMPTY_BOLD_PATTERN = /\*\*\s*\*\*/g;

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
 * Strip citation artifacts and the punctuation debris they leave behind.
 *
 * The structured citations data is still returned separately in the API
 * response for the frontend to render.
 */
export function cleanResponseForDisplay(text: string): string {
  if (!text) return text;

  return (
    text
      // ── Citation artifacts ────────────────────────────────────────────
      .replace(RAW_SOURCES_SECTION_PATTERN, "")
      .replace(CITATION_MARKER_PATTERN, "")
      .replace(UNTERMINATED_CITATION_MARKER_PATTERN, "")
      .replace(TRUNCATED_CITATION_PREFIX_PATTERN, "")
      .replace(NUMBERED_REF_PATTERN, "")
      .replace(TRUNCATED_NUMBERED_REF_PATTERN, "")
      .replace(DANGLING_SOURCES_HEADER_PATTERN, "")
      // ── Debris left behind by the strips ──────────────────────────────
      .replace(EMPTY_BOLD_PATTERN, "")
      .replace(/  +/g, " ")
      .replace(SPACE_BEFORE_PUNCTUATION_PATTERN, "$1")
      .replace(SEPARATOR_BEFORE_TERMINATOR_PATTERN, "")
      .replace(REPEATED_PUNCTUATION_PATTERN, "")
      .trim()
  );
}
