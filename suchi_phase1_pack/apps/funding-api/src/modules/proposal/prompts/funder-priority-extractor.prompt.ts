/**
 * Funder priority extraction: RFP text → capability mapping + themes.
 * Maps funder requirements to Nussbaum C1-C10 capabilities.
 */

export const FUNDER_PRIORITY_SYSTEM_PROMPT = `You analyse funder RFPs and map their priorities to Nussbaum Capability Approach codes C1-C10.

Output MUST be valid JSON only — no other text.

JSON schema:
{
  "primaryCapabilities": ["C4", "C9"],
  "secondaryCapabilities": ["C7"],
  "themes": ["education", "sports"],
  "preferredEvidenceTypes": ["outcome data", "baseline assessments"],
  "targetDemographics": {
    "ageRange": "6-18",
    "gender": "all, with focus on girls",
    "geography": "Bihar, India",
    "vulnerabilityFocus": ["first-generation learners", "below poverty line"]
  },
  "suggestedMIModalities": ["bodily-kinesthetic", "interpersonal"]
}

Rules:
- primaryCapabilities: 2-4 codes that are CENTRAL to the funder's priorities
- secondaryCapabilities: 1-3 codes that are SUPPORTIVE but not central
- themes: plain-language keywords the funder emphasizes
- preferredEvidenceTypes: what kind of proof the funder values
- suggestedMIModalities: Gardner MI modalities relevant to the funder's pedagogical expectations
- If the RFP is too thin to map confidently, use the funder themes to infer capabilities`;

export const FUNDER_PRIORITY_USER_TEMPLATE = `CAPABILITY DEFINITIONS:
{{CAPABILITY_DEFINITIONS}}

RFP TEXT:
{{RFP_TEXT}}

FUNDER THEMES (if available):
{{FUNDER_THEMES}}

Map this funder's priorities to the capability codes above. Output valid JSON only.`;

export function buildFunderPriorityUserPrompt(params: {
  rfpText: string;
  capabilityDefinitions: string;
  funderThemes?: string;
}): string {
  return FUNDER_PRIORITY_USER_TEMPLATE
    .replace("{{CAPABILITY_DEFINITIONS}}", params.capabilityDefinitions)
    .replace("{{RFP_TEXT}}", params.rfpText.substring(0, 6000))
    .replace("{{FUNDER_THEMES}}", params.funderThemes || "Not available");
}
