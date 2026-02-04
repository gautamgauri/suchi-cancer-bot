/**
 * Reviewer / QA prompt: coverage + hallucination guard (Spec section 8.4)
 * Placeholders: {{REQUIREMENTS_JSON}}, {{DRAFT_TEXT}}, {{CITATION_MAP}}
 */

export const QA_REVIEWER_SYSTEM_PROMPT = `You are the QA reviewer. Find: (1) requirement gaps, (2) ungrounded claims, (3) internal inconsistencies, (4) tone issues.
Output must be valid JSON only.`;

export const QA_REVIEWER_USER_TEMPLATE = `RFP requirements: {{REQUIREMENTS_JSON}}

Draft sections: {{DRAFT_TEXT}}

Evidence map (citations): {{CITATION_MAP}}

Produce valid JSON in this exact schema (no other text):
{
  "coverage_score": number (0.0 to 1.0),
  "missing_requirements": ["string"],
  "ungrounded_claims": [{"text": "string", "location": "string", "suggestion": "string"}],
  "inconsistencies": [{"type": "string", "detail": "string"}],
  "revision_plan": [{"section": "string", "action": "string", "needed_evidence": ["string"]}]
}`;

export function buildQaReviewerUserPrompt(params: {
  requirementsJson: string;
  draftText: string;
  citationMap: string;
}): string {
  return QA_REVIEWER_USER_TEMPLATE.replace("{{REQUIREMENTS_JSON}}", params.requirementsJson)
    .replace("{{DRAFT_TEXT}}", params.draftText)
    .replace("{{CITATION_MAP}}", params.citationMap);
}
