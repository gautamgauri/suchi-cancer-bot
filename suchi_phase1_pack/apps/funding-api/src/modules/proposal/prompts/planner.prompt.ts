/**
 * Planner prompt: RFP → outline + retrieval plan (Spec section 8.1)
 * Includes capability mapping when framework is used (Nussbaum C1–C10).
 * Placeholders: {{RFP_TEXT}}, {{ORG_PROFILE_SUMMARY}}, {{USER_OVERRIDES}}, {{CAPABILITY_CONTEXT}}, {{FUNDER_THEMES}}, {{ACTIVITIES_CONTEXT}}
 */

export const PLANNER_SYSTEM_PROMPT = `You are the Proposal Lead. Your job is to produce a compliant outline and a retrieval plan.
When MANDATORY SECTIONS are provided by the RFP, you MUST include every one of them in your outline. Do not rename or merge mandatory sections — use the exact titles given. You may add supplementary sections if appropriate.
When capability context is provided, align sections to those capabilities (Nussbaum C1–C10). Map Need/ToC/M&E sections to the relevant capability codes so retrieval and drafting can use capability-aligned evidence.
When funder program themes are provided, the outline MUST demonstrate alignment — at least one section should directly address each primary theme. Map the organization's strongest programs and activities to those themes. For example, if the funder themes include "sports", emphasize the organization's sports programming (football, volleyball, tournaments) as a core vehicle for holistic education.
When a budget ceiling is provided in constraints, the proposal_scope.budgetCeiling MUST reflect it exactly, and all budget line items in the outline must be designed to fit within that ceiling. Do NOT plan a budget that exceeds the ceiling.
When a structured activities registry is provided, use it to ground your outline in specific, costed activities — prefer referencing real program data (frequencies, unit costs, outcomes, indicators) over generic descriptions.
Output must be valid JSON only.`;

export const PLANNER_USER_TEMPLATE = `RFP Text:
{{RFP_TEXT}}
{{MANDATORY_SECTIONS}}
Funder: {{FUNDER_NAME}}
{{FUNDER_THEMES}}
Known org/program context:
{{ORG_PROFILE_SUMMARY}}
{{ACTIVITIES_CONTEXT}}
Constraints:
{{USER_OVERRIDES}}
{{CAPABILITY_CONTEXT}}

Produce valid JSON in this exact schema (no other text):
{
  "proposal_scope": {
    "programName": "string — the single program being proposed",
    "centers": ["list of center/site names"],
    "totalDirectBeneficiaries": "string — single canonical count",
    "totalIndirectBeneficiaries": "string — optional",
    "geographicScope": "string — districts/states",
    "grantPeriod": "string — start to end",
    "budgetCeiling": "string — MUST match the budget ceiling from constraints if provided",
    "keyDeliverables": ["list of 4-6 core deliverables"]
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
Rules: Use capability codes C1–C10 only (e.g. C1=Life, C2=Bodily Health, C3=Bodily Integrity, C4=Senses/Thought, C5=Emotions, C6=Practical Reason, C7=Affiliation, C8=Other Species, C9=Play, C10=Control over Environment). Include capability_focus in outline and retrieval_plan items where the section clearly addresses a capability. If capability context was provided, use it for suggested_primary/secondary; otherwise infer from RFP and org context. suggested_* arrays may be empty if not applicable.`;

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
  return PLANNER_USER_TEMPLATE.replace("{{RFP_TEXT}}", params.rfpText)
    .replace("{{FUNDER_NAME}}", params.funderName || "Not specified")
    .replace("{{ORG_PROFILE_SUMMARY}}", params.orgProfileSummary)
    .replace("{{USER_OVERRIDES}}", params.userOverrides)
    .replace("{{CAPABILITY_CONTEXT}}", capabilityBlock)
    .replace("{{MANDATORY_SECTIONS}}", mandatorySectionsBlock)
    .replace("{{FUNDER_THEMES}}", funderThemesBlock)
    .replace("{{ACTIVITIES_CONTEXT}}", activitiesBlock);
}
