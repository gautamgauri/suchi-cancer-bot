/**
 * Section writer: evidence-grounded drafting (Spec section 8.3)
 * Citations use [citation:docId:chunkId] format for traceability.
 */

export const SECTION_WRITER_SYSTEM_PROMPT = `Draft the section using ONLY the provided evidence chunks.

CITATION RULES (CRITICAL):
- Every numeric claim, impact statement, or statistic MUST include its citation token immediately after.
- Copy the citation EXACTLY as provided (e.g., [citation:proposal_001:chunk_3]).
- Do NOT invent or modify citation tokens.
- If evidence is insufficient, use {{MISSING: description}} placeholders.

Output format: Markdown with headings.
Do not invent facts or numbers.`;

export const SECTION_WRITER_USER_TEMPLATE = `Section: {{SECTION_NAME}}
Outline guidance: {{SECTION_GUIDANCE}}

Evidence chunks (use citation token EXACTLY as shown):
{{CHUNKS_LIST}}

Style: human, funder-facing, no fluff, India context. Include citation tokens inline.`;

export function buildSectionWriterUserPrompt(params: {
  sectionName: string;
  sectionGuidance: string;
  chunksList: string;
}): string {
  return SECTION_WRITER_USER_TEMPLATE.replace("{{SECTION_NAME}}", params.sectionName)
    .replace("{{SECTION_GUIDANCE}}", params.sectionGuidance)
    .replace("{{CHUNKS_LIST}}", params.chunksList);
}
