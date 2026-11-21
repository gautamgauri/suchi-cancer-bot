/**
 * Escalation reconciler — issue #112.
 *
 * On the urgent path `chat.service` composes one message out of two halves:
 *
 *   S2 escalation template
 *   + "\n\n**Information from trusted sources:**\n\n"
 *   + the RAG answer
 *
 * Nothing reconciles them, so the appended half can restate urgency thresholds
 * that contradict the escalation printed directly above it. Observed on live
 * prod (browser QA run 2026-09-10T19-02-52, q05, messageId f35aa46a): the
 * escalation said call 112/108 now, and the appended half said "…it does not
 * typically require an emergency call to 112 or 108 unless you have other
 * severe, life-threatening symptoms."
 *
 * The rule applied here: **once an escalation has fired, the escalation block is
 * the only voice on emergency-level urgency.** Sentences in the appended half
 * that make a statement about emergency care are removed regardless of polarity
 * — a reassuring one contradicts the escalation, and a reinforcing one is
 * already stated verbatim in the escalation block above.
 *
 * This is composition logic only. It never edits the escalation, never rewords
 * anything, and only ever removes text from the *appended* half.
 *
 * Limits (deliberate, see the PR for #112):
 * - It matches known sentence shapes. An LLM can phrase a downgrade without any
 *   of these markers ("see a doctor within a week"), and that survives.
 * - It is fail-safe in direction: a miss leaves today's behaviour, and a false
 *   positive drops a sentence, which can never weaken the escalation.
 */

/**
 * Emergency phone numbers used on the India-first escalation path. A bare
 * number is *not* enough to make a sentence a triage statement — "your
 * temperature reaches 102°F" is legitimate fever guidance — so every number
 * match below requires a dialling/ambulance context and rejects measurements.
 */
const EMERGENCY_NUMBER = "(?:112|108|102)";

/** Rejects "102°F", "102 degrees", "102 F" and similar measurement readings. */
const NOT_A_MEASUREMENT = "(?!\\s*(?:\u00B0|\u00BA|degrees?\\b|deg\\b|F\\b|C\\b|mg\\b|ml\\b|%))";

/** "112", "112 or 108", "112/108". */
const NUMBER_CHAIN = `${EMERGENCY_NUMBER}${NOT_A_MEASUREMENT}(?:\\s*(?:,|/|or|and)\\s*${EMERGENCY_NUMBER}${NOT_A_MEASUREMENT})*`;

const DIAL_VERB = "(?:call|calls|calling|called|dial|dials|dialled|dialed|dialling|dialing|phone|phoned|phoning|ring|contact|contacting|reach)";

/** Filler allowed between the dialling verb and the number. */
const DIAL_FILLER =
  "(?:the\\s+|an?\\s+|on\\s+|at\\s+|to\\s+|for\\s+|emergency\\s+|national\\s+|ambulance\\s+|helpline\\s+|hotline\\s+|number\\s+|numbers\\s+|services?\\s+|line\\s+|toll-?free\\s+)*";

/** Words that make a nearby emergency number a dialling instruction. */
const DIAL_NOUN = "(?:ambulance|helpline|hotline|emergency\\s+(?:number|numbers|services?|line|helpline))";

/**
 * Markers that make a sentence a statement about emergency-level urgency or
 * triage. Descriptive medical vocabulary ("a life-threatening condition") is
 * deliberately absent — only statements about emergency *action* qualify.
 */
const URGENCY_TRIAGE_PATTERNS: ReadonlyArray<RegExp> = [
  // India-first emergency numbers, but only in a call/dial/ambulance context.
  new RegExp(`\\b${DIAL_VERB}\\s+${DIAL_FILLER}${NUMBER_CHAIN}\\b`, "i"),
  new RegExp(`\\b${DIAL_NOUN}\\b[^.!?\\n]{0,24}\\b${NUMBER_CHAIN}\\b`, "i"),
  new RegExp(`\\b${NUMBER_CHAIN}\\b[^.!?\\n]{0,24}\\b${DIAL_NOUN}\\b`, "i"),
  /\bambulance\b/i,
  // "emergency care", "emergency medical care", "emergency department visit",
  // "emergency medical attention" — the optional `medical` is what let
  // "This does not require emergency medical care" through before (#114 review).
  /\bemergency\s+(?:medical\s+)?(?:room|department|ward|call|care|services?|service|number|helpline|treatment|attention|evaluation|visit|help)\b/i,
  // Reverse word order: "medical emergency", "medical emergency care".
  /\bmedical\s+emergency\b/i,
  /\b(?:is|isn'?t|are|aren'?t|was|wasn'?t|be)\s+(?:not\s+)?(?:an?\s+)?(?:medical\s+|true\s+|real\s+)?emergency\b/i,
  // Explicit negation of emergency action in either order. Removal is
  // polarity-agnostic, so these exist to catch negated shapes whose noun phrase
  // is not one of the fixed ones above ("no need to seek emergency help now").
  /\b(?:not|no|never|none|don'?t|do\s+not|doesn'?t|does\s+not|didn'?t|isn'?t|is\s+not|aren'?t|are\s+not|won'?t|will\s+not|wouldn'?t|shouldn'?t|needn'?t|unlikely)\b[^.!?\n]{0,60}\bemergenc(?:y|ies)\b/i,
  /\bemergenc(?:y|ies)\b[^.!?\n]{0,60}\b(?:not|isn'?t|aren'?t|unnecessary|unlikely)\b/i,
  /\bimmediate(?:ly)?\s+medical\s+(?:attention|care|help)\b/i,
  /\burgent(?:ly)?\s+(?:care|medical\s+attention|attention|evaluation)\b/i,
  /\bgo\s+to\s+(?:the\s+)?(?:nearest\s+)?(?:hospital|emergency|ER\b)/i,
  /\b(?:call|dial)\s+(?:911|999)\b/,
];

/**
 * A markdown line that is nothing but bold text, e.g. `**What to do next**:` —
 * the candidate shape for a section heading. Whether it *is* a heading is
 * decided by `isSectionLabel`.
 */
const BOLD_ONLY_LINE = /^\s*\*{2}([^*]+)\*{2}\s*(:?)\s*$/;

/** Longest bold line still plausible as a heading rather than a sentence. */
const MAX_HEADING_LENGTH = 60;

/**
 * Section headings the generator and the templates actually emit (see the
 * prompt sections in `llm.service.ts` and `response-templates.ts`). Used for
 * bold lines that carry no trailing colon.
 */
const HEADING_VOCABULARY =
  /^(?:educational\s+answer|answer|summary|overview|key\s+points?|key\s+points?\s+to\s+be\s+aware\s+of|what\s+to\s+do\s+next|next\s+steps?|what\s+i\s+can\s+help\s+with|what\s+this\s+means|red\s+flags?|warning\s+signs?|when\s+to\s+\w+|questions?\s+to\s+ask|treatment\s+options?|side\s+effects?|causes?|symptoms?|diagnosis|prevention|screening|risk\s+factors?|support|resources?|quick\s+resources?|please\s+share|important|note|sources?|references?|disclaimer|cost|costs|financial\s+\w+|follow[-\s]?up|emergency|urgent)\b/i;

/**
 * True when a bold-only line is a section heading rather than a bold sentence.
 *
 * Treating *every* bold-only line as a heading deleted terminal factual lines
 * such as `**Do not stop treatment without speaking to your doctor.**`, and a
 * bold-only answer collapsed to empty text, which made `ChatService` discard
 * the whole grounded half (#114 review). A heading must therefore be short,
 * must not be a full sentence, and must either end in a colon or use known
 * heading vocabulary.
 */
function isSectionLabel(line: string): boolean {
  const match = line.match(BOLD_ONLY_LINE);
  if (!match) return false;

  const inner = match[1].trim();
  const hasTrailingColon = match[2] === ":" || inner.endsWith(":");
  const text = inner.replace(/:+$/, "").trim();

  if (text.length === 0) return false;
  // A full sentence is content, never a heading.
  if (/[.\u0964!?]$/.test(text)) return false;
  if (text.length > MAX_HEADING_LENGTH) return false;

  return hasTrailingColon || HEADING_VOCABULARY.test(text);
}

/** Leading list marker or blockquote marker to preserve when rewriting a line. */
const LINE_PREFIX = /^\s*(?:[-*•]\s+|\d+\.\s+|>\s+)?/;

export interface ReconciledAnswer {
  /** The appended half with urgency/triage statements removed. */
  text: string;
  /** Sentences that were removed, for logging. Never patient-visible. */
  removed: string[];
}

/** True when the sentence makes a statement about emergency-level urgency. */
export function statesEmergencyTriage(sentence: string): boolean {
  return URGENCY_TRIAGE_PATTERNS.some((pattern) => pattern.test(sentence));
}

/** Splits on sentence terminators while keeping the original spacing intact. */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])(?=\s)/);
}

/** Drops a section label that no longer has any content under it. */
function dropEmptySections(lines: string[]): string[] {
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!isSectionLabel(lines[i])) {
      kept.push(lines[i]);
      continue;
    }

    // Look ahead for content belonging to this label.
    let hasContent = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (isSectionLabel(lines[j])) break;
      if (lines[j].trim() !== "") {
        hasContent = true;
        break;
      }
    }

    if (hasContent) kept.push(lines[i]);
  }

  return kept;
}

/**
 * Removes emergency/triage statements from the answer appended below an
 * escalation. Returns an empty `text` when nothing survives — the caller should
 * then deliver the escalation on its own rather than an empty section.
 */
export function reconcileAppendedAnswer(answer: string): ReconciledAnswer {
  const removed: string[] = [];
  const kept: string[] = [];

  for (const line of answer.split("\n")) {
    if (line.trim() === "") {
      kept.push(line);
      continue;
    }

    const prefix = line.match(LINE_PREFIX)?.[0] ?? "";
    const body = line.slice(prefix.length);

    const survivors = splitSentences(body).filter((sentence) => {
      if (!statesEmergencyTriage(sentence)) return true;
      removed.push(sentence.trim());
      return false;
    });

    const rebuilt = survivors.join("").trim();
    // A line that was nothing but triage talk goes away entirely, marker included.
    if (rebuilt.length > 0) kept.push(prefix + rebuilt);
  }

  const text = dropEmptySections(kept).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { text, removed };
}
