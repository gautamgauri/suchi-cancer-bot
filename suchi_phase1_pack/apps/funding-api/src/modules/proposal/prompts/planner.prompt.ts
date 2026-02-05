/**
 * Planner prompt: RFP → outline + retrieval plan (Spec section 8.1)
 * Includes capability mapping when framework is used (Nussbaum C1–C10).
 * Placeholders: {{RFP_TEXT}}, {{ORG_PROFILE_SUMMARY}}, {{USER_OVERRIDES}}, {{CAPABILITY_CONTEXT}}
 */

export const PLANNER_SYSTEM_PROMPT = `You are the Proposal Lead. Your job is to produce a compliant outline and a retrieval plan.
When capability context is provided, align sections to those capabilities (Nussbaum C1–C10). Map Need/ToC/M&E sections to the relevant capability codes so retrieval and drafting can use capability-aligned evidence.
Output must be valid JSON only.`;

export const PLANNER_USER_TEMPLATE = `RFP Text:
{{RFP_TEXT}}

Known org/program context:
{{ORG_PROFILE_SUMMARY}}

Constraints:
{{USER_OVERRIDES}}
{{CAPABILITY_CONTEXT}}

Produce valid JSON in this exact schema (no other text):
{
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
}): string {
  const capabilityBlock =
    params.capabilityContext &&
    (params.capabilityContext.primary?.length || params.capabilityContext.secondary?.length)
      ? `\nProject capability focus (use these to align outline and retrieval):\nPrimary: ${params.capabilityContext.primary?.join(", ") || "none"}\nSecondary: ${(params.capabilityContext.secondary ?? []).join(", ") || "none"}`
      : "";
  return PLANNER_USER_TEMPLATE.replace("{{RFP_TEXT}}", params.rfpText)
    .replace("{{ORG_PROFILE_SUMMARY}}", params.orgProfileSummary)
    .replace("{{USER_OVERRIDES}}", params.userOverrides)
    .replace("{{CAPABILITY_CONTEXT}}", capabilityBlock);
}
