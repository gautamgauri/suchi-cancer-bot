// Outbound formatting for WhatsApp (§16 / FR-WA-011).
// WhatsApp uses its own lightweight markup (*bold*, _italic_, ~strike~) and
// auto-links bare URLs. The chat pipeline emits GitHub-flavoured markdown, so
// we translate, then split on the 4096-char message-body limit.

// FR-9: configurable safe per-message threshold (well under WhatsApp's 4096 hard
// cap) and a max number of outbound messages for one answer.
export const WA_MAX_LEN = 3200;
export const WA_MAX_MESSAGES = 3;
// Appended to the last message when content is truncated to the message cap.
const CONTINUATION_NOTE = "(Reply *continue* / *aur* to see the rest.)";

/** Translate markdown emphasis/links/headings/bullets to WhatsApp-friendly text. */
export function toWhatsAppMarkdown(input: string): string {
  let t = input;

  // Markdown links [label](url) -> "label: url" (WhatsApp auto-links the bare URL).
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1: $2");

  // Code fences and inline code -> strip the backticks, keep the content.
  t = t.replace(/```[a-zA-Z0-9]*\n?/g, "").replace(/`([^`]+)`/g, "$1");

  // Bold: **x** or __x__ -> *x* (WhatsApp bold). Do this before bullet handling.
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  t = t.replace(/__([^_\n]+)__/g, "*$1*");

  // Markdown headings (#, ##, ...) -> a bold line.
  t = t.replace(/^#{1,6}\s+(.+?)\s*#*$/gm, "*$1*");

  // List bullets "- " / "* " / "+ " at line start -> "• ".
  t = t.replace(/^[ \t]*[-*+]\s+/gm, "• ");

  // Collapse runs of 3+ blank lines.
  t = t.replace(/\n{3,}/g, "\n\n");

  return t.trim();
}

/**
 * Hard-wrap a single over-long line (rare) without breaking mid-word: prefer
 * sentence boundaries, then spaces. Used only when one line exceeds maxLen.
 */
function wrapLongLine(line: string, maxLen: number): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > maxLen) {
    // Prefer the last sentence end (., ।, !, ?) within the limit.
    const window = rest.slice(0, maxLen);
    let cut = Math.max(
      window.lastIndexOf("। "),
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
    );
    if (cut > 0) cut += 1; // keep the punctuation with the first part
    else cut = window.lastIndexOf(" "); // fall back to a word boundary
    if (cut <= 0) cut = maxLen; // last resort: hard cut
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/**
 * Split into WhatsApp messages (FR-9). Packing is LINE-ATOMIC: a line — a
 * sentence, a safety warning, a helpline instruction, or a numbered action — is
 * never split across two messages (only a pathologically long single line is
 * hard-wrapped, on sentence/word boundaries). Blank lines are preferred break
 * points so paragraphs stay together.
 */
export function splitForWhatsApp(
  text: string,
  maxLen = WA_MAX_LEN,
  maxMessages = WA_MAX_MESSAGES,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Expand any over-long single line into wrapped pieces; everything else stays
  // atomic. Keep blank lines as paragraph separators.
  const units: string[] = [];
  for (const line of trimmed.split("\n")) {
    if (line.length > maxLen) units.push(...wrapLongLine(line, maxLen));
    else units.push(line);
  }

  const messages: string[] = [];
  let cur = "";
  const flush = () => {
    const t = cur.replace(/\n{3,}/g, "\n\n").trim();
    if (t) messages.push(t);
    cur = "";
  };
  for (const unit of units) {
    const candidate = cur ? `${cur}\n${unit}` : unit;
    if (candidate.length > maxLen && cur) {
      flush();
      cur = unit;
    } else {
      cur = candidate;
    }
  }
  flush();

  if (messages.length <= maxMessages) return messages;

  // Truncate to the message cap and invite the user to continue. Make room for
  // the note within the last kept message — trim whole trailing lines first
  // (keeps atomic units intact), then fall back to a word boundary if the last
  // message is a single long line.
  const kept = messages.slice(0, maxMessages);
  const note = `\n\n${CONTINUATION_NOTE}`;
  const room = maxLen - note.length;
  let last = kept[maxMessages - 1];
  while (last.length > room && last.includes("\n")) {
    last = last.slice(0, last.lastIndexOf("\n")).trimEnd();
  }
  if (last.length > room) {
    let cut = last.lastIndexOf(" ", room);
    if (cut <= 0) cut = room;
    last = last.slice(0, cut).trimEnd();
  }
  kept[maxMessages - 1] = `${last}${note}`;
  return kept;
}

/** Convenience: translate + split in one call. */
export function formatForWhatsApp(input: string): string[] {
  return splitForWhatsApp(toWhatsAppMarkdown(input));
}

/** Cheap input-language hint for the chat pipeline (FR-WA-012): Devanagari -> Hindi. */
export function detectLocale(text: string): "hi" | "en" {
  return /[ऀ-ॿ]/.test(text) ? "hi" : "en";
}
