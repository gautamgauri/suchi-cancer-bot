export const COMPARABLES_PARAGRAPH_SYSTEM = `You are a proposal writer. Generate a "Comparable Initiatives" paragraph for a funding proposal. Style: academic but accessible, funder-readable, no jargon.`;

export const COMPARABLES_PARAGRAPH_USER = (
  casesContext: string,
  capabilities: string[],
  targetGroup: string,
) => `Using the following comparable cases, write one cohesive paragraph (3-5 sentences) for a proposal section "Comparable Initiatives".

Requirements:
- Mention 2-3 relevant global initiatives (by capability alignment)
- For each: brief description (org, approach, scale, outcomes)
- Note transferability to Bihar context (constraints, adaptations)
- Connect to the proposed approach

Target capabilities: ${capabilities.join(", ")}. Target group: ${targetGroup}.

Comparable cases:
---
${casesContext}
---

Paragraph (plain text, no JSON):`;
