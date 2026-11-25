/**
 * Source code carried by the website's "Ask on WhatsApp" links.
 *
 * A wa.me link can only prefill the message text, so the landing site puts a
 * line of the form `(src: wa-article)` after its greeting. This module reads
 * that line, so the pipeline never sees it and the code can be counted like
 * the web chat's `?src=` codes.
 *
 * Only a line that is exactly `(src: <code>)`, standing alone on its own line,
 * with a code from WHATSAPP_SOURCE_CODES is read. The first such line counts.
 * Anything else is left in the text untouched and nothing is recorded, so a
 * word a sender types in the code position (for example a safety word) always
 * reaches the safety screens.
 */

/**
 * The only codes that are read and stripped. The landing site uses the first
 * four. `wa-qr` and `wa-poster` are kept for printed material. The four
 * `wa-<platform>` codes are used by the WhatsApp links in social posts
 * (social/links.ts, WHATSAPP_SOCIAL_CODES), one per platform.
 *
 * A new code needs an API deploy BEFORE the site, a print or a post uses it.
 * Until then its line reaches the pipeline as part of the message.
 */
export const WHATSAPP_SOURCE_CODES: ReadonlySet<string> = new Set([
  "wa-header",
  "wa-article",
  "wa-video",
  "wa-hospitals",
  "wa-qr",
  "wa-poster",
  "wa-linkedin",
  "wa-facebook",
  "wa-instagram",
  "wa-x",
]);

/** The two greeting lines the site prefills above the source line. */
export const PREFILLED_HINDI_LINE = "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।";
export const PREFILLED_ENGLISH_LINE = "Hello Suchi, I would like some information.";

/**
 * Text handed to the pipeline when the message held nothing but the source
 * line. GreetingDetector treats empty text as no greeting, and an empty turn
 * would reach retrieval and the model, so a plain greeting word stands in.
 */
export const SOURCE_ONLY_TEXT = "Hello";

// Anchored, no nested quantifier, no alternation: linear in the line length.
const SOURCE_LINE_RE = /^\(src: ([a-z0-9_-]{1,32})\)$/;

export interface SourceLineResult {
  /** Text for the pipeline. */
  text: string;
  /** The code, when an allow-listed source line was found and removed. */
  sourceCode?: string;
}

/**
 * Remove the site's source line and return the code.
 *
 * - With nothing typed after the source line, the greeting above it stays,
 *   so it gets the greeting reply.
 * - With text typed after it (WhatsApp leaves the cursor there), the two
 *   prefilled greeting lines directly above it are removed as well, so the
 *   pipeline gets exactly what the visitor typed.
 *
 * `flaggedBySafety` is the shared deterministic safety check. If it flags
 * the raw text and not the stripped text, the raw text is passed on and no
 * code is recorded: stripping must never change a safety outcome.
 */
export function extractSourceLine(raw: string, flaggedBySafety: (text: string) => boolean): SourceLineResult {
  const lines = raw.split("\n");
  let at = -1;
  let sourceCode: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const m = SOURCE_LINE_RE.exec(lines[i].trim());
    if (m && WHATSAPP_SOURCE_CODES.has(m[1])) {
      at = i;
      sourceCode = m[1];
      break;
    }
  }
  if (at < 0 || !sourceCode) return { text: raw };

  const typedAfter = lines.slice(at + 1).join("\n").trim();
  let before = lines.slice(0, at);
  if (
    typedAfter &&
    at >= 2 &&
    lines[at - 2].trim() === PREFILLED_HINDI_LINE &&
    lines[at - 1].trim() === PREFILLED_ENGLISH_LINE
  ) {
    before = lines.slice(0, at - 2);
  }
  const text = [before.join("\n").trim(), typedAfter].filter(Boolean).join("\n") || SOURCE_ONLY_TEXT;

  if (flaggedBySafety(raw) && !flaggedBySafety(text)) return { text: raw };
  return { text, sourceCode };
}
