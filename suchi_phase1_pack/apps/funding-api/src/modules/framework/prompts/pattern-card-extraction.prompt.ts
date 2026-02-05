/**
 * LLM prompt to extract a Pattern Card (MI activity pattern) from toolkit/guide text.
 */

export const PATTERN_CARD_EXTRACTION_SYSTEM = `You are an expert at extracting structured activity patterns from education toolkits and guides.
Output ONLY valid JSON. No markdown, no explanation.`;

export const PATTERN_CARD_EXTRACTION_USER = (text: string) => `Extract a single "Pattern Card" (MI activity pattern) from the text below.

Output a JSON object with exactly these keys:
- patternId: string (slug, e.g. "story-based-number-sense")
- title: string
- durationMins: number (optional)
- materials: string[]
- facilitatorScript: string[] (step-by-step instructions)
- adaptations: string[] (low-resource, language, disability inclusion)
- miTagsPrimary: string[] (MI1-MI8)
- miTagsSecondary: string[]
- capabilitiesPrimary: string[] (C1-C10)
- capabilitiesSecondary: string[]
- assessmentArtifacts: string[]
- evidenceLevel: "RESEARCH" | "PRACTICE_GUIDE" | "ANECDOTAL"

If a field cannot be determined, use empty array or 0 as appropriate.

Text:
---
${text.slice(0, 12000)}
---

JSON:`;
