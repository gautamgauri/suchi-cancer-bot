import { StructuredExtractorService, COMPLETENESS_POLICIES } from "./structured-extractor.service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

describe("StructuredExtractorService", () => {
  let service: StructuredExtractorService;

  beforeEach(() => {
    service = new StructuredExtractorService();
  });

  // Helper to create mock chunks
  const createChunk = (content: string, docId = "doc1", chunkId = "chunk1"): EvidenceChunk => ({
    chunkId,
    docId,
    content,
    similarity: 0.8,
    document: {
      title: "Test Document",
      sourceType: "02_nci_core",
      source: "NCI",
      citation: "NCI Citation",
      isTrustedSource: true,
    },
  });

  describe("extract()", () => {
    it("should extract diagnostic tests with canonical keys", () => {
      const chunks = [
        createChunk("Diagnosis requires CT scan, MRI, and biopsy.", "doc1", "chunk1"),
      ];

      const result = service.extract(chunks);

      expect(result.diagnosticTests.length).toBeGreaterThanOrEqual(3);
      expect(result.diagnosticTests.map(t => t.key)).toContain("ct_scan");
      expect(result.diagnosticTests.map(t => t.key)).toContain("mri");
      expect(result.diagnosticTests.map(t => t.key)).toContain("biopsy");
    });

    it("should extract tests with correct evidence anchors", () => {
      const chunks = [
        createChunk("A CT scan is used for imaging.", "doc123", "chunk456"),
      ];

      const result = service.extract(chunks);

      const ctScan = result.diagnosticTests.find(t => t.key === "ct_scan");
      expect(ctScan).toBeDefined();
      expect(ctScan!.evidence[0].docId).toBe("doc123");
      expect(ctScan!.evidence[0].chunkId).toBe("chunk456");
      expect(ctScan!.evidence[0].quote).toContain("CT scan");
      expect(ctScan!.evidence[0].chunkIndex).toBe(0);
    });

    it("should generate matchTokens for variations", () => {
      const chunks = [
        createChunk("CT scan is recommended.", "doc1", "chunk1"),
      ];

      const result = service.extract(chunks);

      const ctScan = result.diagnosticTests.find(t => t.key === "ct_scan");
      expect(ctScan).toBeDefined();
      expect(ctScan!.matchTokens.length).toBeGreaterThan(0);
      expect(ctScan!.matchTokens).toContain("ct scan");
    });

    it("should extract warning signs with qualifiers", () => {
      const chunks = [
        createChunk("Persistent pain and unexplained fatigue are warning signs.", "doc1", "chunk1"),
      ];

      const result = service.extract(chunks);

      // Should extract pain and fatigue because they have qualifiers
      expect(result.warningSigns.some(s => s.key === "pain")).toBe(true);
      expect(result.warningSigns.some(s => s.key === "fatigue")).toBe(true);
    });

    it("should NOT extract broad symptoms without qualifiers", () => {
      const chunks = [
        createChunk("The patient reported pain and fatigue.", "doc1", "chunk1"),
      ];

      const result = service.extract(chunks);

      // Should NOT extract pain and fatigue without qualifiers
      expect(result.warningSigns.some(s => s.key === "pain")).toBe(false);
      expect(result.warningSigns.some(s => s.key === "fatigue")).toBe(false);
    });

    it("should extract timeline when present", () => {
      const chunks = [
        createChunk("If symptoms persist for 2-4 weeks, seek medical evaluation.", "doc1", "chunk1"),
      ];

      const result = service.extract(chunks);

      expect(result.timeline).not.toBeNull();
      expect(result.timeline!.rawMatch).toMatch(/2-4 weeks/i);
    });

    it("should return null timeline when not found", () => {
      const chunks = [
        createChunk("CT scan is used for diagnosis.", "doc1", "chunk1"),
      ];

      const result = service.extract(chunks);

      expect(result.timeline).toBeNull();
    });

    it("should deduplicate entities across chunks", () => {
      const chunks = [
        createChunk("CT scan is recommended.", "doc1", "chunk1"),
        createChunk("A CT scan may be used for diagnosis.", "doc2", "chunk2"),
      ];

      const result = service.extract(chunks);

      // Should only have 1 CT scan entry, not 2
      const ctScans = result.diagnosticTests.filter(t => t.key === "ct_scan");
      expect(ctScans.length).toBe(1);
      // But evidence should be merged from both chunks
      expect(ctScans[0].evidence.length).toBe(2);
    });

    it("should sort by chunk order then alphabetically", () => {
      const chunks = [
        createChunk("MRI is used.", "doc1", "chunk1"),
        createChunk("CT scan and biopsy.", "doc2", "chunk2"),
      ];

      const result = service.extract(chunks);

      // MRI should come first (chunk 0), then biopsy, CT scan (chunk 1, alphabetical)
      expect(result.diagnosticTests[0].key).toBe("mri");
      expect(result.diagnosticTests[1].key).toBe("biopsy");
      expect(result.diagnosticTests[2].key).toBe("ct_scan");
    });

    it("should generate suggested questions based on extracted entities", () => {
      const chunks = [
        createChunk("CT scan and MRI are used for diagnosis.", "doc1", "chunk1"),
      ];

      const result = service.extract(chunks, "diagnosis");

      expect(result.suggestedQuestions.length).toBeGreaterThan(0);
      expect(result.suggestedQuestions.length).toBeLessThanOrEqual(7);
    });
  });

  describe("checkCompleteness()", () => {
    it("should detect tests present in chunks but missing from response", () => {
      const chunks = [
        createChunk("Diagnosis uses CT scan, MRI, biopsy, mammogram, and PET scan.", "doc1", "chunk1"),
      ];
      const extraction = service.extract(chunks);

      // Response only mentions 2 of 5 tests
      const response = "Tests include CT scan and biopsy.";

      const result = service.checkCompleteness(response, extraction, "diagnosis");

      expect(result.coverage.diagnosticTests.found).toBe(2);
      expect(result.coverage.diagnosticTests.required).toBeGreaterThan(2);
      expect(result.missing.diagnosticTests.length).toBeGreaterThan(0);
    });

    it("should use matchTokens for detection variations", () => {
      const chunks = [
        createChunk("CT scan is recommended.", "doc1", "chunk1"),
      ];
      const extraction = service.extract(chunks);

      // Response uses variation without "scan"
      const response = "CT imaging can help diagnose.";

      const result = service.checkCompleteness(response, extraction, "general");

      // Should recognize CT as matching CT scan via matchTokens
      expect(result.coverage.diagnosticTests.found).toBe(1);
    });

    it("should meet policy when enough items are present", () => {
      const chunks = [
        createChunk("Tests include CT scan, MRI, and biopsy.", "doc1", "chunk1"),
      ];
      const extraction = service.extract(chunks);

      const response = "Doctors may use CT scan, MRI, and biopsy for diagnosis.";

      const result = service.checkCompleteness(response, extraction, "general");

      // general policy only requires 2 tests
      expect(result.meetsPolicy).toBe(true);
    });

    it("should not meet policy when too few items", () => {
      const chunks = [
        createChunk("Tests include CT scan, MRI, biopsy, and mammogram.", "doc1", "chunk1"),
      ];
      const extraction = service.extract(chunks);

      // Response only has 1 test, diagnosis policy requires 4
      const response = "A CT scan may be used.";

      const result = service.checkCompleteness(response, extraction, "diagnosis");

      expect(result.meetsPolicy).toBe(false);
    });

    it("should detect missing timeline when required", () => {
      const chunks = [
        createChunk("If symptoms persist for 2-4 weeks, seek care.", "doc1", "chunk1"),
      ];
      const extraction = service.extract(chunks);

      // Response doesn't mention timeline
      const response = "Persistent lumps should be checked.";

      const result = service.checkCompleteness(response, extraction, "diagnosis");

      expect(result.missing.timelineMissing).toBe(true);
    });

    it("should not flag missing timeline when not in sources", () => {
      const chunks = [
        createChunk("CT scan is used for imaging.", "doc1", "chunk1"),
      ];
      const extraction = service.extract(chunks);

      const response = "CT scan is used.";

      const result = service.checkCompleteness(response, extraction, "diagnosis");

      // Timeline is required but not in sources, so shouldn't be flagged as missing
      expect(result.missing.timelineMissing).toBe(false);
    });
  });

  describe("generateFallbackContent()", () => {
    it("should generate supplemental content with citations", () => {
      const chunks = [
        createChunk("MRI and mammogram are diagnostic tests.", "doc1", "chunk2"),
      ];
      const extraction = service.extract(chunks);

      const missing = {
        diagnosticTests: extraction.diagnosticTests.slice(0, 2),
        warningSigns: [],
        timelineMissing: false,
      };

      const fallback = service.generateFallbackContent(missing, extraction);

      expect(fallback).toContain("Additional tests");
      expect(fallback).toContain("[citation:doc1:chunk2]");
    });

    it("should not generate content when nothing is missing", () => {
      const chunks = [createChunk("Some content.", "doc1", "chunk1")];
      const extraction = service.extract(chunks);

      const missing = {
        diagnosticTests: [],
        warningSigns: [],
        timelineMissing: false,
      };

      const fallback = service.generateFallbackContent(missing, extraction);

      expect(fallback).toBe("");
    });

    it("should include timeline when missing", () => {
      const chunks = [
        createChunk("If symptoms persist for 2-4 weeks, see a doctor.", "doc1", "chunk1"),
      ];
      const extraction = service.extract(chunks);

      const missing = {
        diagnosticTests: [],
        warningSigns: [],
        timelineMissing: true,
      };

      const fallback = service.generateFallbackContent(missing, extraction);

      expect(fallback).toContain("When to seek care");
      expect(fallback).toContain("2-4 weeks");
    });

    it("should cap supplemental items at 5", () => {
      const chunks = [
        createChunk(
          "Tests include CT, MRI, PET, mammogram, ultrasound, colonoscopy, bronchoscopy, cystoscopy.",
          "doc1",
          "chunk1"
        ),
      ];
      const extraction = service.extract(chunks);

      const missing = {
        diagnosticTests: extraction.diagnosticTests,
        warningSigns: [],
        timelineMissing: false,
      };

      const fallback = service.generateFallbackContent(missing, extraction);

      // Count bullet points (lines starting with "- ")
      const bulletCount = (fallback.match(/^- /gm) || []).length;
      expect(bulletCount).toBeLessThanOrEqual(5);
    });
  });

  describe("formatForPrompt()", () => {
    it("should format extraction as checklist for LLM", () => {
      const chunks = [
        createChunk("CT scan and MRI are used. Persistent lumps are warning signs.", "doc1", "chunk1"),
      ];
      const extraction = service.extract(chunks);

      const prompt = service.formatForPrompt(extraction);

      expect(prompt).toContain("PRE-EXTRACTED CHECKLIST");
      expect(prompt).toContain("DIAGNOSTIC TESTS FOUND");
      expect(prompt).toContain("[citation:doc1:chunk1]");
      expect(prompt).toContain("cover every checklist item");
    });

    it("should return empty string when no entities extracted", () => {
      const chunks = [createChunk("No medical entities here at all.", "doc1", "chunk1")];
      const extraction = service.extract(chunks);

      // If no tests/signs extracted, should return empty
      if (extraction.diagnosticTests.length === 0 && extraction.warningSigns.length === 0) {
        const prompt = service.formatForPrompt(extraction);
        expect(prompt).toBe("");
      }
    });

    it("should use softer language without INVALID", () => {
      const chunks = [
        createChunk("CT scan is used.", "doc1", "chunk1"),
      ];
      const extraction = service.extract(chunks);

      const prompt = service.formatForPrompt(extraction);

      expect(prompt).not.toContain("INVALID");
      expect(prompt).toContain("say so explicitly");
    });
  });

  describe("getPolicy()", () => {
    it("should return correct policy for known query types", () => {
      const diagnosisPolicy = service.getPolicy("diagnosis");
      expect(diagnosisPolicy.minDiagnosticTests).toBe(4);
      expect(diagnosisPolicy.minWarningSigns).toBe(4);
      expect(diagnosisPolicy.timelineRequired).toBe(true);

      const generalPolicy = service.getPolicy("general");
      expect(generalPolicy.minDiagnosticTests).toBe(2);
      expect(generalPolicy.minWarningSigns).toBe(2);
      expect(generalPolicy.timelineRequired).toBe(false);
    });

    it("should return general policy for unknown query types", () => {
      const policy = service.getPolicy("unknown_type");
      expect(policy).toEqual(COMPLETENESS_POLICIES.general);
    });
  });

  describe("edge cases", () => {
    it("should handle empty chunks array", () => {
      const result = service.extract([]);

      expect(result.diagnosticTests).toEqual([]);
      expect(result.warningSigns).toEqual([]);
      expect(result.timeline).toBeNull();
    });

    it("should handle chunks with no medical entities", () => {
      const chunks = [createChunk("The weather is nice today.", "doc1", "chunk1")];

      const result = service.extract(chunks);

      expect(result.diagnosticTests.length).toBe(0);
    });

    it("should handle very long content with deduplication", () => {
      const longContent = "CT scan ".repeat(100) + "is recommended.";
      const chunks = [createChunk(longContent, "doc1", "chunk1")];

      const result = service.extract(chunks);

      // Should deduplicate and only have one CT scan entry
      const ctScans = result.diagnosticTests.filter(t => t.key === "ct_scan");
      expect(ctScans.length).toBe(1);
    });

    it("should include chunkIndex in evidence for stable ordering", () => {
      const chunks = [
        createChunk("MRI is useful.", "doc1", "chunk1"),
        createChunk("CT scan helps.", "doc2", "chunk2"),
      ];

      const result = service.extract(chunks);

      const mri = result.diagnosticTests.find(t => t.key === "mri");
      const ct = result.diagnosticTests.find(t => t.key === "ct_scan");

      expect(mri!.evidence[0].chunkIndex).toBe(0);
      expect(ct!.evidence[0].chunkIndex).toBe(1);
    });
  });
});
