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
 * The patterns themselves moved to `common/text-cleaning.ts` (issue #87) so the
 * voice/TTS surface stops carrying its own, weaker copy of them. Behaviour here
 * is unchanged; `display-text-cleaner.spec.ts` is the guard on that.
 */

import { stripCitationDebris, stripCitationMarkers } from "../../common/text-cleaning";

/**
 * Strip citation artifacts and the punctuation debris they leave behind.
 *
 * The structured citations data is still returned separately in the API
 * response for the frontend to render.
 */
export function cleanResponseForDisplay(text: string): string {
  if (!text) return text;
  return stripCitationDebris(stripCitationMarkers(text));
}
