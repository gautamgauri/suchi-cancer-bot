/**
 * Stage D prompt: Plan each section's content to prevent repetition and ensure coherence.
 */

export const SECTION_PLANNER_SYSTEM = `You are a fellowship application architect.
Given the strategic thesis, narrative assets, and section archetypes, plan each section so that:
1. Each section has a UNIQUE thesis and assigned stories (no story appears in two sections)
2. Each section has specific retrieval queries to find relevant evidence
3. Word budgets are assigned based on section importance

Respond with valid JSON only, matching the schema below exactly. No other text.`;

export function buildSectionPlannerPrompt(params: {
  bridge: {
    thesis: string;
    sectionAnchors: Record<string, string>;
  };
  narrative: {
    originMoment: string;
    leadershipExamples: Array<{ scene: string; demonstrates: string }>;
    numericFacts: Array<{ claim: string; source: string }>;
    tensionsNavigated: string[];
  };
  interpretation: {
    intellectualCore: string;
    keyThemes: string[];
    antiPatterns: string[];
  };
  sections: Array<{
    name: string;
    guidance: string;
    wordLimit?: number;
    archetype?: { owns: string; avoids: string };
  }>;
}): string {
  const parts: string[] = [];

  parts.push(`=== STRATEGIC THESIS ===
${params.bridge.thesis}
=== END ===`);

  parts.push(`\n=== FELLOWSHIP THEMES ===
Core: ${params.interpretation.intellectualCore}
Themes: ${params.interpretation.keyThemes.join(", ")}
Anti-patterns to avoid: ${params.interpretation.antiPatterns.join("; ")}
=== END ===`);

  parts.push(`\n=== NARRATIVE ASSETS AVAILABLE ===
Origin moment: ${params.narrative.originMoment}
Leadership examples:`);
  for (const ex of params.narrative.leadershipExamples) {
    parts.push(`  - "${ex.scene}" → demonstrates: ${ex.demonstrates}`);
  }
  parts.push(`Tensions: ${params.narrative.tensionsNavigated.join(", ")}`);
  parts.push(`Numeric facts:`);
  for (const f of params.narrative.numericFacts) {
    parts.push(`  - ${f.claim} (source: ${f.source})`);
  }

  parts.push(`\n=== SECTIONS TO PLAN ===`);
  for (const s of params.sections) {
    const anchor = params.bridge.sectionAnchors[s.name] || "no specific angle assigned";
    parts.push(`\nSection: ${s.name}
  Guidance: ${s.guidance}
  Word limit: ${s.wordLimit ?? 400}
  Assigned angle: ${anchor}
  ${s.archetype ? `Archetype owns: ${s.archetype.owns}\n  Archetype avoids: ${s.archetype.avoids}` : ""}`);
  }

  parts.push(`
Allocate narrative assets to sections. Each leadership example should appear in AT MOST one section.
Generate 2-3 retrieval queries per section that are angle-informed (not generic).

Respond with this exact JSON schema:
{
  "sections": [
    {
      "name": "Section Name",
      "thesis": "What THIS section argues (one sentence)",
      "assignedStories": ["label of leadership example to use here"],
      "assignedFacts": ["specific numeric fact to cite here"],
      "retrievalHints": ["angle-informed retrieval query 1", "query 2"],
      "openingMove": "Suggested opening approach (e.g. 'Open with the Bihar classroom scene')",
      "mustAvoidFrom": ["Section names whose content must not be repeated here"],
      "wordBudget": 400
    }
  ]
}`);

  return parts.join("\n");
}
