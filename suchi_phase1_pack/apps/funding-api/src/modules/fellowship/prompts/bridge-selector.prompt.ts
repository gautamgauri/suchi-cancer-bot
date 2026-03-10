/**
 * Stage C prompt: Find the strongest bridge between applicant and fellowship.
 */

export const BRIDGE_SELECTOR_SYSTEM = `You are a fellowship application strategist.
Given what a fellowship values and what an applicant has done, find the single strongest thesis that connects them.
The thesis must be specific and non-generic — it should only work for THIS applicant applying to THIS fellowship.

Respond with valid JSON only, matching the schema below exactly. No other text.`;

export function buildBridgeSelectorPrompt(params: {
  interpretation: {
    intellectualCore: string;
    whatGoodLooksLike: string;
    keyThemes: string[];
    selectionLens: string;
  };
  applicantProfile: string;
  pastAnswers: string;
  sectionNames: string[];
}): string {
  const parts: string[] = [];

  parts.push(`=== FELLOWSHIP INTERPRETATION ===
Intellectual Core: ${params.interpretation.intellectualCore}
What Good Looks Like: ${params.interpretation.whatGoodLooksLike}
Key Themes: ${params.interpretation.keyThemes.join(", ")}
Selection Lens: ${params.interpretation.selectionLens}
=== END ===`);

  parts.push(`\n=== APPLICANT PROFILE ===
${params.applicantProfile}
=== END ===`);

  if (params.pastAnswers && params.pastAnswers !== "(No past answers available yet.)") {
    parts.push(`\n=== PAST ANSWERS (shows voice and experience) ===
${params.pastAnswers}
=== END ===`);
  }

  parts.push(`\nSections to write: ${params.sectionNames.join(", ")}`);

  parts.push(`
Find the single strongest connection between this applicant and this fellowship.
Assign a unique angle to each section listed above.

Respond with this exact JSON schema:
{
  "thesis": "One sentence: the core argument for why THIS person belongs in THIS fellowship",
  "bridgeType": "e.g. practitioner-to-field, scholar-to-practice, cross-sector",
  "applicantBringsToFellowship": "What unique perspective/experience the applicant contributes",
  "fellowshipBringsToApplicant": "What the fellowship unlocks for the applicant",
  "keyNarrativeThreads": ["thread1", "thread2"],
  "sectionAnchors": {
    "${params.sectionNames[0] || "Section 1"}": "specific angle for this section",
    "...one entry per section..."
  }
}`);

  return parts.join("\n");
}
