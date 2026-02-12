/**
 * Citation Resolution Utility
 *
 * Replaces [citation:docId:chunkId] tokens with numbered references [1], [2], ...
 * and appends a References section.
 */

export interface CitationEntry {
  number: number;
  docId: string;
  chunkId: string;
  title: string;
  url?: string;
}

export interface CitationResolutionResult {
  resolvedText: string;
  rawDraftText: string;
  references: CitationEntry[];
}

export function resolveCitations(
  draftText: string,
  evidencePack: Array<{ chunkId: string; docId: string; text: string; title?: string; url?: string }>,
): CitationResolutionResult {
  const rawDraftText = draftText;

  // Build lookup: "docId:chunkId" -> { title, url }
  const chunkLookup = new Map<string, { title: string; url?: string }>();
  for (const chunk of evidencePack) {
    const key = `${chunk.docId}:${chunk.chunkId}`;
    if (!chunkLookup.has(key)) {
      chunkLookup.set(key, {
        title: chunk.title || chunk.docId,
        url: chunk.url,
      });
    }
  }

  // First pass: discover all unique citation tokens in order of appearance
  const citationRegex = /\[citation:([^:]+):([^\]]+)\]/g;
  const seenTokens = new Map<string, CitationEntry>();
  let refCounter = 0;
  let match: RegExpExecArray | null;

  while ((match = citationRegex.exec(draftText)) !== null) {
    const fullToken = match[0];
    if (seenTokens.has(fullToken)) continue;

    const docId = match[1];
    const chunkId = match[2];
    const key = `${docId}:${chunkId}`;
    const meta = chunkLookup.get(key);

    refCounter++;
    seenTokens.set(fullToken, {
      number: refCounter,
      docId,
      chunkId,
      title: meta?.title || docId,
      url: meta?.url,
    });
  }

  // Second pass: replace tokens with numbered references
  let resolvedText = draftText;
  for (const [token, entry] of seenTokens) {
    resolvedText = resolvedText.split(token).join(`[${entry.number}]`);
  }

  // Append References section
  if (seenTokens.size > 0) {
    const refLines: string[] = ["", "---", "", "## References", ""];
    for (const entry of seenTokens.values()) {
      const urlPart = entry.url ? ` ${entry.url}` : "";
      refLines.push(`[${entry.number}] ${entry.title}.${urlPart}`);
    }
    resolvedText += "\n" + refLines.join("\n");
  }

  return {
    resolvedText,
    rawDraftText,
    references: Array.from(seenTokens.values()),
  };
}
