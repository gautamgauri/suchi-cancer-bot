/**
 * Citation token format: [citation:docId:chunkId]
 */
const CITATION_REGEX = /\[citation:([^:\]]+):([^:\]]+)\]/g;

export interface ParsedCitation {
  docId: string;
  chunkId: string;
  fullToken: string;
}

/**
 * Parse all citation tokens from draft text. Returns unique docIds for lookup.
 */
export function extractCitationDocIds(text: string): string[] {
  const docIds = new Set<string>();
  let m: RegExpExecArray | null;
  CITATION_REGEX.lastIndex = 0;
  while ((m = CITATION_REGEX.exec(text)) !== null) {
    docIds.add(m[1]);
  }
  return [...docIds];
}

/**
 * Parse all citation tokens and return full list (docId, chunkId, fullToken).
 */
export function parseCitations(text: string): ParsedCitation[] {
  const out: ParsedCitation[] = [];
  let m: RegExpExecArray | null;
  CITATION_REGEX.lastIndex = 0;
  while ((m = CITATION_REGEX.exec(text)) !== null) {
    out.push({ docId: m[1], chunkId: m[2], fullToken: m[0] });
  }
  return out;
}
