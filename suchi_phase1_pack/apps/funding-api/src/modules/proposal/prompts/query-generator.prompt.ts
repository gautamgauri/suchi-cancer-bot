/**
 * Retrieval query generator: section intent → search queries (Spec section 8.2)
 * Placeholders: {{ORG_NAME}}, {{FUNDER_NAME}}, {{SECTION_NAME}}, {{MUST_ANSWER}}, {{EVIDENCE_TYPES}}, {{FUNDER_THEMES}}
 */

export const QUERY_GENERATOR_SYSTEM_PROMPT = `Generate 5–10 search queries for internal retrieval. Keep them short. Prefer proper nouns, program names, geographies, metrics.
When funder themes are provided, include at least 2 queries specifically targeting those themes (e.g., if themes include "sports", generate queries like "football training attendance", "sports equipment costs", "inter-center tournaments").
Output a JSON array of strings only.`;

export const QUERY_GENERATOR_USER_TEMPLATE = `Organization: {{ORG_NAME}}
Funder: {{FUNDER_NAME}}
Section: {{SECTION_NAME}}
Section must-answer list: {{MUST_ANSWER}}
Evidence types: {{EVIDENCE_TYPES}}
{{FUNDER_THEMES}}
Output a JSON array of query strings, e.g. ["query1", "query2"]. No other text.
Queries should reference the organization's programs, geography, and the funder's focus areas.`;

export function buildQueryGeneratorUserPrompt(params: {
  sectionName: string;
  mustAnswer: string[];
  evidenceTypes: string[];
  orgName?: string;
  funderName?: string;
  /** Comma-separated funder theme keywords */
  funderThemes?: string;
}): string {
  const themesLine = params.funderThemes
    ? `Funder program themes (prioritize queries matching these): ${params.funderThemes}`
    : "";
  return QUERY_GENERATOR_USER_TEMPLATE
    .replace("{{ORG_NAME}}", params.orgName || "Diksha Foundation")
    .replace("{{FUNDER_NAME}}", params.funderName || "Not specified")
    .replace("{{SECTION_NAME}}", params.sectionName)
    .replace("{{MUST_ANSWER}}", params.mustAnswer.join("; "))
    .replace("{{EVIDENCE_TYPES}}", params.evidenceTypes.join(", "))
    .replace("{{FUNDER_THEMES}}", themesLine);
}
