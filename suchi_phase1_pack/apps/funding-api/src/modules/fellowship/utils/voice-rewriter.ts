/**
 * Deterministic post-processor: mechanically rewrite org voice → first-person singular.
 * Light safety net — only fixes pronouns and "The organization" references.
 * First mention of "Diksha Foundation" gets natural framing; subsequent mentions left as-is.
 */
export function rewriteToFirstPerson(text: string): string {
  let result = text;

  // First occurrence of "Diksha Foundation" → "my organization, Diksha Foundation"
  // Subsequent occurrences left as-is (natural)
  let firstMention = true;
  result = result.replace(/\bDiksha Foundation\b/g, (match) => {
    if (firstMention) {
      firstMention = false;
      return "my organization, Diksha Foundation";
    }
    return match;
  });

  // Clean up double commas from replacement
  result = result.replace(/,\s*,/g, ",");

  // "Our" → "My" (start of sentence)
  result = result.replace(/\bOur\b/g, "My");
  // "our" → "my" (mid-sentence)
  result = result.replace(/\bour\b/g, "my");
  // "We" → "I" (start of sentence)
  result = result.replace(/\bWe\b/g, "I");
  // "we" → "I" (mid-sentence)
  result = result.replace(/\bwe\b/g, "I");

  // Fix grammar after pronoun swap
  result = result.replace(/\bI has\b/g, "I have");
  result = result.replace(/\bI are\b/g, "I am");
  result = result.replace(/\bI operates\b/g, "I operate");
  result = result.replace(/\bI serves\b/g, "I serve");
  result = result.replace(/\bI proposes\b/g, "I propose");
  result = result.replace(/\bI ensures\b/g, "I ensure");
  result = result.replace(/\bI delivers\b/g, "I deliver");
  result = result.replace(/\bI provides\b/g, "I provide");
  result = result.replace(/\bI aims\b/g, "I aim");
  result = result.replace(/\bI seeks\b/g, "I seek");
  result = result.replace(/\bI maintains\b/g, "I maintain");
  result = result.replace(/\bI offers\b/g, "I offer");

  // "The organization" → "I"
  result = result.replace(/\bThe organization\b/g, "I");
  result = result.replace(/\bthe organization\b/g, "I");

  // Strip leaked snippet tags: [ai_story_200w], [my_work_200w], [bio_100w], etc.
  result = result.replace(/\s*\[(?:ai_story|my_work|why_me|why_this_program|bio|cambridge)_?\w*\]\s*/gi, " ");

  // Strip [PROFILE: ...] references
  result = result.replace(/\s*\[PROFILE:\s*[^\]]*\]\s*/gi, " ");

  // Strip [citation:...] UUID tokens (internal tracking, not for submission)
  result = result.replace(/\s*\[citation:[^\]]*\]\s*/gi, " ");

  // Clean up double spaces left by tag removal
  result = result.replace(/  +/g, " ");

  return result;
}
