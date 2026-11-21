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
 *
 * Internal prompt scaffolding is stripped here for the same reason (issue #152):
 * the response contracts are written as numbered ALL-CAPS imperatives addressed
 * to the model, and WhatsApp QA caught the model reproducing them verbatim in
 * the patient's reply bubble. This is the one boundary all three patient
 * surfaces pass through — HTTP chat (`chat.controller.ts`), voice
 * (`voice.service.ts`) and WhatsApp (`whatsapp.service.ts`) — so the strip
 * belongs here rather than in a fourth channel-specific cleaner.
 *
 * The patterns themselves moved to `common/text-cleaning.ts` (issue #87) so the
 * voice/TTS surface stops carrying its own, weaker copy of them. Behaviour here
 * is unchanged; `display-text-cleaner.spec.ts` is the guard on that.
 */

import {
  stripCitationDebris,
  stripCitationMarkers,
  stripMarkdownImages,
  stripPromptScaffolding,
} from "../../common/text-cleaning";

/**
 * Strip citation artifacts and the punctuation debris they leave behind.
 *
 * The structured citations data is still returned separately in the API
 * response for the frontend to render.
 */
export function cleanResponseForDisplay(text: string): string {
  if (!text) return text;
  return stripCitationDebris(
    stripPromptScaffolding(stripMarkdownImages(stripCitationMarkers(text)))
  );
}
