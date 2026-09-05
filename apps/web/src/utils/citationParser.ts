import { CitationData } from "../components/Citation";

const CITATION_PATTERN = /\[citation:([^:]+):([^\]]+)\]/g;

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
 * Remove citation markers from text for display
 */
export function removeCitationMarkers(text: string): string {
  return text.replace(CITATION_PATTERN, "");
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
      const textContent = text.substring(lastIndex, citation.position);
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
    const remainingText = text.substring(lastIndex);
    if (remainingText) {
      parts.push({ type: "text", content: remainingText });
    }
  }

  // If no citations, return whole text as single part
  if (parts.length === 0) {
    parts.push({ type: "text", content: text });
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













