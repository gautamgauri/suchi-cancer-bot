/**
 * Strip internal pipeline tags from DB-stored fellowship draft text.
 * The email version keeps UNVERIFIED tags as human review markers;
 * the DB version gets them cleaned.
 */
export function stripPipelineTags(text: string): string {
  let result = text;

  // [citation:...] tokens
  result = result.replace(/\s*\[citation:[^\]]*\]\s*/gi, " ");

  // {{MISSING:...}} → [TO COMPLETE]
  result = result.replace(/\{\{MISSING:\s*([^}]*)\}\}/gi, "[TO COMPLETE: $1]");

  // [UNVERIFIED_NUMERIC_CLAIM: source required] tags
  result = result.replace(/\s*\[UNVERIFIED_NUMERIC_CLAIM[^\]]*\]\s*/gi, " ");

  // Run IDs (UUID format)
  result = result.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "");

  // Opportunity IDs (eval-cat2-... format)
  result = result.replace(/\beval-cat\d+-[\w-]+\b/gi, "");

  // Clean up double spaces and leading/trailing whitespace on lines
  result = result.replace(/  +/g, " ");
  result = result.replace(/^ +/gm, "");
  result = result.replace(/ +$/gm, "");

  return result.trim();
}
