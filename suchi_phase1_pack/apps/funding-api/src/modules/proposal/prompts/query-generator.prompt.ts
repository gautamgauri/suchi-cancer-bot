/**
 * Retrieval query generator: section intent → search queries (Spec section 8.2)
 * Placeholders: {{ORG_NAME}}, {{FUNDER_NAME}}, {{SECTION_NAME}}, {{MUST_ANSWER}}, {{EVIDENCE_TYPES}}, {{FUNDER_THEMES}}
 */

export const QUERY_GENERATOR_SYSTEM_PROMPT = `Generate 5–10 search queries for internal retrieval. Keep them short. Prefer proper nouns, program names, geographies, metrics.
When funder themes are provided, include at least 2 queries specifically targeting those themes (e.g., if themes include "sports", generate queries like "football training attendance", "sports equipment costs", "inter-center tournaments").
When evidence needs are provided, include at least 1 query per evidence need to find the right document type.
Output a JSON array of strings only.`;

export const QUERY_GENERATOR_USER_TEMPLATE = `Organization: {{ORG_NAME}}
Funder: {{FUNDER_NAME}}
Section: {{SECTION_NAME}}
Section must-answer list: {{MUST_ANSWER}}
Evidence types: {{EVIDENCE_TYPES}}
{{FUNDER_THEMES}}{{EVIDENCE_NEEDS}}
Output a JSON array of query strings, e.g. ["query1", "query2"]. No other text.
Queries should reference the organization's programs, geography, and the funder's focus areas.`;

/**
 * Deterministic Citations Needed Map:
 * Maps section types to the specific evidence documents/artifacts that should be cited.
 * This ensures the query generator produces targeted queries to find citable sources.
 */
export const CITATIONS_NEEDED_MAP: Record<string, string[]> = {
  objectives: [
    "attendance tracking methodology (daily register, monthly consolidation sheet)",
    "learning assessment tools (ASER-style grade-level tests, rubrics)",
    "digital literacy practical assessment rubric",
    "sports participation tracking log",
    "SEL observation checklist or assessment tool",
    "teacher training curriculum and hours",
  ],
  results: [
    "attendance data from fortnightly reports",
    "enrollment records and retention data",
    "assessment results (literacy, numeracy, digital skills)",
    "sports coaching session logs",
    "SEL session records and behavioral observations",
    "community event attendance records",
  ],
  monitoring: [
    "M&E framework or data collection protocol",
    "assessment tools and rubrics used",
    "reporting templates (fortnightly, monthly, quarterly)",
    "data quality assurance procedures",
    "baseline assessment methodology",
  ],
  budget: [
    "staff salary structure and stipend rates",
    "program material costs (kits, equipment, devices)",
    "infrastructure costs (rent, utilities, internet)",
    "training costs from prior programs",
    "M&E and administrative cost history",
  ],
  beneficiaries: [
    "enrollment data by center",
    "demographic breakdown (age, gender)",
    "selection criteria documentation",
    "vulnerability assessment criteria",
    "geographic coverage data",
  ],
  activities: [
    "weekly schedule and activity timetable",
    "curriculum and methodology documents",
    "digital platform usage data",
    "sports program structure",
    "community engagement event records",
  ],
  need: [
    "Bihar education statistics (enrollment, dropout, learning levels)",
    "district-level education data",
    "NEP 2020 and state education policy references",
    "baseline needs assessment data",
  ],
  team: [
    "staff list with qualifications",
    "organizational structure",
    "Fellow Teacher program description",
    "training and capacity building plan",
  ],
  experience: [
    "program outcome reports",
    "prior evaluation reports",
    "achievement metrics from fortnightly reports",
    "partnership and collaboration records",
  ],
};

function getCitationNeeds(sectionName: string): string[] {
  const lower = sectionName.toLowerCase();
  for (const [key, needs] of Object.entries(CITATIONS_NEEDED_MAP)) {
    if (lower.includes(key)) return needs;
  }
  if (lower.includes("communicat")) return CITATIONS_NEEDED_MAP.activities;
  if (lower.includes("sustainab")) return CITATIONS_NEEDED_MAP.experience;
  return [];
}

/** Fellowship-specific template: personal queries instead of org queries */
const QUERY_GENERATOR_FELLOWSHIP_TEMPLATE = `Applicant: {{ORG_NAME}}
Funder/Fellowship: {{FUNDER_NAME}}
Section: {{SECTION_NAME}}
Section must-answer list: {{MUST_ANSWER}}
Evidence types: {{EVIDENCE_TYPES}}
{{FUNDER_THEMES}}{{EVIDENCE_NEEDS}}
Output a JSON array of query strings, e.g. ["query1", "query2"]. No other text.
Queries should reference the APPLICANT'S personal story, education, career journey, founding experience, and vision — NOT "the organization's programs". Use the applicant's name and personal perspective.`;

/** Fellowship citation needs map — personal/career focused */
const FELLOWSHIP_CITATIONS_NEEDED_MAP: Record<string, string[]> = {
  engagement: [
    "applicant's connection to the fellowship program or institution",
    "how the fellowship aligns with personal learning goals",
    "specific questions or research agenda for the fellowship",
  ],
  career: [
    "career milestones and progression",
    "founding story and motivation",
    "leadership growth from individual contributor to systems thinker",
    "pivots, failures, or honest challenges faced",
  ],
  expertise: [
    "academic background and research frameworks",
    "specific methodologies used (Capabilities Approach, sport-for-development)",
    "published work or conference presentations",
  ],
  focus: [
    "AI tools built and their impact metrics",
    "technology stack and design decisions",
    "user feedback or pilot results",
  ],
};

function getFellowshipCitationNeeds(sectionName: string): string[] {
  const lower = sectionName.toLowerCase();
  for (const [key, needs] of Object.entries(FELLOWSHIP_CITATIONS_NEEDED_MAP)) {
    if (lower.includes(key)) return needs;
  }
  if (lower.includes("narrative") || lower.includes("story") || lower.includes("journey")) return FELLOWSHIP_CITATIONS_NEEDED_MAP.career;
  if (lower.includes("research") || lower.includes("learning")) return FELLOWSHIP_CITATIONS_NEEDED_MAP.expertise;
  return [];
}

export function buildQueryGeneratorUserPrompt(params: {
  sectionName: string;
  mustAnswer: string[];
  evidenceTypes: string[];
  orgName?: string;
  funderName?: string;
  /** Comma-separated funder theme keywords */
  funderThemes?: string;
  /** When fellowship/tech_accelerator, uses personal query template */
  docTypeCategory?: string;
}): string {
  const isFellowshipTrack = params.docTypeCategory === "fellowship" || params.docTypeCategory === "tech_accelerator";
  const themesLine = params.funderThemes
    ? `Funder program themes (prioritize queries matching these): ${params.funderThemes}`
    : "";

  let citationNeeds: string[];
  let template: string;
  if (isFellowshipTrack) {
    citationNeeds = getFellowshipCitationNeeds(params.sectionName);
    template = QUERY_GENERATOR_FELLOWSHIP_TEMPLATE;
  } else {
    citationNeeds = getCitationNeeds(params.sectionName);
    template = QUERY_GENERATOR_USER_TEMPLATE;
  }

  const needsLine = citationNeeds.length > 0
    ? `\nEvidence needed for citations (generate at least 1 query per item):\n${citationNeeds.map(n => `- ${n}`).join("\n")}`
    : "";
  return template
    .replace("{{ORG_NAME}}", params.orgName || "Diksha Foundation")
    .replace("{{FUNDER_NAME}}", params.funderName || "Not specified")
    .replace("{{SECTION_NAME}}", params.sectionName)
    .replace("{{MUST_ANSWER}}", params.mustAnswer.join("; "))
    .replace("{{EVIDENCE_TYPES}}", params.evidenceTypes.join(", "))
    .replace("{{FUNDER_THEMES}}", themesLine)
    .replace("{{EVIDENCE_NEEDS}}", needsLine);
}
