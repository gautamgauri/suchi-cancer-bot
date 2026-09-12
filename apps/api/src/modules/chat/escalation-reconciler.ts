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
 * Markers that make a sentence a statement about emergency-level urgency or
 * triage. Descriptive medical vocabulary ("a life-threatening condition") is
 * deliberately absent — only statements about emergency *action* qualify.
 */
const URGENCY_TRIAGE_PATTERNS: ReadonlyArray<RegExp> = [
  // India-first emergency numbers used by the escalation template itself
  /\b(?:112|108|102)\b/,
  /\bambulance\b/i,
  /\bemergency\s+(?:room|department|ward|call|care|services?|number|helpline|treatment|attention|evaluation|visit)\b/i,
  /\b(?:is|isn'?t|are|aren'?t|was|wasn'?t|be)\s+(?:not\s+)?(?:an?\s+)?(?:medical\s+|true\s+|real\s+)?emergency\b/i,
  /\bmedical\s+emergency\b/i,
  /\bimmediate(?:ly)?\s+medical\s+(?:attention|care|help)\b/i,
  /\burgent(?:ly)?\s+(?:care|medical\s+attention|attention|evaluation)\b/i,
  /\bgo\s+to\s+(?:the\s+)?(?:nearest\s+)?(?:hospital|emergency|ER\b)/i,
  /\b(?:call|dial)\s+(?:911|999)\b/,
];

/** A markdown line that is only a bold section label, e.g. `**What to do next**:`. */
const SECTION_LABEL = /^\s*\*{2}[^*]+\*{2}\s*:?\s*$/;

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
    if (!SECTION_LABEL.test(lines[i])) {
      kept.push(lines[i]);
      continue;
    }

    // Look ahead for content belonging to this label.
    let hasContent = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (SECTION_LABEL.test(lines[j])) break;
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
