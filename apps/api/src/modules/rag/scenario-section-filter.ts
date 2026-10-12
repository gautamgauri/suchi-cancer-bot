/**
 * Scenario applicability filter for retrieved evidence — issue #126.
 *
 * After #131/#132/#133/#143 a pregnancy question retrieves the right document
 * (NCI PDQ "Breast Cancer Treatment During Pregnancy"), but one of its chunks
 * (::35) holds `### Lactation` followed by `### Fetal Consequences of Maternal
 * Breast Cancer`. Generation was handed the whole chunk, so every pregnancy
 * answer carried "breastfeeding is stopped … breast milk … nursing baby" — an
 * actionable instruction for a population (nursing mothers) the asker is not in.
 *
 * The KB text is correct; only its applicability is wrong. So this filter works
 * on the evidence, not on the answer: for a question about PREGNANCY that does
 * not ask about breastfeeding, lactation sections are cut out of chunks before
 * composition, and chunks that are only about lactation are dropped. Nothing is
 * written or reworded — whole markdown sections are kept or removed, verbatim.
 * A genuine breastfeeding question (or one that asks about both) is untouched.
 *
 * Safe failure: less evidence. If nothing substantive is left the evidence gate
 * abstains rather than answering the wrong scenario.
 */

/** The user is asking about a pregnancy (English, Hinglish, Devanagari). */
const PREGNANCY_QUERY =
  /\bpregnan(?:t|cy|cies)\b|\bpregnent\b|\bin the womb\b|\bunborn\b|\bf(?:o)?etus\b|\bf(?:o)?etal\b|\btrimester\b|\bgarbh\w*|\bpet\s+se\s+(?:hai|hain|he|thi)\b|गर्भवती|गर्भावस्था|गर्भ|प्रेग्नेंट/i;

/** The user is (also) asking about breastfeeding / nursing / lactation. */
const NURSING_QUERY =
  /\bbreast[\s-]?feed\w*|\bnursing\b|\blactat\w*|\bbreast[\s-]?milk\b|\bfeed(?:ing)?\s+(?:my|the|her|a)\s+baby\b|\bdoodh\s+pila\w*|\bstanpaa?n\b|स्तनपान|दूध\s*पिला|माँ\s*का\s*दूध/i;

/** A section heading (or document title) about lactation. */
const LACTATION_HEADING = /lactation|breast[\s-]?feed\w*|\bnursing\b|breast[\s-]?milk|स्तनपान/i;

/** Body text that is about lactation … */
const LACTATION_TEXT = /lactation|breast[\s-]?milk|breast[\s-]?feed\w*|nursing\s+(?:baby|infant|mother)|\bnursing\b|स्तनपान/i;
/** … unless it is also about the pregnancy itself. */
const PREGNANCY_TEXT = /pregnan|f(?:o)?etus|f(?:o)?etal|trimester|unborn|in utero|womb|गर्भ/i;

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
/** Below this many non-heading characters a chunk carries no evidence. */
const MIN_SUBSTANTIVE_CHARS = 40;

export function asksAboutPregnancyNotNursing(userText: string): boolean {
  if (!userText) return false;
  return PREGNANCY_QUERY.test(userText) && !NURSING_QUERY.test(userText);
}

/**
 * Remove every markdown section whose heading is about lactation — from the
 * heading to the next heading of the same or a higher level — plus any
 * headingless lead-in text that is about lactation and not about the pregnancy
 * (a chunk that starts mid-way through a lactation section).
 * Returns the content unchanged (same string) when nothing is removed.
 */
export function stripLactationSections(content: string): { content: string; removedSections: string[] } {
  if (!content) return { content, removedSections: [] };

  const lines = content.split("\n");
  const removedSections: string[] = [];
  const kept: string[] = [];

  // Lead-in: lines before the first heading.
  const firstHeading = lines.findIndex((l) => HEADING.test(l));
  const leadEnd = firstHeading < 0 ? lines.length : firstHeading;
  const lead = lines.slice(0, leadEnd).join("\n");
  let start = 0;
  if (lead.trim() && LACTATION_TEXT.test(lead) && !PREGNANCY_TEXT.test(lead)) {
    removedSections.push("(lead-in)");
    start = leadEnd;
  }

  let skipLevel: number | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      if (skipLevel !== null && level <= skipLevel) {
        skipLevel = null;
      }
      if (skipLevel === null && LACTATION_HEADING.test(h[2])) {
        skipLevel = level;
        removedSections.push(h[2].trim());
        continue;
      }
    }
    if (skipLevel === null) kept.push(line);
  }

  if (removedSections.length === 0) return { content, removedSections };
  return { content: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", removedSections };
}

function substantiveLength(content: string): number {
  return content
    .split("\n")
    .filter((l) => !HEADING.test(l))
    .join("")
    .replace(/\s+/g, "").length;
}

/**
 * Apply the pregnancy-scenario filter to a list of evidence chunks. Order is
 * preserved and the input objects are not mutated.
 */
export function scopeEvidenceToPregnancyScenario<
  T extends { chunkId: string; content: string; document?: { title?: string | null } | null }
>(chunks: T[], userText: string): { chunks: T[]; trimmedChunkIds: string[]; droppedChunkIds: string[] } {
  if (!chunks || chunks.length === 0 || !asksAboutPregnancyNotNursing(userText)) {
    return { chunks, trimmedChunkIds: [], droppedChunkIds: [] };
  }

  const out: T[] = [];
  const trimmedChunkIds: string[] = [];
  const droppedChunkIds: string[] = [];

  for (const chunk of chunks) {
    const title = chunk.document?.title ?? "";
    if (title && LACTATION_HEADING.test(title) && !PREGNANCY_TEXT.test(title)) {
      droppedChunkIds.push(chunk.chunkId);
      continue;
    }
    const { content, removedSections } = stripLactationSections(chunk.content);
    if (removedSections.length === 0) {
      out.push(chunk);
      continue;
    }
    if (substantiveLength(content) < MIN_SUBSTANTIVE_CHARS) {
      droppedChunkIds.push(chunk.chunkId);
      continue;
    }
    trimmedChunkIds.push(chunk.chunkId);
    out.push({ ...chunk, content });
  }

  return { chunks: out, trimmedChunkIds, droppedChunkIds };
}
