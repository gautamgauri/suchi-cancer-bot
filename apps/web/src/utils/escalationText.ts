/**
 * Separator the API uses to join the safety escalation block and the appended
 * RAG answer on the urgent path (`ESCALATION_RAG_SEPARATOR` in
 * apps/api/src/modules/chat/chat.service.ts). Kept byte-identical here.
 */
export const ESCALATION_RAG_SEPARATOR = "\n\n**Information from trusted sources:**\n\n";

/**
 * Picks the text the emergency banner should show (issue #111).
 *
 * Prefers `safety.bannerText`, which the API sends alongside
 * `show_emergency_banner`. Falls back to slicing the composed response at the
 * separator so the banner is still correct against an API build that predates
 * that field.
 *
 * This only chooses where to cut — the escalation copy itself is never
 * rewritten, and the full response still renders once in the message bubble.
 */
export function resolveEscalationText(
  responseText: string,
  bannerText?: string | null
): string {
  if (bannerText && bannerText.trim().length > 0) {
    return bannerText;
  }

  const separatorIndex = responseText.indexOf(ESCALATION_RAG_SEPARATOR);
  return separatorIndex === -1 ? responseText : responseText.slice(0, separatorIndex);
}
