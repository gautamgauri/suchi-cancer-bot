import { normalizeSourceCode } from "../sessions/source-code";

/**
 * Source code carried by the website's "Ask on WhatsApp" links.
 *
 * A wa.me link can only prefill the message text, so the landing site ends
 * its greeting with one line of the form `(src: wa-article)`. This module
 * reads that line, so the pipeline never sees it and the code can be counted
 * like the web chat's `?src=` codes.
 *
 * Only a LAST line of exactly `(src: <code>)` is read, and the code must pass
 * the same check as the web path (`normalizeSourceCode`: 1 to 32 lower-case
 * letters, digits, hyphens or underscores). Anything else is left in the text
 * untouched, so nothing a sender types is silently dropped.
 */

/** Text handed to the pipeline when the message held nothing but the source line. */
export const SOURCE_ONLY_TEXT = "Hello";

// Anchored, no nested quantifier, no alternation: linear in the line length.
const SOURCE_LINE_RE = /^\(src: ([^()\s]+)\)$/;

export interface SourceLineResult {
  /** Text for the pipeline, with the source line removed. */
  text: string;
  /** The validated code, when a valid source line was found. */
  sourceCode?: string;
}

export function extractSourceLine(raw: string): SourceLineResult {
  const lastBreak = raw.lastIndexOf("\n");
  const lastLine = raw.slice(lastBreak + 1).trim();
  const match = SOURCE_LINE_RE.exec(lastLine);
  if (!match) return { text: raw };
  const sourceCode = normalizeSourceCode(match[1]);
  if (!sourceCode) return { text: raw };
  const rest = lastBreak < 0 ? "" : raw.slice(0, lastBreak).trim();
  return { text: rest || SOURCE_ONLY_TEXT, sourceCode };
}
