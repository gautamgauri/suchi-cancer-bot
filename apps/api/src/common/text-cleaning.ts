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
 * The prompt SECTION LABELS of the `"SAFE + USEFUL" RESPONSE CONTRACT`, built
 * below into two passes each.
 *
 * WHY A LIST MARKER IS NEVER PART OF THE LABEL. The contract is a numbered
 * list, and step 3 (`What to do next`) is deliberately kept — see below. A
 * strip that also ate the `1.`, `2.` and `4.` of the steps it removes would
 * hand the reader a list whose only surviving number is `3.`: a numbered list
 * with no `1.` anywhere, which is the machine artifact issue #158 reports,
 * recreated by the fix for #152. So the label goes and the marker stays, and
 * an echoed contract still reads as `1. … 2. … 3. … 4. …`.
 *
 * WHY THE PASSES ARE ORDERED. `**Label: sentence.**` — the model bolding the
 * whole line rather than just the label — has to be recognised as one span,
 * because removing the label alone strands the closing `**` in the reader's
 * bubble (`stripCitationDebris` only collapses EMPTY bold pairs). The
 * whole-line pass therefore runs before the general one.
 */

/** A line whose bold wrapper opens before the label and closes at end of line. */
function boldedLabelLinePattern(labels: string, terminators: string, flags: string): RegExp {
  return new RegExp(
    // The list marker, if any, is captured and put back.
    "(^|\\n)([ \\t]*(?:\\d{1,2}[.)]|[-*+](?=[ \\t]))?[ \\t]*)" +
      "\\*\\*[ \\t]*(?:" + labels + ")[ \\t]*(?:\\(optional\\))?[ \\t]*" +
      "[" + terminators + "][ \\t]*" +
      // Not `**` here: that is the ordinary `**Label:** body` form, which the
      // general pass below handles without touching the body's own markup.
      "(?!\\*)([^\\n]*?)\\*\\*[ \\t]*(?=\\n|$)",
    flags
  );
}

/**
 * The label itself, in the forms the model actually writes it.
 *
 * A LOOKBEHIND, not `(^|\s)`: a consuming group would eat the whitespace that
 * separates this label from a second one immediately after it, and with no `m`
 * flag `^` cannot re-anchor there, so `Label: Label: text` only ever lost its
 * first label. Matching the boundary without consuming it makes the pass
 * self-consistent and lets the replacement be the empty string.
 *
 * The trailing `\s*` is what keeps a label that had a paragraph to itself from
 * leaving a third newline behind on the chat and WhatsApp surfaces, which
 * (unlike `cleanForSpeech`) never collapse blank lines.
 */
function labelPattern(
  labels: string,
  terminators: string,
  allowNewlineTerminator: boolean,
  flags: string
): RegExp {
  return new RegExp(
    "(?<=^|\\s)" +
      "\\*{0,2}[ \\t]*(?:" + labels + ")[ \\t]*\\*{0,2}[ \\t]*" +
      "(?:\\(optional\\))?[ \\t]*\\*{0,2}[ \\t]*" +
      "(?:[" + terminators + "]" + (allowNewlineTerminator ? "|(?=\\n)" : "") + ")" +
      "[ \\t]*\\*{0,2}\\s*",
    flags
  );
}

/**
 * `Educational answer:` is a prompt SECTION LABEL (`prompts/explain-mode.ts:24`,
 * `prompts/navigate-mode.ts:16`, `llm.service.ts:1034`), not a reader-facing
 * heading — the web escalation banner already drops this one. The raw label
 * survives in the stored text for evaluation; it just stops being delivered.
 *
 * Case-INSENSITIVE, which is why its terminator stays `:` only: under `i` a
 * bare newline or an em dash would also match the ordinary prose "…here is an
 * educational answer — …", and over-stripping is a regression.
 */
const SECTION_LABELS = "Educational answer";
const SECTION_LABEL_PATTERN = labelPattern(SECTION_LABELS, ":：", false, "gi");
const BOLDED_SECTION_LABEL_LINE_PATTERN = boldedLabelLinePattern(SECTION_LABELS, ":：", "gi");

/**
 * The OTHER step labels of the same `"SAFE + USEFUL" RESPONSE CONTRACT`
 * (`prompts/explain-mode.ts:22-26`, `prompts/navigate-mode.ts:14-22`).
 *
 * `Educational answer` is step 2 of that contract and is already stripped
 * above; step 1 (`What I understood`) and step 4 (`One clarifying question`)
 * are written in the same place, in the same voice, and leak the same way. The
 * live re-probe after PR #153 found `What I understood:` in the DELIVERED text
 * of five scheduled runs — twice spliced, in English, into an otherwise
 * Devanagari reply, which reads as a machine artifact rather than an opener.
 * It survived because the two shipped patterns are shaped for the other leak:
 * `SECTION_LABEL_PATTERN` enumerates only `Educational answer`, and
 * `CONTRACT_HEADING_PATTERN` needs an `N.` prefix and an ALL-CAPS keyword,
 * while the model delivers this one title-case and unnumbered.
 *
 * Same fail-CLOSED, labels-only bargain as everything else in this strip: the
 * grounding sentence after the colon is kept, only the label goes.
 *
 * DELIBERATELY EXCLUDED: step 3, `What to do next`. That one IS reader-facing —
 * `response-templates.ts:125` emits `**What to do next:**` as our own copy, the
 * escalation reconciler and the clinical keyword enforcer both anchor on it,
 * and a reader needs the signpost before a list of next steps. Stripping it
 * would be over-stripping, which this function treats as a regression.
 *
 * CASING. Only the FIRST word has to stay capitalised for the exclusion this
 * pattern needs — a lowercase `...let me restate what I understood: ...` is
 * prose, not a label, and must survive. Every later word is free, so the
 * title-case heading a model most often writes (`What I Understood:`,
 * `One Clarifying Question:`) is covered at no cost to that guard.
 *
 * TERMINATORS. `:` / `：`, plus the em dash and the bare newline that
 * `CONTRACT_HEADING_PATTERN` already accepts, because the model writes
 * `**What I understood** — …` and a standalone `**What I understood**` heading
 * line just as readily as it writes the colon.
 */
const CONTRACT_STEP_LABELS =
  "What I [Uu]nderstood|One [Cc]larifying [Qq]uestion";
const CONTRACT_STEP_LABEL_PATTERN = labelPattern(CONTRACT_STEP_LABELS, ":：—", true, "g");
const BOLDED_CONTRACT_STEP_LABEL_LINE_PATTERN = boldedLabelLinePattern(
  CONTRACT_STEP_LABELS,
  ":：—",
  "g"
);

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
    // Whole-line bold first, so the closing `**` goes with the label that
    // opened it instead of being stranded in the reader's bubble.
    .replace(BOLDED_SECTION_LABEL_LINE_PATTERN, "$1$2$3")
    .replace(BOLDED_CONTRACT_STEP_LABEL_LINE_PATTERN, "$1$2$3")
    // The label patterns match their leading boundary with a lookbehind, so
    // the replacement is empty and the boundary survives for the next match.
    .replace(SECTION_LABEL_PATTERN, "")
    .replace(CONTRACT_STEP_LABEL_PATTERN, "")
    .replace(MACHINE_SALUTATION_PATTERN, "$1");
}

/**
 * A markdown image, in the three shapes it arrives in (issue #173).
 *
 * Suchi never emits an image, so one in patient-facing text came from the
 * knowledge base — the chunks are converted from source web pages and carry the
 * page's markup. A caregiver's reply contained
 * `![Sick woman lying in man's arms relaxing on couch.](/sites/g/files/…`: an
 * NCI CMS image whose site-relative URL resolves to nothing on this domain, and
 * which the chat surface renders as literal text rather than as a picture.
 *
 * The whole image goes, alt text included: the alt text describes a stock photo
 * the reader cannot see, so keeping it only moves the artifact. Complete form
 * first, so what remains of an `![` opener is unterminated by definition; the
 * unterminated forms are line-anchored and cannot run past a newline into the
 * prose below.
 */
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]\n]*\]\([^)\n]*\)/g;
const UNTERMINATED_MARKDOWN_IMAGE_PATTERN = /!\[[^\]\n]*\]\([^)\n]*$/gm;
const UNTERMINATED_IMAGE_ALT_PATTERN = /!\[[^\]\n]*$/gm;

/**
 * Remove markdown images from text about to be shown or spoken to a patient.
 *
 * The root cause of the reported leak is upstream, in the template path that
 * quotes chunk text into bullets (`plan-executor.service.ts`, issue #173). This
 * is the delivery-boundary net for every other path into the same bubble —
 * the LLM can copy an image out of the evidence it is given just as easily —
 * and it sits here, with the citation and scaffolding strips, because this is
 * the one boundary all three patient surfaces pass through (issue #153).
 */
export function stripMarkdownImages(text: string): string {
  if (!text) return text;

  return text
    .replace(MARKDOWN_IMAGE_PATTERN, "")
    .replace(UNTERMINATED_MARKDOWN_IMAGE_PATTERN, "")
    .replace(UNTERMINATED_IMAGE_ALT_PATTERN, "");
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
    stripCitationDebris(
      stripPromptScaffolding(stripMarkdownImages(stripCitationMarkers(text)))
    )
  );
}
