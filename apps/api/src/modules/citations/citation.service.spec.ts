/**
 * Tests for CitationService.
 *
 * FR-CHAT-012: Citation repair fires when LLM cites <2 sources and RAG chunks
 * are available — the chat service replaces the LLM response with a safe fallback
 * when validateCitations returns RED, and proceeds with YELLOW for borderline cases.
 *
 * These tests verify the threshold ladder used by the chat service:
 *   0 citations (no established-fact bypass)  → RED  (isValid: false — abstain)
 *   1 citation / low density                  → YELLOW (isValid: true — answer with caution)
 *   2+ citations, good density                → GREEN  (isValid: true — full confidence)
 *   orphan (hallucinated) citations           → RED  (isValid: false — safety block)
 */

import { CitationService } from "./citation.service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

function makeChunk(docId: string, chunkId: string): EvidenceChunk {
  return {
    chunkId,
    docId,
    content: `Content for ${docId}/${chunkId}`,
    document: {
      title: `Doc ${docId}`,
      sourceType: "02_nci_core",
      source: "NCI",
      citation: null,
      isTrustedSource: true,
    },
    similarity: 0.8,
  };
}

describe("CitationService — extractCitations", () => {
  let service: CitationService;

  beforeEach(() => {
    service = new CitationService();
  });

  test("extracts valid citation markers", () => {
    const response = "Cancer screening is important [citation:doc1:chunk1] for early detection [citation:doc2:chunk2].";
    const chunks = [makeChunk("doc1", "chunk1"), makeChunk("doc2", "chunk2")];

    const result = service.extractCitations(response, chunks);

    expect(result.citations).toHaveLength(2);
    expect(result.orphanCount).toBe(0);
    expect(result.citations[0].docId).toBe("doc1");
    expect(result.citations[1].docId).toBe("doc2");
  });

  test("orphan citations (hallucinated) are flagged — not included as valid", () => {
    const response = "Some claim [citation:fake_doc:fake_chunk] here.";
    const chunks = [makeChunk("doc1", "chunk1")]; // does not include fake_doc

    const result = service.extractCitations(response, chunks);

    expect(result.citations).toHaveLength(0);
    expect(result.orphanCount).toBe(1);
    expect(result.orphanCitations).toContain("[citation:fake_doc:fake_chunk]");
  });

  test("response with no citation markers returns empty array", () => {
    const result = service.extractCitations("No citations in this response.", [makeChunk("doc1", "chunk1")]);
    expect(result.citations).toHaveLength(0);
    expect(result.orphanCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateCitations — threshold ladder (FR-CHAT-012)
// ---------------------------------------------------------------------------

describe("CitationService — validateCitations threshold ladder (FR-CHAT-012)", () => {
  let service: CitationService;
  const chunks = [makeChunk("doc1", "chunk1"), makeChunk("doc2", "chunk2"), makeChunk("doc3", "chunk3")];

  beforeEach(() => {
    service = new CitationService();
  });

  function makeCitation(docId: string, chunkId: string, position = 0) {
    return { docId, chunkId, position, citationText: `[citation:${docId}:${chunkId}]` };
  }

  test("2+ citations with good density → GREEN / isValid", () => {
    // Short response with 2 citations → high density
    const responseText = "Cancer screening [citation:doc1:chunk1] starts early [citation:doc2:chunk2].";
    const citations = [makeCitation("doc1", "chunk1", 20), makeCitation("doc2", "chunk2", 50)];

    const result = service.validateCitations(citations, chunks, responseText);

    expect(result.confidenceLevel).toBe("GREEN");
    expect(result.isValid).toBe(true);
  });

  test("1 citation → YELLOW / still valid (answer with caution)", () => {
    const citations = [makeCitation("doc1", "chunk1")];
    const responseText = "Some cancer information. [citation:doc1:chunk1] More details here. End.";

    const result = service.validateCitations(citations, chunks, responseText);

    expect(result.confidenceLevel).toBe("YELLOW");
    expect(result.isValid).toBe(true); // YELLOW = proceed, not block
  });

  test("0 citations (non-identify query) → RED / not valid — chat service must abstain", () => {
    const result = service.validateCitations([], chunks, "Some response with no citations at all.");

    expect(result.confidenceLevel).toBe("RED");
    expect(result.isValid).toBe(false);
  });

  test("orphan citations → RED regardless of count", () => {
    const citations = [makeCitation("doc1", "chunk1"), makeCitation("doc2", "chunk2")];
    // orphanCount=2 means the LLM hallucinated 2 extra references
    const result = service.validateCitations(citations, chunks, "Some response.", false, 2);

    expect(result.confidenceLevel).toBe("RED");
    expect(result.isValid).toBe(false);
  });

  test("identify question with 0 citations → YELLOW (special bypass)", () => {
    const result = service.validateCitations(
      [],
      chunks,
      "How to identify lymphoma.",
      true, // isIdentifyQuestionWithGeneralIntent
      0
    );

    expect(result.confidenceLevel).toBe("YELLOW");
    expect(result.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeCitationMarkers / stripForVoice integration check
// ---------------------------------------------------------------------------

describe("CitationService — removeCitationMarkers", () => {
  let service: CitationService;

  beforeEach(() => {
    service = new CitationService();
  });

  test("removes [citation:...] markers from text", () => {
    const text = "Chemotherapy [citation:doc1:chunk1] works by [citation:doc2:chunk2] targeting cells.";
    const stripped = service.removeCitationMarkers(text);

    expect(stripped).not.toContain("[citation:");
    expect(stripped).toContain("Chemotherapy");
    expect(stripped).toContain("works by");
    expect(stripped).toContain("targeting cells.");
  });
});
