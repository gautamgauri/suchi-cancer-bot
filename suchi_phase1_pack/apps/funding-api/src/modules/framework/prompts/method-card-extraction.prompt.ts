/**
 * LLM prompt to extract a Method Card (Visible Thinking routine) from raw text.
 * Output must be valid JSON matching MethodCardExtraction schema.
 */

export const METHOD_CARD_EXTRACTION_SYSTEM = `You are an expert at extracting structured data about educational routines and thinking strategies from web pages and documents.
Output ONLY valid JSON. No markdown, no explanation.`;

export const METHOD_CARD_EXTRACTION_USER = (text: string) => `Extract a single "Method Card" (Visible Thinking / Project Zero style routine) from the text below.

Output a JSON object with exactly these keys:
- methodId: string (slug, e.g. "see-think-wonder")
- title: string
- intent: string (what thinking/learning it develops)
- steps: string[] (ordered procedure steps)
- whenToUse: string
- whenNotToUse: string
- ageBand: string (e.g. "6-10", "11-14", "15-18", "adult", "all")
- settingTags: string[] (e.g. ["school", "community", "after-school"])
- miTagsPrimary: string[] (MI codes: MI1-MI8)
- miTagsSecondary: string[]
- capabilityLinks: string[] (capability codes: C1-C10, optional)
- assessmentArtifacts: string[]
- licenseFlag: "OK_INTERNAL" | "NEEDS_REVIEW" | "UNKNOWN"

If a field cannot be determined from the text, use empty array or empty string as appropriate. For licenseFlag use "NEEDS_REVIEW" unless the source explicitly allows internal use.

Text:
---
${text.slice(0, 12000)}
---

JSON:`;
