// Outbound formatting for WhatsApp (§16 / FR-WA-011).
// WhatsApp uses its own lightweight markup (*bold*, _italic_, ~strike~) and
// auto-links bare URLs. The chat pipeline emits GitHub-flavoured markdown, so
// we translate, then split on the 4096-char message-body limit.

export const WA_MAX_LEN = 4096;

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

/** Split text into WhatsApp-sized chunks, preferring paragraph then word boundaries. */
export function splitForWhatsApp(text: string, maxLen = WA_MAX_LEN): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];

  const chunks: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };

  for (const para of trimmed.split(/\n\n/)) {
    if (para.length > maxLen) {
      // Paragraph itself too long — hard-split on word boundaries.
      flush();
      let rest = para;
      while (rest.length > maxLen) {
        let cut = rest.lastIndexOf(" ", maxLen);
        if (cut <= 0) cut = maxLen; // no space found — split mid-word as last resort
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut);
      }
      cur = rest.trim();
    } else if (cur && cur.length + 2 + para.length > maxLen) {
      flush();
      cur = para;
    } else {
      cur = cur ? `${cur}\n\n${para}` : para;
    }
  }
  flush();
  return chunks;
}

/** Convenience: translate + split in one call. */
export function formatForWhatsApp(input: string): string[] {
  return splitForWhatsApp(toWhatsAppMarkdown(input));
}

/** Cheap input-language hint for the chat pipeline (FR-WA-012): Devanagari -> Hindi. */
export function detectLocale(text: string): "hi" | "en" {
  return /[ऀ-ॿ]/.test(text) ? "hi" : "en";
}
