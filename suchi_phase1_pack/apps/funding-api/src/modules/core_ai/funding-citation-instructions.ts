export interface FundingCitationInstructionsInput {
  referenceList: string;
  checklist?: string;
  sanitizedUserMessage: string;
}

/**
 * Build the user-message content for "draft" mode with 6 sections and exact [citation:docId:chunkId] format.
 * Parser-compatible; for missing facts require TODO: instead of guessing.
 */
export function buildFundingCitationInstructions(input: FundingCitationInstructionsInput): string {
  const { referenceList, checklist = "", sanitizedUserMessage } = input;

  return `
You are a funding draft assistant. Answer the user's request using ONLY the reference material below. Generate a complete response with all 6 required sections.

REFERENCE LIST:
${referenceList}

${checklist}

USER REQUEST: ${sanitizedUserMessage}

---

GENERATE A RESPONSE WITH ALL 6 SECTIONS BELOW:

**Section 1: Direct Draft Output**
Write the main draft content (3–5 bullet points or short paragraphs) directly addressing the request. Each factual claim must have a citation.

**Section 2: Funder Fit & Requirements**
Summarize how the draft aligns with funder requirements. Extract from references only. Use [citation:docId:chunkId] for every requirement or criterion mentioned.

**Section 3: Evidence-Backed Need Statement**
State the need/evidence using ONLY the reference material. Every claim must be cited: [citation:docId:chunkId].

**Section 4: Proposed Approach / ToC**
Outline the proposed approach or table of contents based on references. Cite each element that comes from the references.

**Section 5: M&E (practical)**
List practical monitoring and evaluation points from the references. Cite each: [citation:docId:chunkId].

**Section 6: Evidence Gaps & Next Inputs (TODO checklist)**
List what is missing or uncertain. Use TODO: for each gap or next input needed. Do NOT guess or fabricate—only state gaps and required next inputs.

---

CITATION FORMAT (CRITICAL - your response will be rejected without proper citations):
- Use EXACTLY: [citation:docId:chunkId]
- Copy docId and chunkId EXACTLY from the reference list above
- EVERY factual claim from references needs a citation
- Minimum 2 citations required; aim for 5+

For missing facts or unsupported claims: use TODO: instead of guessing.
`;
}
