import { CitationData } from "../components/Citation";

/**
 * A COMPLETE `[citation:docId:chunkId]` marker.
 *
 * The id groups exclude `[`, `]` and newlines. A real marker never contains
 * them, and excluding `[` means this pattern cannot start on an *unterminated*
 * marker and run forward into a later complete one, swallowing the legitimate
 * prose in between.
 */
const CITATION_PATTERN = /\[citation:([^:[\]\n]+):([^[\]\n]+)\]/g;

/**
 * Citation debris that must never be rendered (issue #68).
 *
 * The server already strips markers before display, but the client must fail
 * closed too: when a generation stops *inside* a marker there is no closing
 * bracket, `CITATION_PATTERN` does not match, and the raw knowledge-base
 * identifier would otherwise fall through `splitTextWithCitations` into a
 * plain-text part and be rendered verbatim.
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

export interface ParsedCitation {
  citationText: string;
  docId: string;
  chunkId: string;
  position: number;
}

/**
 * Parse citations from response text
 * Format: [citation:docId:chunkId]
 */
export function parseCitations(text: string): ParsedCitation[] {
  const citations: ParsedCitation[] = [];
  let match;

  while ((match = CITATION_PATTERN.exec(text)) !== null) {
    citations.push({
      citationText: match[0],
      docId: match[1],
      chunkId: match[2],
      position: match.index
    });
  }

  return citations.sort((a, b) => a.position - b.position);
}

/**
 * Remove citation markers from text for display.
 *
 * Removes unterminated/truncated markers too — see CITATION_DEBRIS_PATTERN.
 */
export function removeCitationMarkers(text: string): string {
  return text.replace(CITATION_DEBRIS_PATTERN, "");
}

/**
 * Split text into parts (text and citations) for rendering
 */
export interface TextPart {
  type: "text" | "citation";
  content: string;
  citation?: ParsedCitation;
}

export function splitTextWithCitations(text: string): TextPart[] {
  const citations = parseCitations(text);
  const parts: TextPart[] = [];
  let lastIndex = 0;

  citations.forEach((citation) => {
    // Add text before citation
    if (citation.position > lastIndex) {
      // Scrub debris: an unterminated marker is not a parsed citation, so
      // without this it would be rendered verbatim as plain text (#68).
      const textContent = removeCitationMarkers(text.substring(lastIndex, citation.position));
      if (textContent) {
        parts.push({ type: "text", content: textContent });
      }
    }

    // Add citation
    parts.push({
      type: "citation",
      content: citation.citationText,
      citation
    });

    lastIndex = citation.position + citation.citationText.length;
  });

  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = removeCitationMarkers(text.substring(lastIndex));
    if (remainingText) {
      parts.push({ type: "text", content: remainingText });
    }
  }

  // If no citations, return whole text as single part
  if (parts.length === 0) {
    parts.push({ type: "text", content: removeCitationMarkers(text) });
  }

  return parts;
}

/**
 * Convert parsed citation to CitationData format
 * Note: We don't have document metadata from API yet, so we'll use defaults
 */
export function toCitationData(
  citation: ParsedCitation,
  index: number
): CitationData {
  return {
    docId: citation.docId,
    chunkId: citation.chunkId,
    title: `Source ${index + 1}`,
    isTrusted: false // Will be determined by source metadata if available
  };
}













