export const CONSISTENCY_CHECK_SYSTEM = `You are a proposal quality reviewer. Analyze the draft against claimed capabilities and MI modalities. Output ONLY valid JSON.`;

export const CONSISTENCY_CHECK_USER = (
  draftText: string,
  claimedCapabilities: string[],
  claimedMI: string[],
) => `Analyze this draft and check for:

1. MISSING_MECHANISM: Capability claimed but no clear intervention mechanism described
2. WEAK_INDICATOR: Indicators don't actually measure the capability
3. CAPABILITY_MISMATCH: Draft content doesn't support claimed capabilities
4. EQUITY_GAP: For C3 (Bodily Integrity) and C7 (Affiliation), check for gender/caste/disability considerations
5. MI_PEDAGOGY_GAP: MI modality claimed but activities don't use that modality
6. ACADEMIC_TONE: Language too theoretical; should be practical and funder-readable
7. MISSING_EVIDENCE: Factual claims without citations

Claimed capabilities: ${claimedCapabilities.join(", ")}
Claimed MI modalities: ${claimedMI.join(", ")}

Draft:
---
${draftText.slice(0, 8000)}
---

Output JSON:
{ "overallScore": number 1-5, "flags": [ { "severity": "error"|"warning"|"info", "type": "missing_mechanism"|"weak_indicator"|"capability_mismatch"|"equity_gap"|"mi_pedagogy_gap"|"academic_tone"|"missing_evidence", "capability?: string", "section?: string", "message": string, "suggestion?: string" } ], "suggestions": string[], "passesQualityGate": boolean }

passesQualityGate = true only if overallScore >= 3 AND no "error" severity flags.

JSON:`;
