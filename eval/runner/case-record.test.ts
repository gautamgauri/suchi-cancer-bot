/**
 * Unit tests for structured per-case evaluation records (issue #48, Part 1).
 */

import { buildCaseRecord, extractClaims, riskCategoryFor } from "./case-record";
import { generateClusterReport, clusterReportToMarkdown } from "./failure-cluster-report";
import type { EvaluationResult, TestCase } from "../types";
import { EMPTY_APPROVED_SOURCES } from "./citation-verifier";

const lungCase: TestCase = {
  id: "RQ-LUNG-02",
  tier: 1,
  cancer: "lung",
  intent: "SYMPTOMATIC_PATIENT",
  user_messages: ["I've had a persistent cough for 8 weeks. What should I do?"],
  expectations: {
    min_citations: 2,
    required_sections: ["disclaimer"],
    expected_sources: ["02_nci_core"],
    must_not: ["definitive diagnosis"],
    notes: "Should not abstain, should provide guidance with trusted sources",
  },
};

/** Reproduces the 2026-07-05 P0: 0 retrieved chunks, 0 citations, RED confidence */
const retrievalMissResult: EvaluationResult = {
  testCaseId: "RQ-LUNG-02",
  passed: false,
  score: 0.69,
  deterministicResults: [
    {
      checkId: "citations_present",
      passed: false,
      required: true,
      details: { citationCount: 0, minCount: 2 },
    },
    {
      checkId: "citation_confidence_acceptable",
      passed: false,
      required: true,
      details: { currentConfidence: "RED", minConfidence: "YELLOW" },
    },
  ],
  responseText:
    "A persistent cough lasting 8 weeks can have many causes. Lung cancer screening may involve a CT scan and other tests your doctor can order. This is not a diagnosis — please see a doctor.",
  responseMetadata: {
    sessionId: "s1",
    messageId: "m1",
    citations: [],
    citationConfidence: "RED",
    retrievedChunks: [],
  },
  executionTimeMs: 1000,
};

describe("extractClaims", () => {
  it("extracts declarative medical claims and skips questions/disclaimers/empathy", () => {
    const text =
      "I'm sorry you're going through this. " +
      "Breast cancer often presents as a painless lump in the breast or armpit region. " +
      "Would you like to tell me more about your symptoms? " +
      "Screening mammograms can detect tumours before symptoms appear in many patients. " +
      "This is not a diagnosis, please consult a doctor.";
    const claims = extractClaims(text);
    expect(claims).toHaveLength(2);
    expect(claims[0].text).toContain("painless lump");
    expect(claims[1].text).toContain("Screening mammograms");
  });

  it("maps citation anchor positions onto claims", () => {
    const text =
      "Breast cancer often presents as a painless lump in the breast or armpit region.";
    const claims = extractClaims(text, [{ docId: "kb_doc_a", position: 60 }]);
    expect(claims[0].supported).toBe(true);
    expect(claims[0].citedDocIds).toEqual(["kb_doc_a"]);

    const unsupported = extractClaims(text, [{ docId: "kb_doc_a", position: 5000 }]);
    expect(unsupported[0].supported).toBe(false);
  });
});

describe("riskCategoryFor", () => {
  it("uses the explicit risk field when present", () => {
    expect(riskCategoryFor({ ...lungCase, risk: "P0" })).toBe("P0");
  });
  it("infers P0 for urgent/crisis intents", () => {
    expect(riskCategoryFor({ ...lungCase, intent: "RED_FLAG_URGENT" })).toBe("P0");
    expect(riskCategoryFor({ ...lungCase, intent: "CRISIS" })).toBe("P0");
  });
  it("defaults to P1 for other intents and unknown without a case", () => {
    expect(riskCategoryFor(lungCase)).toBe("P1");
    expect(riskCategoryFor(undefined)).toBe("unknown");
  });
});

describe("buildCaseRecord", () => {
  const record = buildCaseRecord(retrievalMissResult, lungCase, {
    runId: "run-test",
    suiteFile: "cases/tier1/retrieval_quality.yaml",
    approvedSources: EMPTY_APPROVED_SOURCES,
  });

  it("captures test ID, intent, risk category, and expected concepts", () => {
    expect(record.testId).toBe("RQ-LUNG-02");
    expect(record.intent).toBe("SYMPTOMATIC_PATIENT");
    expect(record.riskCategory).toBe("P1");
    expect(record.expectedConcepts.sources).toEqual(["02_nci_core"]);
    expect(record.expectedConcepts.sections).toEqual(["disclaimer"]);
    expect(record.expectedConcepts.mustNot).toEqual(["definitive diagnosis"]);
  });

  it("captures the retrieval path and marks the P0 as a retrieval miss", () => {
    expect(record.retrieval.retrievedCount).toBe(0);
    expect(record.retrieval.retrievalPath).toBe("none");
    expect(record.failureClusters).toContain("retrieval-miss");
    expect(record.evidenceRequired).toBe(true);
  });

  it("captures claims requiring support with zero supported", () => {
    expect(record.claims.requiringSupportCount).toBeGreaterThan(0);
    expect(record.claims.supportedCount).toBe(0);
  });

  it("captures machine-readable missing-citation reasons", () => {
    const codes = record.citationIssues.map((i) => i.code);
    expect(codes).toContain("ZERO_RETRIEVAL_FOR_EVIDENCE_CASE");
  });

  it("records retrieved sources with ranks when retrieval succeeded", () => {
    const withRetrieval: EvaluationResult = {
      ...retrievalMissResult,
      responseMetadata: {
        ...retrievalMissResult.responseMetadata,
        retrievedChunks: [
          { docId: "kb_a", chunkId: "c1", sourceType: "02_nci_core", isTrustedSource: true, similarity: 0.91 },
          { docId: "kb_b", chunkId: "c2", sourceType: "01_suchi_oncotalks", isTrustedSource: true, similarity: 0.88 },
        ],
        citations: [{ docId: "kb_a", chunkId: "c1", position: 10 }],
      },
    };
    const r = buildCaseRecord(withRetrieval, lungCase, { runId: "run-test" });
    expect(r.retrieval.sources).toHaveLength(2);
    expect(r.retrieval.sources[0]).toMatchObject({ rank: 1, docId: "kb_a" });
    expect(r.retrieval.sources[1]).toMatchObject({ rank: 2, docId: "kb_b" });
    expect(r.citations.citedDocIds).toEqual(["kb_a"]);
    expect(r.citations.entries[0].resolution).toBe("retrieved");
  });
});

describe("failure cluster report", () => {
  const records = [
    buildCaseRecord(retrievalMissResult, lungCase, {
      runId: "run-test",
      suiteFile: "cases/tier1/retrieval_quality.yaml",
      approvedSources: EMPTY_APPROVED_SOURCES,
    }),
  ];

  it("groups cases into named clusters", () => {
    const report = generateClusterReport(records);
    expect(report.totalCases).toBe(1);
    expect(report.failedCases).toBe(1);
    const clusters = report.clusters.map((c) => c.cluster);
    expect(clusters).toContain("retrieval-miss");
    const miss = report.clusters.find((c) => c.cluster === "retrieval-miss")!;
    expect(miss.caseIds).toEqual(["RQ-LUNG-02"]);
  });

  it("renders markdown identifying case, claim, retrieval path, and citation rule", () => {
    const md = clusterReportToMarkdown(generateClusterReport(records));
    expect(md).toContain("RQ-LUNG-02");
    expect(md).toContain("retrieval-miss");
    expect(md).toContain("Retrieval path: none (0 chunks)");
    expect(md).toContain("CIT-5"); // the failed citation rule
    expect(md).toContain("ZERO_RETRIEVAL_FOR_EVIDENCE_CASE");
    expect(md).toContain("Unsupported claims"); // the claim text sample
    expect(md).toContain("cases/tier1/retrieval_quality.yaml");
  });
});
