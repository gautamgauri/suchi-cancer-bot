import { EvidenceGateService, getGateScore } from "./evidence-gate.service";
import { PrismaService } from "../prisma/prisma.service";
import { EvidenceChunk } from "./evidence-gate.service";

describe("EvidenceGateService - identify general questions", () => {
  let service: EvidenceGateService;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    mockPrisma = {} as any;
    service = new EvidenceGateService(mockPrisma);
  });

  test("does not block informational identify question even with weak evidence", async () => {
    const weakChunks: EvidenceChunk[] = []; // Empty chunks = weak evidence
    const userText = "how to identify lymphoma";

    const result = await service.validateEvidence(weakChunks, "general", userText);

    expect(result.shouldAbstain).toBe(false);
    expect(result.confidence).toBe("medium");
  });

  test("allows general identify question with some evidence", async () => {
    const chunks: EvidenceChunk[] = [
      {
        chunkId: "chunk1",
        docId: "doc1",
        content: "Lymphoma symptoms include swollen lymph nodes",
        document: {
          title: "Lymphoma Guide",
          sourceType: "02_nci_core",
          source: "NCI",
          citation: null,
          isTrustedSource: true
        },
        similarity: 0.5
      }
    ];
    const userText = "how to identify lymphoma";

    const result = await service.validateEvidence(chunks, "general", userText);

    expect(result.shouldAbstain).toBe(false);
    expect(result.confidence).toBe("medium");
    expect(result.quality).toBe("weak");
  });

  test("personal identify question -> normal gate behavior", async () => {
    const weakChunks: EvidenceChunk[] = [];
    const userText = "i want to identify if i have lymphoma";

    const result = await service.validateEvidence(weakChunks, "general", userText);

    // Personal identify questions should go through normal gate logic
    // With no chunks, it should abstain
    expect(result.shouldAbstain).toBe(true);
    expect(result.reason).toBe("no_evidence");
  });

  test("non-identify question -> normal gate behavior", async () => {
    const weakChunks: EvidenceChunk[] = [];
    const userText = "what are cancer symptoms";

    const result = await service.validateEvidence(weakChunks, "general", userText);

    // Non-identify questions should go through normal gate logic
    expect(result.shouldAbstain).toBe(true);
    expect(result.reason).toBe("no_evidence");
  });
});

describe("EvidenceGateService - weak evidence regression tests", () => {
  let service: EvidenceGateService;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    mockPrisma = {} as any;
    service = new EvidenceGateService(mockPrisma);
  });

  test("weak evidence for informational query should NOT abstain - should clarify", async () => {
    // Weak evidence: low similarity, but from trusted source
    const weakChunks: EvidenceChunk[] = [
      {
        chunkId: "chunk1",
        docId: "doc1",
        content: "Some general information about cancer",
        document: {
          title: "General Cancer Info",
          sourceType: "02_nci_core",
          source: "NCI",
          citation: null,
          isTrustedSource: true
        },
        similarity: 0.35 // Low similarity but above very weak threshold
      }
    ];
    const userText = "What are common symptoms of breast cancer? Just asking generally.";

    const result = await service.validateEvidence(weakChunks, "general", userText, undefined, {
      hasGenerallyAsking: true
    });

    // Should NOT abstain for informational queries with weak evidence
    // Should allow through with clarification option
    expect(result.shouldAbstain).toBe(false);
    expect(result.confidence).toBe("medium");
    expect(result.quality).toBe("weak");
  });

  test("very weak evidence for informational query should still NOT abstain", async () => {
    // Very weak: low similarity, single source, but trusted
    const veryWeakChunks: EvidenceChunk[] = [
      {
        chunkId: "chunk1",
        docId: "doc1",
        content: "Limited information",
        document: {
          title: "Limited Source",
          sourceType: "02_nci_core",
          source: "NCI",
          citation: null,
          isTrustedSource: true
        },
        similarity: 0.25 // Very low similarity
      }
    ];
    const userText = "What are treatment options? Just asking generally.";

    const result = await service.validateEvidence(veryWeakChunks, "treatment", userText, undefined, {
      hasGenerallyAsking: true
    });

    // Even very weak evidence should not cause abstention for informational queries
    // Should allow with low confidence or clarification
    expect(result.shouldAbstain).toBe(false);
  });

  test("weak evidence with untrusted sources should abstain", async () => {
    // Weak evidence from untrusted source
    const weakUntrustedChunks: EvidenceChunk[] = [
      {
        chunkId: "chunk1",
        docId: "doc1",
        content: "Some information",
        document: {
          title: "Untrusted Source",
          sourceType: "unknown_source",
          source: "Unknown",
          citation: null,
          isTrustedSource: false
        },
        similarity: 0.4
      }
    ];
    const userText = "What are symptoms? Just asking generally.";

    const result = await service.validateEvidence(weakUntrustedChunks, "general", userText);

    // Untrusted sources should still cause abstention
    expect(result.shouldAbstain).toBe(true);
    expect(result.reason).toBe("untrusted_sources");
  });

  test("no evidence should abstain even for informational queries", async () => {
    const noChunks: EvidenceChunk[] = [];
    const userText = "What are symptoms? Just asking generally.";

    const result = await service.validateEvidence(noChunks, "general", userText, undefined, {
      hasGenerallyAsking: true
    });

    // No evidence at all should still abstain
    expect(result.shouldAbstain).toBe(true);
    expect(result.reason).toBe("no_evidence");
  });

  test("weak evidence should generate clarifying question option", () => {
    const userText = "What are symptoms of breast cancer?";
    const clarifyingQuestion = service.generateClarifyingQuestion(userText, "general");

    expect(clarifyingQuestion).toBeTruthy();
    expect(clarifyingQuestion.length).toBeGreaterThan(0);
    expect(clarifyingQuestion.toLowerCase()).toContain("symptom");
  });
});

describe("EvidenceGateService - hybrid score dilution fix", () => {
  let service: EvidenceGateService;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    mockPrisma = {} as any;
    service = new EvidenceGateService(mockPrisma);
  });

  test("getGateScore uses max(vecSim, lexSim) when available", () => {
    const chunk: EvidenceChunk = {
      chunkId: "c1", docId: "d1", content: "test",
      document: { title: "T", sourceType: "02_nci_core", source: "NCI", citation: null, isTrustedSource: true },
      similarity: 0.40, // hybrid score (diluted)
      vecSim: 0.73,     // raw vector similarity
      lexSim: 0,         // FTS missed
    };
    expect(getGateScore(chunk)).toBe(0.73);
  });

  test("getGateScore falls back to similarity when vecSim/lexSim absent", () => {
    const chunk: EvidenceChunk = {
      chunkId: "c1", docId: "d1", content: "test",
      document: { title: "T", sourceType: "02_nci_core", source: "NCI", citation: null, isTrustedSource: true },
      similarity: 0.55,
    };
    expect(getGateScore(chunk)).toBe(0.55);
  });

  test("high vecSim with zero lexSim is recognized as strong match", () => {
    // Before fix: similarity=0.40 (hybrid) → hasStrongMatches=false
    // After fix: gateScore=0.73 (vecSim) → hasStrongMatches=true
    const chunks: EvidenceChunk[] = [
      {
        chunkId: "c1", docId: "d1",
        content: "Cancer is a disease in which some of the body's cells grow uncontrollably",
        document: { title: "Cancer Basics", sourceType: "02_nci_core", source: "NCI", citation: null, isTrustedSource: true },
        similarity: 0.40,  // hybrid score (0.55*0.73 + 0.45*0)
        vecSim: 0.73,      // strong vector match
        lexSim: 0,          // FTS returned nothing
      }
    ];
    expect(service.hasStrongMatches(chunks)).toBe(true);
  });

  test("validateEvidence gives high confidence for high vecSim despite low hybrid", async () => {
    const chunks: EvidenceChunk[] = [
      {
        chunkId: "c1", docId: "d1",
        content: "Cancer is a disease in which some of the body's cells grow uncontrollably",
        document: { title: "Cancer Basics", sourceType: "02_nci_core", source: "NCI", citation: null, isTrustedSource: true },
        similarity: 0.40,
        vecSim: 0.73,
        lexSim: 0,
      },
      {
        chunkId: "c2", docId: "d2",
        content: "Cancer begins when genetic changes interfere with this orderly process",
        document: { title: "Cancer Overview", sourceType: "02_nci_core", source: "NCI", citation: null, isTrustedSource: true },
        similarity: 0.35,
        vecSim: 0.65,
        lexSim: 0,
      }
    ];

    const result = await service.validateEvidence(chunks, "general", "What is cancer?");
    expect(result.shouldAbstain).toBe(false);
    expect(result.confidence).toBe("high");
    expect(result.quality).toBe("strong");
  });
});

// FR-CHAT-009 — treatment query with < 2 sources should abstain
// (treatment requires minPassages=2, minSources=2 from trusted-sources.config)
describe("EvidenceGateService — treatment evidence threshold (FR-CHAT-009)", () => {
  let service: EvidenceGateService;

  beforeEach(() => {
    service = new EvidenceGateService({} as any);
  });

  function makeChunk(docId: string, chunkId: string, isTrustedSource: boolean, vecSim = 0.2): EvidenceChunk {
    return {
      chunkId,
      docId,
      content: "some content",
      document: {
        title: "Test doc",
        sourceType: isTrustedSource ? "02_nci_core" : "unknown_blog",
        source: isTrustedSource ? "NCI" : "Blog",
        citation: null,
        isTrustedSource,
      },
      similarity: vecSim,
      vecSim,
      lexSim: 0,
    };
  }

  test("treatment query with 0 chunks → shouldAbstain", async () => {
    const result = await service.validateEvidence([], "treatment", "what are treatment options for breast cancer");
    expect(result.shouldAbstain).toBe(true);
    expect(result.status).toBe("insufficient");
    expect(result.reason).toBe("no_evidence");
  });

  test("treatment query with 1 untrusted chunk (low similarity) → shouldAbstain", async () => {
    const chunks = [makeChunk("doc1", "chunk1", false, 0.2)];
    const result = await service.validateEvidence(chunks, "treatment", "best treatment for lung cancer");
    expect(result.shouldAbstain).toBe(true);
    expect(result.status).toBe("insufficient");
  });

  test("treatment query with 2+ trusted chunks (strong similarity) → does NOT abstain", async () => {
    const chunks = [
      makeChunk("doc1", "chunk1", true, 0.85),
      makeChunk("doc2", "chunk2", true, 0.80),
    ];
    const result = await service.validateEvidence(chunks, "treatment", "treatment for breast cancer");
    expect(result.shouldAbstain).toBe(false);
    expect(result.status).toBe("ok");
  });
});











