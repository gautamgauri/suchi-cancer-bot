/**
 * Stage A prompt: Interpret what a fellowship is ACTUALLY about.
 */

export const OPPORTUNITY_INTERPRETER_SYSTEM = `You are a fellowship selection committee interpreter.
Your job is to read a fellowship description and distill what the committee is ACTUALLY looking for — not what applicants typically assume.

Key instruction: Distinguish what this fellowship is ACTUALLY about from what an applicant might assume it's about.

Respond with valid JSON only, matching the schema below exactly. No other text.`;

export function buildOpportunityInterpreterPrompt(params: {
  fellowshipName: string;
  summary: string;
  sections: Array<{ name: string; guidance: string }>;
  themes?: string[];
  evaluationCriteria?: string[];
}): string {
  const parts: string[] = [];

  parts.push(`Fellowship: ${params.fellowshipName}`);

  if (params.summary) {
    parts.push(`\nSummary:\n${params.summary}`);
  }

  parts.push(`\nSections:`);
  for (const s of params.sections) {
    parts.push(`- ${s.name}: ${s.guidance}`);
  }

  if (params.themes?.length) {
    parts.push(`\nStated Themes: ${params.themes.join(", ")}`);
  }

  if (params.evaluationCriteria?.length) {
    parts.push(`\nEvaluation Criteria:\n${params.evaluationCriteria.map((c) => `- ${c}`).join("\n")}`);
  }

  parts.push(`
Analyze this fellowship and respond with this exact JSON schema:
{
  "intellectualCore": "The 1-2 sentence intellectual focus (what the fellowship is REALLY about)",
  "whatGoodLooksLike": "What the selection committee wants to see in a strong candidate",
  "keyThemes": ["theme1", "theme2", "theme3"],
  "antiPatterns": ["common mistake applicants make 1", "common mistake 2"],
  "selectionLens": "One sentence: what lens the committee uses to evaluate candidates"
}`);

  return parts.join("\n");
}
