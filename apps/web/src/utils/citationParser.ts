/**
 * Client-side citation-marker scrubbing.
 *
 * Citations are an audit artifact, not reader furniture (#54): the API strips
 * every `[citation:docId:chunkId]` marker from `responseText` before it leaves
 * the server. This module used to also *parse* those markers and render them
 * as inline `[n]` badges and a per-answer "Sources" footer, but because the
 * markers never reach the client that renderer could not fire, and the copy
 * promising verifiable citations was false (#90). The renderer was removed;
 * what remains is the client's fail-closed backstop.
 */

/**
 * Citation debris that must never be rendered (issue #68).
 *
 * The server already strips markers before display, but the client must fail
 * closed too: when a generation stops *inside* a marker there is no closing
 * bracket, and the raw knowledge-base identifier would otherwise be rendered
 * verbatim.
 *
 * Three alternatives, in order:
 *   1. a complete marker,
 *   2. an UNTERMINATED marker — content restricted to the characters real
 *      document/chunk ids use, so the strip stops at the first space and can
 *      never eat prose that follows a malformed marker mid-text,
 *   3. a marker truncated inside the literal `[citation:` prefix itself
 *      (e.g. a trailing `[cita`), anchored to end-of-text.
 *
 * Stripping is the safe direction: a citation the reader was never meant to
 * see costs nothing when removed.
 */
const CITATION_DEBRIS_PATTERN =
  /\[citation:[^[\]\n]*\]|\[citation:[A-Za-z0-9_.:-]*|\[c(?:i(?:t(?:a(?:t(?:i(?:o(?:n)?)?)?)?)?)?)?$/g;

/**
 * Remove citation markers from text for display.
 *
 * Removes complete, unterminated and truncated markers — see
 * CITATION_DEBRIS_PATTERN.
 */
export function removeCitationMarkers(text: string): string {
  return text.replace(CITATION_DEBRIS_PATTERN, "");
}
