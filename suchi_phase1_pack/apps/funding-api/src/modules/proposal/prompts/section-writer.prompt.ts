/**
 * Section writer: evidence-grounded drafting (Spec section 8.3)
 * Placeholders: {{SECTION_NAME}}, {{SECTION_GUIDANCE}}, chunks as [S1] ... [S2] ...
 */

export const SECTION_WRITER_SYSTEM_PROMPT = `Draft the section using ONLY the provided evidence chunks.
Every numeric/statistical claim must include an inline marker like [S1], [S2] referencing a chunk.
If evidence is insufficient, write a minimal acceptable draft with placeholders like {{MISSING: ...}} and list gaps at the end.
Output format: Markdown with headings.
Do not invent facts or numbers.`;

export const SECTION_WRITER_USER_TEMPLATE = `Section: {{SECTION_NAME}}
Outline guidance: {{SECTION_GUIDANCE}}

Evidence chunks:
{{CHUNKS_LIST}}

Style: human, funder-facing, no fluff, India context.`;

export function buildSectionWriterUserPrompt(params: {
  sectionName: string;
  sectionGuidance: string;
  chunksList: string;
}): string {
  return SECTION_WRITER_USER_TEMPLATE.replace("{{SECTION_NAME}}", params.sectionName)
    .replace("{{SECTION_GUIDANCE}}", params.sectionGuidance)
    .replace("{{CHUNKS_LIST}}", params.chunksList);
}
