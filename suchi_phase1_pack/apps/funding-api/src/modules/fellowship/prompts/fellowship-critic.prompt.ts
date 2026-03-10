/**
 * Stage E prompt: Critic review of completed fellowship draft.
 */

export const FELLOWSHIP_CRITIC_SYSTEM = `You are a fellowship application reviewer with experience on selection committees.
Score the complete application across 8 dimensions. Be specific in findings — cite the actual text that fails.

Respond with valid JSON only, matching the schema below exactly. No other text.`;

export function buildFellowshipCriticPrompt(params: {
  interpretation: {
    intellectualCore: string;
    keyThemes: string[];
    antiPatterns: string[];
  };
  bridge: {
    thesis: string;
  };
  sections: Array<{ name: string; text: string }>;
  verifiedFacts?: Array<{ claim: string; source: string }>;
}): string {
  const parts: string[] = [];

  parts.push(`=== FELLOWSHIP CONTEXT ===
Intellectual Core: ${params.interpretation.intellectualCore}
Key Themes: ${params.interpretation.keyThemes.join(", ")}
Anti-Patterns: ${params.interpretation.antiPatterns.join("; ")}
Strategic Thesis: ${params.bridge.thesis}
=== END ===`);

  if (params.verifiedFacts?.length) {
    parts.push(`\n=== VERIFIED NUMERIC FACTS ===
${params.verifiedFacts.map((f) => `- ${f.claim} (source: ${f.source})`).join("\n")}
=== END ===`);
  }

  parts.push(`\n=== DRAFTED SECTIONS ===`);
  for (const s of params.sections) {
    parts.push(`\n--- ${s.name} ---\n${s.text}\n--- END ${s.name} ---`);
  }

  parts.push(`
Score each dimension 0-10 and provide a specific finding. For scores < 7, suggest a fix.

DIMENSIONS:
1. Theme Alignment — Does each essay section engage with the fellowship's intellectual core?
2. Section Differentiation — Unique purpose per section? No repeated anecdotes?
3. Voice Authenticity — First-person, matches voice guide, no "we/our" leakage?
4. Specificity Density — At least 1 specific detail (name/date/place/number) per paragraph?
5. Numeric Integrity — Every number from verified facts list or has source?
6. Anti-Pattern Avoidance — No budget language, proposal framing, INR amounts, org-as-subject?
7. Intellectual Engagement — Shows independent thinking, not just credential listing?
8. Clean Output — No [citation:], {{MISSING:}}, [UNVERIFIED_NUMERIC_CLAIM], run IDs?

Respond with this exact JSON schema:
{
  "overallScore": 75,
  "dimensions": [
    { "dimension": "Theme Alignment", "score": 8, "finding": "Specific finding text", "fix": "Optional fix suggestion" }
  ],
  "crossSectionIssues": ["Issue that spans multiple sections"],
  "tagViolations": ["Any leaked tags found in output"]
}`);

  return parts.join("\n");
}
