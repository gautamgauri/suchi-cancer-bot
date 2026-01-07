import { EvidenceGateService } from "./evidence-gate.service";
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











