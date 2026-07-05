/**
 * Unit tests for the citation integrity verifier (issue #48).
 * Pure functions — no live API calls.
 */

import {
  verifyCitationIntegrity,
  isEvidenceRequired,
  resolveCitation,
  EMPTY_APPROVED_SOURCES,
  CITATION_ISSUE_CODES,
} from "./citation-verifier";

const retrieved = (docIds: string[]) =>
  docIds.map((docId, i) => ({
    docId,
    chunkId: `chunk-${i}`,
    sourceType: "02_nci_core",
    isTrustedSource: true,
    similarity: 0.9 - i * 0.05,
  }));

const cite = (docId: string, chunkId: string, position = 100) => ({
  docId,
  chunkId,
  position,
});

describe("isEvidenceRequired", () => {
  it("requires evidence for medical intents", () => {
    expect(isEvidenceRequired("INFORMATIONAL_GENERAL")).toBe(true);
    expect(isEvidenceRequired("SYMPTOMATIC_PATIENT")).toBe(true);
    expect(isEvidenceRequired("RED_FLAG_URGENT")).toBe(true);
  });

  it("does not require evidence for non-medical intents by default", () => {
    expect(isEvidenceRequired("OUT_OF_SCOPE")).toBe(false);
    expect(isEvidenceRequired("EMOTIONAL_SUPPORT")).toBe(false);
  });

  it("respects explicit expectations", () => {
    expect(isEvidenceRequired("OUT_OF_SCOPE", { requires_citations: true })).toBe(true);
    expect(isEvidenceRequired("OUT_OF_SCOPE", { min_citations: 2 })).toBe(true);
  });
});

describe("resolveCitation", () => {
  const chunks = retrieved(["kb_doc_a", "kb_doc_b"]);

  it("resolves exact chunk matches to retrieved", () => {
    expect(resolveCitation({ docId: "kb_doc_a", chunkId: "chunk-0" }, chunks, EMPTY_APPROVED_SOURCES)).toBe("retrieved");
  });

  it("resolves same-doc different-chunk to retrieved (doc-level backing)", () => {
    expect(resolveCitation({ docId: "kb_doc_a", chunkId: "other-chunk" }, chunks, EMPTY_APPROVED_SOURCES)).toBe("retrieved");
  });

  it("resolves approved docIds and prefixes", () => {
    const approved = { approvedDocIds: ["kb_nav_hospitals"], approvedDocIdPrefixes: ["kb_local_"] };
    expect(resolveCitation({ docId: "kb_nav_hospitals", chunkId: "x" }, chunks, approved)).toBe("approved");
    expect(resolveCitation({ docId: "kb_local_patna", chunkId: "x" }, chunks, approved)).toBe("approved");
  });

  it("flags everything else as unresolved", () => {
    expect(resolveCitation({ docId: "kb_made_up", chunkId: "x" }, chunks, EMPTY_APPROVED_SOURCES)).toBe("unresolved");
  });
});

describe("verifyCitationIntegrity", () => {
  it("passes a healthy grounded response", () => {
    const result = verifyCitationIntegrity({
      intent: "INFORMATIONAL_GENERAL",
      expectations: { min_citations: 2 },
      responseText:
        "Breast cancer symptoms include a lump [citation:kb_doc_a] and skin changes [citation:kb_doc_b]. This is not a diagnosis.",
      citations: [cite("kb_doc_a", "chunk-0", 40), cite("kb_doc_b", "chunk-1", 80)],
      retrievedChunks: retrieved(["kb_doc_a", "kb_doc_b"]),
      citationConfidence: "GREEN",
    });

    expect(result.applicable).toBe(true);
    expect(result.evidenceRequired).toBe(true);
    expect(result.supportingCitationCount).toBe(2);
    expect(result.unresolvedCitationCount).toBe(0);
    expect(result.score).toBe(1);
    expect(result.issues).toHaveLength(0);
    expect(result.clusters).toHaveLength(0);
  });

  it("flags fabricated citations that resolve to nothing (CIT-1/CIT-2)", () => {
    const result = verifyCitationIntegrity({
      intent: "INFORMATIONAL_GENERAL",
      responseText: "Some claim [citation:kb_fabricated].",
      citations: [cite("kb_fabricated", "no-such-chunk")],
      retrievedChunks: retrieved(["kb_doc_a"]),
      citationConfidence: "GREEN",
    });

    expect(result.unresolvedCitationCount).toBe(1);
    expect(result.clusters).toContain("citation-fabricated");
    expect(result.rules.find((r) => r.ruleId === "CIT-1")?.passed).toBe(false);
    expect(result.rules.find((r) => r.ruleId === "CIT-2")?.passed).toBe(false);
    expect(
      result.issues.some((i) => i.code === CITATION_ISSUE_CODES.CITATION_UNRESOLVED)
    ).toBe(true);
    expect(result.score).toBeLessThan(1);
  });

  it("accepts citations from the explicitly approved source list", () => {
    const result = verifyCitationIntegrity({
      intent: "INFORMATIONAL_GENERAL",
      responseText: "Navigation info [citation:kb_nav_hospitals].",
      citations: [cite("kb_nav_hospitals", "h1")],
      retrievedChunks: retrieved(["kb_doc_a"]),
      citationConfidence: "GREEN",
      approvedSources: { approvedDocIds: ["kb_nav_hospitals"], approvedDocIdPrefixes: [] },
    });

    expect(result.unresolvedCitationCount).toBe(0);
    expect(result.resolvedCitations[0].resolution).toBe("approved");
    expect(result.clusters).not.toContain("citation-fabricated");
  });

  it("fails evidence-required cases with retrieval but zero citations (P0 2026-03-26 signature)", () => {
    // RQ-STOMACH-01: 6 chunks retrieved, 0 citations, abstained
    const result = verifyCitationIntegrity({
      intent: "INFORMATIONAL_GENERAL",
      expectations: { min_citations: 2 },
      responseText: "Stomach cancer symptoms include...",
      citations: [],
      retrievedChunks: retrieved(["a", "b", "c", "d", "e", "f"]),
      citationConfidence: "RED",
      abstentionReason: "citation_validation_failed",
    });

    expect(result.rules.find((r) => r.ruleId === "CIT-3")?.passed).toBe(false);
    expect(result.clusters).toContain("citation-missing");
    expect(result.clusters).toContain("citation-confidence");
    expect(
      result.issues.some(
        (i) => i.code === CITATION_ISSUE_CODES.ZERO_CITATIONS_WITH_RETRIEVAL
      )
    ).toBe(true);
    expect(
      result.issues.some(
        (i) => i.code === CITATION_ISSUE_CODES.ABSTAINED_AFTER_RETRIEVAL
      )
    ).toBe(true);
  });

  it("fails evidence-required cases with a total retrieval miss (P0 2026-07-05 signature)", () => {
    // RQ-LUNG-02 current: 0 retrieved, 0 citations — old citation_contract never fired
    const result = verifyCitationIntegrity({
      intent: "SYMPTOMATIC_PATIENT",
      expectations: { min_citations: 2 },
      responseText: "A persistent cough for 8 weeks should be checked by a doctor.",
      citations: [],
      retrievedChunks: [],
      citationConfidence: "RED",
    });

    expect(result.rules.find((r) => r.ruleId === "CIT-5")?.passed).toBe(false);
    expect(result.clusters).toContain("retrieval-miss");
    expect(
      result.issues.some(
        (i) => i.code === CITATION_ISSUE_CODES.ZERO_RETRIEVAL_FOR_EVIDENCE_CASE
      )
    ).toBe(true);
    // "cannot pass with zero supporting citations": CIT-3 must also fail
    expect(result.rules.find((r) => r.ruleId === "CIT-3")?.passed).toBe(false);
  });

  it("does not penalize structured citations without inline markers (citations are for auditors, not users)", () => {
    const result = verifyCitationIntegrity({
      intent: "INFORMATIONAL_GENERAL",
      responseText: "Pancreatic cancer info with no inline markers at all.",
      citations: [cite("kb_doc_a", "chunk-0"), cite("kb_doc_a", "chunk-0", 200)],
      retrievedChunks: retrieved(["kb_doc_a"]),
      citationConfidence: "YELLOW",
    });

    expect(result.rules.find((r) => r.ruleId === "CIT-6")?.applicable).toBe(false);
    expect(result.clusters).not.toContain("citation-format");
  });

  it("flags inline markers that reference no structured citation (CIT-6)", () => {
    const result = verifyCitationIntegrity({
      intent: "INFORMATIONAL_GENERAL",
      responseText: "Some claim [citation:kb_ghost] with a dangling marker.",
      citations: [],
      retrievedChunks: retrieved(["kb_doc_a"]),
      citationConfidence: "YELLOW",
    });

    expect(result.rules.find((r) => r.ruleId === "CIT-6")?.passed).toBe(false);
    expect(result.clusters).toContain("citation-format");
    expect(
      result.issues.some(
        (i) => i.code === CITATION_ISSUE_CODES.MARKERS_WITHOUT_STRUCTURED_CITATIONS
      )
    ).toBe(true);
  });

  it("does not apply citation rules to safety refusals", () => {
    const result = verifyCitationIntegrity({
      intent: "RED_FLAG_URGENT",
      safetyClassification: "red_flag",
      responseText: "Please go to the emergency room now.",
      citations: [],
      retrievedChunks: [],
    });

    expect(result.applicable).toBe(false);
    expect(result.score).toBe(1);
    expect(result.clusters).toHaveLength(0);
  });

  it("does not require citations for non-evidence intents", () => {
    const result = verifyCitationIntegrity({
      intent: "OUT_OF_SCOPE",
      responseText: "I can only help with cancer-related questions.",
      citations: [],
      retrievedChunks: [],
    });

    expect(result.evidenceRequired).toBe(false);
    expect(result.score).toBe(1);
    expect(result.clusters).toHaveLength(0);
  });

  it("scores the citation axis independently of anything else", () => {
    // Only citation rules feed the score: with 2 failing of N applicable rules,
    // score is strictly between 0 and 1 and derived from rules alone.
    const result = verifyCitationIntegrity({
      intent: "INFORMATIONAL_GENERAL",
      expectations: { min_citations: 2 },
      responseText: "Claim without markers.",
      citations: [cite("kb_doc_a", "chunk-0")],
      retrievedChunks: retrieved(["kb_doc_a"]),
      citationConfidence: "GREEN",
    });

    const applicable = result.rules.filter((r) => r.applicable);
    const passed = applicable.filter((r) => r.passed);
    expect(result.score).toBeCloseTo(passed.length / applicable.length, 10);
  });
});
