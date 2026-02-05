export const MEL_PACK_SYSTEM = `You are a MEL (Monitoring, Evaluation & Learning) specialist. Generate a structured MEL pack for a capability-based project. Output ONLY valid JSON.`;

export interface MelPackOutput {
  capabilityIndicators: Array<{
    capability: string;
    capabilityName: string;
    mechanism: string;
    expectedFunctionings: string[];
    indicators: Array<{
      type: "quantitative" | "qualitative";
      indicator: string;
      frequency: string;
      disaggregation: string[];
      tool: string;
      risks: string[];
    }>;
  }>;
  gaps: string[];
}

export const MEL_PACK_USER = (
  capabilities: string[],
  targetGroup: string,
  geography: string,
  context: string,
) => `Generate a MEL pack for a project targeting these capabilities: ${capabilities.join(", ")}.
Target group: ${targetGroup}. Geography/context: ${geography}.

${context ? `Additional context:\n${context}\n` : ""}

For each capability, provide:
1. mechanism: how the intervention expands this capability
2. expectedFunctionings: observable behaviors or states (2-4 items)
3. indicators: array of { type, indicator, frequency (e.g. baseline/midline/endline), disaggregation (e.g. gender, caste, disability), tool (e.g. survey, FGD), risks }
Use disaggregation appropriate for Bihar/India context. Keep tools feasible for low-resource settings.

Output JSON with keys: capabilityIndicators (array), gaps (array of missing inputs or unclear areas).
Use capability codes (e.g. C4, C7) in the capability field. capabilityName should be the short name (e.g. "Senses, Imagination, Thought").

JSON:`;
