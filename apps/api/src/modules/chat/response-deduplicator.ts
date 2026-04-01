/**
 * Response Deduplicator - removes duplicate sections from LLM responses
 *
 * Duplication occurs when both the LLM prompt contract and the template layer
 * generate the same structural sections (e.g., "What to do next", reassurance text).
 * This module provides:
 *   1. A source-level check (hasSection) to skip template sections when the LLM already covers them
 *   2. A post-processor (deduplicateResponse) as a safety net for any remaining duplicates
 */

/**
 * Check whether a response already contains a given section header.
 * Used at the source to conditionally skip template concatenation.
 */
export function hasSection(text: string, sectionHeader: string): boolean {
  // Normalize: match bold markdown headers case-insensitively
  // e.g., "**What to do next:**" or "**What to do next**"
  const escaped = sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\*\\*${escaped}[:\\*]`, "i");
  return pattern.test(text);
}

/**
 * Post-process a response to remove duplicate sections.
 * This is a safety net applied before returning the final response.
 */
export function deduplicateResponse(text: string): string {
  let result = text;

  // 1. Remove duplicate markdown headers — keep first occurrence, remove second
  result = removeDuplicateHeaders(result);

  // 2. Remove duplicate bullet points (exact match after whitespace normalization)
  result = removeDuplicateBullets(result);

  // 3. Remove near-duplicate paragraphs (>80% word overlap)
  result = removeNearDuplicateParagraphs(result);

  // 4. Clean up resulting multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Find duplicate bold markdown headers and remove the second occurrence
 * along with its content (up to the next header or end of text).
 */
function removeDuplicateHeaders(text: string): string {
  // Match bold headers like **What to do next:** or **Warning Signs**
  const headerPattern = /\*\*([^*]+)\*\*[:\s]*/g;
  const seenHeaders = new Map<string, number>(); // normalized header -> first index
  const duplicateRanges: Array<[number, number]> = [];

  let match: RegExpExecArray | null;
  const allMatches: Array<{ normalized: string; start: number }> = [];

  while ((match = headerPattern.exec(text)) !== null) {
    const normalized = match[1].trim().toLowerCase().replace(/[:\s]+$/, "");
    allMatches.push({ normalized, start: match.index });
  }

  // Identify duplicate header positions
  for (let i = 0; i < allMatches.length; i++) {
    const { normalized, start } = allMatches[i];
    if (seenHeaders.has(normalized)) {
      // This is a duplicate — find the end of its section
      // Section ends at the next header or end of text
      const nextHeaderStart =
        i + 1 < allMatches.length ? allMatches[i + 1].start : text.length;
      duplicateRanges.push([start, nextHeaderStart]);
    } else {
      seenHeaders.set(normalized, start);
    }
  }

  // Remove duplicate sections in reverse order to preserve indices
  let result = text;
  for (let i = duplicateRanges.length - 1; i >= 0; i--) {
    const [start, end] = duplicateRanges[i];
    result = result.slice(0, start) + result.slice(end);
  }

  return result;
}

/**
 * Remove duplicate bullet points within the same section.
 * Normalizes whitespace before comparing.
 */
function removeDuplicateBullets(text: string): string {
  const lines = text.split("\n");
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Only deduplicate bullet lines
    if (/^[•\-\*]\s/.test(trimmed)) {
      const normalized = trimmed
        .replace(/^[•\-\*]\s+/, "")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .trim();
      if (seen.has(normalized)) {
        continue; // skip duplicate bullet
      }
      seen.add(normalized);
    }
    result.push(line);
  }

  return result.join("\n");
}

/**
 * Remove near-duplicate paragraphs (>80% word overlap).
 * A "paragraph" is a block of text separated by blank lines.
 */
function removeNearDuplicateParagraphs(text: string): string {
  const paragraphs = text.split(/\n\n+/);
  if (paragraphs.length <= 1) return text;

  const kept: string[] = [];
  const keptWordSets: Set<string>[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Skip short paragraphs (headers, single bullets) — don't deduplicate them here
    // as they're handled by the header and bullet deduplicators
    const words = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    if (words.length < 8) {
      kept.push(trimmed);
      keptWordSets.push(new Set(words));
      continue;
    }

    const wordSet = new Set(words);
    let isDuplicate = false;

    for (const existingSet of keptWordSets) {
      const overlap = [...wordSet].filter((w) => existingSet.has(w)).length;
      const overlapRatio = overlap / Math.min(wordSet.size, existingSet.size);
      if (overlapRatio > 0.8) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(trimmed);
      keptWordSets.push(wordSet);
    }
  }

  return kept.join("\n\n");
}
