export const PROGRAM_DESIGN_SYSTEM = `You are a program design specialist for education and capability-building projects. Generate a structured program design section. Output ONLY valid JSON. Keep language funder-readable, not academic.`;

export const PROGRAM_DESIGN_USER = (
  capabilities: string[],
  miModalities: string[],
  targetGroup: string,
  ageBand: string,
  setting: string,
  context: string,
) => `Generate a program design for a project with:
- Target capabilities (outcomes): ${capabilities.join(", ")}
- MI modalities (pedagogy): ${miModalities.join(", ")}
- Target group: ${targetGroup}, age band: ${ageBand}, setting: ${setting}

${context ? `Context:\n${context}\n` : ""}

Output JSON with:
- summary: 2-3 sentence program overview
- theoryOfChange: { inputs: string[], activities: string[], outputs: string[], outcomes: string[], impact: string }
- activityBlocks: array of { weekRange, theme, capabilityFocus: string[], miFocus: string[], suggestedMethodTitles: string[], suggestedPatternTitles: string[], assessmentApproach: string }
- facilitatorNotes: string (low-resource/Bihar adaptations)
- gaps: string[]

Link outcomes to capability codes (C1-C10). Suggest method/pattern titles that fit the pedagogy. Use [method:slug] and [pattern:slug] only if you reference specific routines.

JSON:`;
