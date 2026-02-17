/**
 * Planner prompt: RFP → outline + retrieval plan (Spec section 8.1)
 * Includes capability mapping when framework is used (Nussbaum C1–C10).
 * Placeholders: {{RFP_TEXT}}, {{ORG_PROFILE_SUMMARY}}, {{USER_OVERRIDES}}, {{CAPABILITY_CONTEXT}}, {{FUNDER_THEMES}}, {{ACTIVITIES_CONTEXT}}
 */

export const PLANNER_SYSTEM_PROMPT = `You are the Proposal Planner. Output MUST be valid JSON only.

You MUST produce TWO required objects:
1) proposal_scope (REQUIRED — MUST be fully populated)
2) outline (REQUIRED)

PROPOSAL SCOPE RULES (CRITICAL — DO NOT SKIP):
- proposal_scope MUST be fully populated using the Activity Registry context and RFP.
- If a value exists in the Activity Registry, you MUST use it verbatim. Do NOT paraphrase or round numbers.
- If a value is not available from any source, set the field to null and add an entry to missing_inputs.
- If you output empty strings ("") or empty arrays ([]) for fields that ARE available in the registry, it is a FAILURE.
- programName MUST NOT be empty if the org profile or registry names a program.
- centers MUST NOT be empty if the registry lists centers/sites.
- deliverables MUST NOT be empty if the registry lists activities with frequencies.

MANDATORY SECTIONS: When provided by the RFP, include every one in your outline with exact titles. Do not rename or merge.
CAPABILITY ALIGNMENT: When capability context is provided, align sections to Nussbaum C1–C10.
FUNDER THEMES: The outline MUST address each primary funder theme. Map the organization's strongest programs to those themes.
BUDGET CEILING: proposal_scope.budgetCeiling MUST match the constraint exactly. All line items must fit within it.
ACTIVITIES REGISTRY: Use it to ground the outline in specific, costed activities — prefer real program data (frequencies, unit costs, outcomes, indicators) over generic descriptions. Extract hours/week, sessions/week, device ratios, cohort sizes, and staff counts into deliverables.
FRAMEWORK INTELLIGENCE: When a Framework Context block is provided, use it to:
- Set capability_focus on each outline section using the funder's priority capabilities
- Reference proven program models in section guidance (e.g., "describe how Football3 methodology is adapted")
- Include Theory of Change elements in the Project Design section guidance
- Use comparable programs to strengthen the Need Statement guidance
- Align M&E section guidance with MEL pack indicators
- Populate suggested_primary_capabilities and suggested_secondary_capabilities from the funder analysis`;

export const PLANNER_USER_TEMPLATE = `RFP Text:
{{RFP_TEXT}}
{{MANDATORY_SECTIONS}}
Funder: {{FUNDER_NAME}}
{{FUNDER_THEMES}}
Known org/program context:
{{ORG_PROFILE_SUMMARY}}
{{ACTIVITIES_CONTEXT}}
{{FRAMEWORK_CONTEXT}}
Constraints:
{{USER_OVERRIDES}}
{{CAPABILITY_CONTEXT}}

Produce valid JSON in this exact schema (no other text):
{
  "proposal_scope": {
    "programName": "string — REQUIRED, the single program being proposed (from registry or org profile)",
    "grantPeriod": {"start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null"},
    "centers": [{"name": "string", "location": "string or null", "targetGroup": "string or null"}],
    "totalDirectBeneficiaries": "string — single canonical count from registry",
    "totalIndirectBeneficiaries": "string or null",
    "geographicScope": "string — districts/states",
    "budgetCeiling": "string — MUST match the budget ceiling from constraints if provided",
    "deliverables": [{"name": "string — activity name", "quantity": "number or null", "unit": "string or null (e.g. sessions, hours)", "frequency": "string or null (e.g. 3x/week)"}],
    "staffing": {"totalStaff": "number or null", "keyRoles": ["string"]},
    "assumptions": ["string — key planning assumptions"],
    "constraints": ["string — known constraints or limitations"],
    "missing_inputs": [{"field": "string — which field is missing", "reason": "string", "severity": "low|medium|high"}]
  },
  "outline": [
    { "section": "string", "target_words": number, "must_answer": ["string"], "capability_focus": ["C1"] }
  ],
  "retrieval_plan": [
    {
      "section": "string",
      "query_intents": ["string"],
      "required_evidence_types": ["string"],
      "capability_focus": ["string"]
    }
  ],
  "compliance_checklist": [
    { "item": "string", "source": "RFP", "status": "pending" }
  ],
  "suggested_primary_capabilities": ["string"],
  "suggested_secondary_capabilities": ["string"]
}
Rules:
- proposal_scope.programName MUST NOT be empty. proposal_scope.centers MUST NOT be empty if registry lists centers. proposal_scope.deliverables MUST NOT be empty if registry lists activities.
- If the registry provides hours/week, sessions/week, device ratios, cohort sizes — put them in deliverables.
- Use capability codes C1–C10 only (C1=Life, C2=Bodily Health, C3=Bodily Integrity, C4=Senses/Thought, C5=Emotions, C6=Practical Reason, C7=Affiliation, C8=Other Species, C9=Play, C10=Control over Environment).
- Include capability_focus in outline and retrieval_plan where applicable.
- suggested_* arrays may be empty if not applicable.`;

export function buildPlannerUserPrompt(params: {
  rfpText: string;
  orgProfileSummary: string;
  userOverrides: string;
  /** Optional: primary and secondary capability codes (e.g. ["C4","C6"]) so outline aligns to framework */
  capabilityContext?: { primary: string[]; secondary?: string[] };
  /** Mandatory sections from the opportunity's extractedRequirements */
  mandatorySections?: Array<{ title: string; description?: string }>;
  /** Funder name for context */
  funderName?: string;
  /** Funder program themes extracted from RFP */
  funderThemes?: { primary?: string[]; secondary?: string[] };
  /** Structured activities context from ProgramActivity registry */
  activitiesContext?: string;
  /** Pre-computed framework intelligence context (methods, ToC, comparables, MEL) */
  frameworkContext?: string;
}): string {
  const capabilityBlock =
    params.capabilityContext &&
    (params.capabilityContext.primary?.length || params.capabilityContext.secondary?.length)
      ? `\nProject capability focus (use these to align outline and retrieval):\nPrimary: ${params.capabilityContext.primary?.join(", ") || "none"}\nSecondary: ${(params.capabilityContext.secondary ?? []).join(", ") || "none"}`
      : "";
  const mandatorySectionsBlock =
    params.mandatorySections?.length
      ? `\nMANDATORY SECTIONS (you MUST include ALL of these in your outline with exact titles):\n${params.mandatorySections.map((s, i) => `${i + 1}. "${s.title}"${s.description ? ` — ${s.description}` : ""}`).join("\n")}`
      : "";
  const funderThemesBlock =
    params.funderThemes && (params.funderThemes.primary?.length || params.funderThemes.secondary?.length)
      ? `\nFUNDER PROGRAM THEMES (your proposal MUST address these — align activities, budget, and narrative to these themes):\nPrimary themes: ${params.funderThemes.primary?.join(", ") || "none"}\nSecondary themes: ${params.funderThemes.secondary?.join(", ") || "none"}`
      : "";
  const activitiesBlock =
    params.activitiesContext
      ? `\nSTRUCTURED ACTIVITIES REGISTRY (use these real program activities with their costs, frequencies, and outcomes):\n${params.activitiesContext}`
      : "";
  const frameworkBlock =
    params.frameworkContext
      ? `\n${params.frameworkContext}`
      : "";
  return PLANNER_USER_TEMPLATE.replace("{{RFP_TEXT}}", params.rfpText)
    .replace("{{FUNDER_NAME}}", params.funderName || "Not specified")
    .replace("{{ORG_PROFILE_SUMMARY}}", params.orgProfileSummary)
    .replace("{{USER_OVERRIDES}}", params.userOverrides)
    .replace("{{CAPABILITY_CONTEXT}}", capabilityBlock)
    .replace("{{MANDATORY_SECTIONS}}", mandatorySectionsBlock)
    .replace("{{FUNDER_THEMES}}", funderThemesBlock)
    .replace("{{ACTIVITIES_CONTEXT}}", activitiesBlock)
    .replace("{{FRAMEWORK_CONTEXT}}", frameworkBlock);
}
