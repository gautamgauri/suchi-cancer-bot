/**
 * Reference-list chunk filter (issue #129).
 *
 * Every NCI PDQ document ends each section with a `###### References` block:
 * numbered entries of author, title, journal, year and a `[[PUBMED Abstract]](url)`
 * link. The ingest chunker treats those blocks like any other text, so the index
 * holds thousands of chunks that are link lists with no answerable prose. Their
 * paper titles embed very close to the questions they are about — for the
 * pregnancy question in #126 the two top-ranked chunks (vecSim 0.75 / 0.73) were
 * reference blocks and the chunk that actually answered ranked 5th.
 *
 * This module decides, conservatively, whether a chunk is REFERENCE-DOMINANT and
 * therefore useless as evidence. It is applied at retrieval time, right where SQL
 * rows become evidence chunks, so it needs no re-ingest. The ingest-time fix
 * (strip `References` sections before chunking) is tracked with the #86 re-index.
 *
 * "Conservative" means: a chunk is only dropped when it is *dominated* by citation
 * markup. Prose that merely carries inline `[[6](#cit/section_3.6)]` markers, or a
 * paragraph that ends with one or two PubMed links, is kept. The regression spec
 * pins this against the real pregnancy PDQ text.
 */

/** A `[[PUBMED Abstract]](http://…)` link — the one unambiguous marker of a PDQ reference entry. */
// The link target carries a quoted title AFTER a space — `(url "url")` — so match to the closing paren.
const PUBMED_LINK = /\[\[PUBMED Abstract\]\]\([^)]*\)/g;

/** Any markdown link, including PDQ's inline citation markers `[[6](#cit/section_3.6)]`. */
const MARKDOWN_LINK = /\[[^\]]*\]\((?:https?:\/\/|#)[^)]*\)/g;

/** Bare URLs (quoted titles in PDQ links repeat the URL: `(url "url")`). */
const BARE_URL = /https?:\/\/[^\s)"']+/g;

/**
 * A URL fragment with no scheme — what a chunk that starts or ends INSIDE a link
 * contains (`bi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=…`,
 * `cancer-facts-and-figures/2025/….pdf`). Without this, the fragment counts as
 * prose and a mid-block chunk slips through. Prose never contains such tokens.
 */
const URL_FRAGMENT = /\S*(?:nih\.gov|\.fcgi\?|list_uids=|dopt=Abstract|\.(?:gov|org|com|edu|net)\/|\.pdf\b)\S*/g;

/** A PDQ `References` heading at any level. */
const REFERENCES_HEADING = /^#{1,6}\s*References\s*$/m;

/**
 * A numbered reference entry: `12. Surname AB, Other CD: Title. Journal 70 (5): 1151-63, 1990.`
 * Requires the author-colon or a 4-digit year so ordinary numbered lists
 * ("1. Eat a light meal") do not count.
 */
const NUMBERED_REFERENCE_ENTRY = /^\s*\d{1,3}\.\s+[^\n]*?(?:[A-Z][a-z]+(?: [A-Z]{1,3})?,\s+[A-Z][a-z]+|\b(?:19|20)\d{2}\b)[^\n]*$/gm;

export interface ReferenceDominance {
  /** Characters in the chunk. */
  total: number;
  /** Characters left after removing links and URLs. */
  proseChars: number;
  /** proseChars / total, 1 when the chunk has no links. */
  proseRatio: number;
  pubmedLinks: number;
  numberedReferenceEntries: number;
  hasReferencesHeading: boolean;
  /** The verdict. */
  referenceDominant: boolean;
  /** Which rule fired, for logs and tests. */
  rule: "pubmed-density" | "references-block" | "mid-block-entries" | null;
}

export function analyzeReferenceDominance(content: string): ReferenceDominance {
  const text = content ?? "";
  const total = text.length;
  const pubmedLinks = (text.match(PUBMED_LINK) ?? []).length;
  const hasReferencesHeading = REFERENCES_HEADING.test(text);
  const numberedReferenceEntries = (text.match(NUMBERED_REFERENCE_ENTRY) ?? []).length;

  const stripped = text.replace(PUBMED_LINK, " ").replace(MARKDOWN_LINK, " ").replace(BARE_URL, " ").replace(URL_FRAGMENT, " ");
  const proseChars = stripped.replace(/\s+/g, " ").trim().length;
  const proseRatio = total === 0 ? 1 : proseChars / total;

  let rule: ReferenceDominance["rule"] = null;
  if (pubmedLinks >= 2 && proseRatio < 0.6) {
    // Two or more complete PubMed links and well under two thirds of the chunk is
    // prose (author/title/journal text of the entries themselves): the shape of
    // every PDQ reference block, including one cut mid-entry. Real prose chunks
    // that merely end with a couple of references sit above 0.7.
    rule = "pubmed-density";
  } else if (hasReferencesHeading && numberedReferenceEntries >= 2 && proseRatio < 0.7) {
    // A `References` heading followed by numbered entries whose links were truncated
    // by the chunk boundary (so pubmedLinks under-counts).
    rule = "references-block";
  } else if (numberedReferenceEntries >= 3 && pubmedLinks >= 1 && proseRatio < 0.6) {
    // Starts midway through a block (often inside a truncated `PUBMED Abstract]](…)`
    // marker, so complete links under-count): several numbered entries, at least
    // one PubMed link, and still mostly markup.
    rule = "mid-block-entries";
  }

  return {
    total,
    proseChars,
    proseRatio,
    pubmedLinks,
    numberedReferenceEntries,
    hasReferencesHeading,
    referenceDominant: rule !== null,
    rule,
  };
}

export function isReferenceDominantChunk(content: string): boolean {
  return analyzeReferenceDominance(content).referenceDominant;
}

export interface ReferenceFilterResult<T> {
  kept: T[];
  dropped: T[];
}

/**
 * Partition chunks into evidence and reference-dominant noise, preserving order.
 * Generic over the chunk shape so every retrieval path can use it before ranking.
 */
export function dropReferenceChunks<T extends { content: string }>(chunks: T[]): ReferenceFilterResult<T> {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const chunk of chunks) {
    (isReferenceDominantChunk(chunk.content) ? dropped : kept).push(chunk);
  }
  return { kept, dropped };
}
