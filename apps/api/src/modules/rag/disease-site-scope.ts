/**
 * Disease-site scope for retrieved evidence — issue #170.
 *
 * "A reply must not silently substitute a different disease site than the one
 * asked about." When the user's CURRENT message names a cancer site (in English,
 * Hindi or Hinglish), evidence from documents about a different site may not
 * answer it: a mouth-cancer question must not be answered from the lung-cancer
 * prevention PDQ.
 *
 * The filter is deliberately one-directional and conservative:
 *  - it only acts when the message itself names a site (a session tag is not
 *    enough — it can be stale, which is how #170 happened);
 *  - it never acts when the message looks beyond the named site ("other cancers
 *    besides lung cancer", "फेफड़ों के कैंसर के अलावा");
 *  - a chunk is dropped only when its document title names a site and none of
 *    those sites is in the asked site's family; site-agnostic documents
 *    ("Tobacco and Cancer", "Persistent Mouth Ulcer: When to Worry") are kept.
 *
 * The safe failure is fewer — possibly zero — chunks. Zero chunks make the
 * evidence gate abstain, which is what we want instead of an answer about the
 * wrong organ. No text is written here; chunks are only kept or dropped.
 */

import { detectExplicitCancerTypes } from "../chat/utils/cancer-type-detector";

/**
 * Sites that are one clinical family for the purpose of this check: the oral
 * cavity PDQ is titled "Oral Cavity, Oropharynx, Hypopharynx, & Larynx Cancer"
 * and tagged `head and neck` in the manifest, so an oral question must keep it.
 */
const SITE_FAMILIES: string[][] = [["oral", "head and neck", "laryngeal", "oropharyngeal"]];

/** Every site in the same family as `site` (including itself). */
export function siteFamilyMembers(site: string): string[] {
  const family = SITE_FAMILIES.find((f) => f.includes(site));
  return family ? [...family] : [site];
}

function familyKey(site: string): string {
  return siteFamilyMembers(site)[0];
}

/**
 * The message asks about other sites than the one it names ("other cancers",
 * "besides lung cancer", "which cancers", "अलावा", "दूसरे/अन्य कैंसर").
 * "Other than chemo, how is oral cancer treated?" is NOT beyond the site: the
 * qualifier has to sit right before the cancer wording.
 */
const BEYOND_NAMED_SITE = new RegExp(
  [
    String.raw`\b(?:other|besides|apart from|aside from|except|other than|beyond)\s+(?:[a-z]+\s+){0,3}cancers?\b`,
    String.raw`\b(?:which|what|how many)\s+(?:other\s+)?(?:types?\s+of\s+|kinds?\s+of\s+)?cancers\b`,
    String.raw`\b(?:types?|kinds?)\s+of\s+cancers?\b`,
    String.raw`अलावा`,
    String.raw`(?:दूसरे|अन्य)\s*(?:कैंसर|कैन्सर)`,
    String.raw`\b(?:dusre|doosre)\s+cancer`,
    String.raw`\baur\s+kaun\s+se\s+cancer`,
    String.raw`\b(?:alawa|alaava|ilawa)\b`,
  ].join("|"),
  "i"
);

export function looksBeyondNamedSite(text: string): boolean {
  return BEYOND_NAMED_SITE.test(text);
}

/**
 * The cancer sites the user's message itself asks about — empty when it names
 * none, or when it explicitly asks beyond the site it names.
 */
export function askedDiseaseSites(userText: string): string[] {
  if (!userText) return [];
  const sites = detectExplicitCancerTypes(userText);
  if (sites.length === 0) return [];
  if (looksBeyondNamedSite(userText)) return [];
  return sites;
}

/** The cancer sites a chunk's source document is about, read from its title. */
export function chunkDiseaseSites(chunk: { document?: { title?: string | null } | null }): string[] {
  const title = chunk?.document?.title;
  if (!title) return [];
  return detectExplicitCancerTypes(title);
}

/**
 * Keep chunks that are about an asked site (or its family) or about no
 * particular site; drop chunks whose document is about a different site.
 * Order is preserved. With no asked site, everything is kept.
 */
export function scopeChunksToAskedSites<T extends { document?: { title?: string | null } | null }>(
  chunks: T[],
  askedSites: string[]
): { kept: T[]; dropped: T[] } {
  if (!askedSites || askedSites.length === 0) {
    return { kept: chunks, dropped: [] };
  }
  const asked = new Set(askedSites.map(familyKey));
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const chunk of chunks) {
    const sites = chunkDiseaseSites(chunk);
    if (sites.length === 0 || sites.some((s) => asked.has(familyKey(s)))) {
      kept.push(chunk);
    } else {
      dropped.push(chunk);
    }
  }
  return { kept, dropped };
}
