/**
 * Stage B prompt: Synthesize the applicant's narrative assets.
 */

export const NARRATIVE_SYNTHESIZER_SYSTEM = `You are a fellowship application narrative analyst.
Extract and organize the applicant's strongest narrative assets — stories, facts, frameworks, and tensions.
Every numeric fact MUST include its source. Do not invent facts.

Respond with valid JSON only, matching the schema below exactly. No other text.`;

export function buildNarrativeSynthesizerPrompt(params: {
  applicantProfile: string;
  pastAnswers: string;
  dbSnippets: string;
  interpretation: {
    intellectualCore: string;
    keyThemes: string[];
  };
}): string {
  const parts: string[] = [];

  parts.push(`=== FELLOWSHIP CONTEXT ===
Intellectual Core: ${params.interpretation.intellectualCore}
Key Themes: ${params.interpretation.keyThemes.join(", ")}
=== END ===`);

  parts.push(`\n=== APPLICANT PROFILE ===
${params.applicantProfile}
=== END ===`);

  if (params.pastAnswers && params.pastAnswers !== "(No past answers available yet.)") {
    parts.push(`\n=== PAST ANSWERS ===
${params.pastAnswers}
=== END ===`);
  }

  if (params.dbSnippets) {
    parts.push(`\n=== ADDITIONAL SNIPPETS ===
${params.dbSnippets}
=== END ===`);
  }

  parts.push(`
Analyze the applicant's background through the lens of this fellowship's themes.
Extract narrative assets that are RELEVANT to the fellowship's intellectual core.

Respond with this exact JSON schema:
{
  "originMoment": "The formative scene/moment that explains why this person does this work",
  "intellectualJourney": "How their thinking evolved over time (2-3 sentences)",
  "leadershipExamples": [
    { "scene": "Specific moment with names/dates/places", "demonstrates": "What quality this shows" }
  ],
  "frameworksUsed": ["Framework or theory they engage with"],
  "tensionsNavigated": ["e.g. Cambridge vs Bihar, scale vs depth"],
  "uniqueAngle": "What makes this applicant's perspective unusual in their field",
  "numericFacts": [
    { "claim": "476 students across 3 centers", "source": "profile/KHEL program data" }
  ]
}`);

  return parts.join("\n");
}
