/**
 * LLM prompt to extract a Comparable Case from program/case study text.
 */

export const COMPARABLE_CASE_EXTRACTION_SYSTEM = `You are an expert at extracting structured case study data from program reports and documentation.
Output ONLY valid JSON. No markdown, no explanation.`;

export const COMPARABLE_CASE_EXTRACTION_USER = (text: string) => `Extract a single "Comparable Case" (global program/case study) from the text below.

Output a JSON object with exactly these keys:
- caseId: string (slug, e.g. "pratham-read-india")
- programName: string
- orgName: string
- geography: string (country/region)
- targetGroup: "children" | "youth" | "women" | "mixed"
- deliveryModelTags: string[] (e.g. "peer groups", "mentorship", "school-based")
- outcomesSummary: string
- indicatorsUsed: string[]
- costNotes: string | null
- programConstraints: string (what didn't work or limitations)
- contextConstraints: string (context-specific barriers)
- transferabilityBihar: string (how to adapt for Bihar context)
- confidenceScore: number 1-5 (how confident the extraction is)

If a field cannot be determined, use empty array, empty string, or null. For transferabilityBihar infer from geography and context if not stated.

Text:
---
${text.slice(0, 12000)}
---

JSON:`;
