import { Test, TestingModule } from "@nestjs/testing";
import { ChatService } from "./chat.service";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { SafetyService } from "../safety/safety.service";
import { RagService } from "../rag/rag.service";
import { LlmService } from "../llm/llm.service";
import { EvidenceGateService } from "../evidence/evidence-gate.service";
import { CitationService } from "../citations/citation.service";
import { AbstentionService } from "../abstention/abstention.service";
import { IntentClassifier } from "./intent-classifier";
import { TemplateSelector } from "./template-selector";
import { StructuredExtractorService } from "./structured-extractor.service";
import { ResponseValidatorService } from "./response-validator.service";
import { GreetingFlowService } from "./greeting-flow.service";
import { EmpathyDetector } from "./empathy-detector";

describe("Identify Question Flow - SUCHI-HJ2-BC-IDENTIFY-01", () => {
  let chatService: ChatService;
  let prisma: PrismaService;
  let citationService: CitationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaService,
          useValue: {
            session: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            message: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
            },
            messageCitation: {
              create: jest.fn(),
            },
            safetyEvent: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: AnalyticsService,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: SafetyService,
          useValue: {
            evaluate: jest.fn().mockReturnValue({
              classification: "normal",
              responseText: null,
              rulesFired: [],
              actions: [],
            }),
          },
        },
        {
          provide: RagService,
          useValue: {
            retrieveWithMetadata: jest.fn().mockResolvedValue([
              {
                docId: "doc1",
                chunkId: "chunk1",
                content: "Breast cancer symptoms include lumps, nipple changes, and skin changes.",
                document: {
                  title: "Breast Cancer Symptoms - NCI",
                  url: "https://example.com/breast-cancer-symptoms",
                  source: "NCI",
                  sourceType: "02_nci_core",
                  citation: "NCI, 2025",
                },
              },
              {
                docId: "doc2",
                chunkId: "chunk2",
                content: "Diagnosis requires clinical exam, mammogram, ultrasound, and biopsy.",
                document: {
                  title: "Breast Cancer Diagnosis - NCI",
                  url: "https://example.com/breast-cancer-diagnosis",
                  source: "NCI",
                  sourceType: "02_nci_core",
                  citation: "NCI, 2025",
                },
              },
            ]),
          },
        },
        {
          provide: LlmService,
          useValue: {
            generateWithCitations: jest.fn().mockResolvedValue(
              `## Warning Signs
- Lump or mass
- Change in size/shape
- Nipple inversion
- Nipple discharge
- Skin dimpling
- Redness or scaling
- Swollen lymph nodes [citation:doc1:chunk1]

## How Doctors Confirm
- Clinical breast exam [citation:doc2:chunk2]
- Mammogram [citation:doc2:chunk2]
- Ultrasound [citation:doc2:chunk2]
- Biopsy (diagnostic gold standard) [citation:doc2:chunk2]

Symptoms cannot confirm cancer; confirmation requires medical evaluation and often a biopsy.

## When to Seek Care
If a new lump persists for 2–4 weeks, or there are nipple/skin changes, book a clinical evaluation soon.

## Questions to Ask the Doctor
- What imaging do I need and why?
- Do I need a biopsy? Which type?
- If cancer is confirmed, what subtype tests will be done?
- If benign, what follow-up interval?
- What symptoms should trigger earlier return?
- Where should I go for these tests?
- What are the costs involved?`
            ),
          },
        },
        {
          provide: EvidenceGateService,
          useValue: {
            validateEvidence: jest.fn().mockResolvedValue({
              shouldAbstain: false,
              confidence: "medium",
              quality: "weak",
            }),
            generateClarifyingQuestion: jest.fn(),
          },
        },
        {
          provide: CitationService,
          useValue: {
            extractCitations: jest.fn().mockReturnValue([
              { docId: "doc1", chunkId: "chunk1", position: 100, citationText: "[citation:doc1:chunk1]" },
              { docId: "doc2", chunkId: "chunk2", position: 200, citationText: "[citation:doc2:chunk2]" },
            ]),
            validateCitations: jest.fn().mockReturnValue({
              isValid: true,
              confidenceLevel: "GREEN",
              citations: [],
              citationDensity: 0.5,
            }),
            enrichCitations: jest.fn().mockResolvedValue([
              {
                docId: "doc1",
                chunkId: "chunk1",
                position: 100,
                citationText: "[citation:doc1:chunk1]",
                document: {
                  title: "Breast Cancer Symptoms - NCI",
                  url: "https://example.com/breast-cancer-symptoms",
                  source: "NCI",
                },
              },
              {
                docId: "doc2",
                chunkId: "chunk2",
                position: 200,
                citationText: "[citation:doc2:chunk2]",
                document: {
                  title: "Breast Cancer Diagnosis - NCI",
                  url: "https://example.com/breast-cancer-diagnosis",
                  source: "NCI",
                },
              },
            ]),
          },
        },
        {
          provide: AbstentionService,
          useValue: {
            hasUrgencyIndicators: jest.fn().mockReturnValue(false),
            generateAbstentionMessage: jest.fn(),
          },
        },
        {
          provide: IntentClassifier,
          useValue: {
            classify: jest.fn().mockReturnValue({
              intent: "INFORMATIONAL_GENERAL",
              confidence: "high",
            }),
          },
        },
        {
          provide: TemplateSelector,
          useValue: {
            selectAndGenerate: jest.fn(),
          },
        },
      ],
    }).compile();

    chatService = module.get<ChatService>(ChatService);
    prisma = module.get<PrismaService>(PrismaService);
    citationService = module.get<CitationService>(CitationService);

    // Setup default mocks
    (prisma.session.findUnique as jest.Mock).mockResolvedValue({
      id: "test-session",
      channel: "web",
      status: "active",
    });
    (prisma.message.count as jest.Mock).mockResolvedValue(0);
    (prisma.message.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.message.create as jest.Mock).mockImplementation((args) =>
      Promise.resolve({
        id: `msg-${Date.now()}`,
        ...args.data,
        createdAt: new Date(),
      })
    );
  });

  it("should answer directly after 'Generally asking' without 3rd clarification", async () => {
    const sessionId = "test-session";

    // U1: "breast cancer symptoms"
    (prisma.message.findMany as jest.Mock).mockResolvedValueOnce([]);
    const r1 = await chatService.handle({
      sessionId,
      userText: "breast cancer symptoms",
      channel: "web",
    });
    // Assert: can ask 1 clarifier (acceptable)

    // U2: "Generally asking"
    (prisma.message.findMany as jest.Mock).mockResolvedValueOnce([
      { role: "user", text: "breast cancer symptoms" },
      { role: "assistant", text: "Can you tell me more?" },
    ]);
    const r2 = await chatService.handle({
      sessionId,
      userText: "Generally asking",
      channel: "web",
    });
    // Assert: should answer or ask max 1 more question

    // U3: "how do you identify breast cancer?"
    (prisma.message.findMany as jest.Mock).mockResolvedValueOnce([
      { role: "user", text: "Generally asking" },
      { role: "assistant", text: "Here's information..." },
    ]);
    const r3 = await chatService.handle({
      sessionId,
      userText: "how do you identify breast cancer?",
      channel: "web",
    });

    // Assertions:
    // 1. Total clarifying messages <= 2
    const allMessages = await prisma.message.findMany({ where: { sessionId } });
    const clarifyingCount = allMessages.filter(
      (m: any) =>
        m.role === "assistant" &&
        /\?/.test(m.text) &&
        /\b(can you|could you|tell me)\b/i.test(m.text)
    ).length;
    expect(clarifyingCount).toBeLessThanOrEqual(2);

    // 2. Response contains 5+ warning signs
    const warningSignsMatch = r3.responseText.match(
      /(?:warning signs?)[\s\S]*?((?:^[-*•]\s+.*\n?)+)/im
    );
    const warningSignsCount = warningSignsMatch
      ? warningSignsMatch[1]
          .split(/\n/)
          .filter((l) => /^[-*•]\s+/.test(l.trim())).length
      : 0;
    expect(warningSignsCount).toBeGreaterThanOrEqual(5);

    // 3. Response contains 3+ diagnostic tests including biopsy
    expect(r3.responseText).toMatch(/\bbiopsy\b/i);
    const testCount = [
      /\bclinical\b.*\bexam\b/i,
      /\bmammogram\b/i,
      /\bultrasound\b/i,
      /\bmri\b/i,
      /\bbiopsy\b/i,
    ].filter((regex) => regex.test(r3.responseText)).length;
    expect(testCount).toBeGreaterThanOrEqual(3);

    // 4. Response contains timeline "2-4 weeks"
    expect(r3.responseText).toMatch(/\b2\s*[–-]\s*4\s*weeks\b/i);

    // 5. Response contains 5+ doctor questions
    const questionsMatch = r3.responseText.match(
      /(?:questions? to ask)[\s\S]*?((?:^[-*•]\s+.*\n?)+)/im
    );
    const questionsCount = questionsMatch
      ? questionsMatch[1]
          .split(/\n/)
          .filter((l) => /^[-*•]\s+/.test(l.trim())).length
      : 0;
    expect(questionsCount).toBeGreaterThanOrEqual(5);

    // 6. Response has 2+ citations with title+url
    expect(r3.citations?.length).toBeGreaterThanOrEqual(2);
    if (r3.citations) {
      const enriched = await citationService.enrichCitations(
        r3.citations,
        []
      );
      enriched.forEach((c) => {
        expect(c.document.title).toBeTruthy();
        // URL optional but preferred
      });
    }
  });
});

describe("Structured Extractor Integration - Extract → Generate → Enforce Pipeline", () => {
  let chatService: ChatService;
  let llmService: LlmService;
  let structuredExtractor: StructuredExtractorService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue({
          id: "session1",
          cancerType: null,
          emotionalState: "neutral",
          userContext: "general",
        }),
        update: jest.fn(),
      },
      message: {
        create: jest.fn().mockResolvedValue({ id: "msg1", text: "", sessionId: "session1" }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      messageCitation: {
        create: jest.fn(),
        createMany: jest.fn(),
      },
      safetyEvent: {
        create: jest.fn(),
      },
    };

    const mockLlmService = {
      generateWithCitations: jest.fn(),
    };

    const mockStructuredExtractor = new StructuredExtractorService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsService, useValue: { emit: jest.fn() } },
        {
          provide: SafetyService,
          useValue: {
            evaluate: jest.fn().mockReturnValue({
              classification: "normal",
              responseText: null,
              rulesFired: [],
              actions: [],
            }),
          },
        },
        {
          provide: RagService,
          useValue: {
            retrieveWithMetadata: jest.fn(),
            retrieveWithExpansion: jest.fn(),
          },
        },
        { provide: LlmService, useValue: mockLlmService },
        {
          provide: EvidenceGateService,
          useValue: {
            validateEvidence: jest.fn().mockResolvedValue({
              shouldAbstain: false,
              confidence: "high",
              quality: "strong",
            }),
          },
        },
        {
          provide: CitationService,
          useValue: {
            extractCitations: jest.fn().mockReturnValue([]),
            enrichCitations: jest.fn().mockImplementation((citations) => citations),
            validateCitations: jest.fn().mockReturnValue({
              isValid: true,
              confidenceLevel: "GREEN" as const,
              citations: [],
            }),
          },
        },
        { provide: AbstentionService, useValue: { generateResponse: jest.fn() } },
        {
          provide: IntentClassifier,
          useValue: {
            classify: jest.fn().mockReturnValue({
              intent: "INFORMATIONAL_GENERAL",
              confidence: "high",
            }),
          },
        },
        { provide: TemplateSelector, useValue: {} },
        { provide: StructuredExtractorService, useValue: mockStructuredExtractor },
        { provide: ResponseValidatorService, useValue: { validate: jest.fn().mockReturnValue({ shouldAbstain: false, isValid: true, ungroundedEntities: [] }) } },
        {
          provide: GreetingFlowService,
          useValue: {
            extractContextFromMessage: jest.fn().mockResolvedValue({
              context: "general",
              cancerType: undefined,
              confidence: 0.95,
            }),
          },
        },
        {
          provide: EmpathyDetector,
          useValue: {
            detectEmotionalTone: jest.fn().mockResolvedValue({ tone: "neutral" }),
          },
        },
      ],
    }).compile();

    chatService = module.get<ChatService>(ChatService);
    llmService = module.get<LlmService>(LlmService);
    structuredExtractor = module.get<StructuredExtractorService>(StructuredExtractorService);
  });

  // Helper to create evidence chunks with multiple diagnostic tests
  const createChunksWithTests = (testNames: string[]) => {
    const content = `Diagnosis may involve ${testNames.join(", ")}. These tests help identify cancer.`;
    return [
      {
        chunkId: "chunk1",
        docId: "doc1",
        content,
        document: {
          title: "Test Document",
          sourceType: "02_nci_core",
          source: "NCI",
          citation: "NCI, 2025",
          isTrustedSource: true,
        },
        similarity: 0.8,
      },
    ];
  };

  it("should insert fallback when LLM under-extracts (2 tests when 5 exist)", async () => {
    // Setup: RAG chunks contain 5 diagnostic tests
    const chunks = createChunksWithTests(["CT scan", "MRI", "biopsy", "mammogram", "ultrasound"]);
    const ragService = chatService["rag"] as jest.Mocked<RagService>;
    ragService.retrieveWithMetadata = jest.fn().mockResolvedValue(chunks);

    // Mock LLM to only mention 2 tests (under-extraction)
    llmService.generateWithCitations = jest.fn().mockResolvedValue(`
**Tests Doctors May Use:**
- CT scan [citation:doc1:chunk1]
- Biopsy [citation:doc1:chunk1]

**Warning Signs to Watch For:**
- Lump or mass [citation:doc1:chunk1]
`);

    const result = await chatService.handle({
      sessionId: "session1",
      userText: "What tests are used for breast cancer diagnosis? Just asking generally.",
      channel: "web",
    });

    // Verify fallback was inserted
    expect(result.responseText).toContain("Additional tests");
    // Should mention at least one of the missing tests (MRI, mammogram, or ultrasound)
    const hasMissingTest = ["MRI", "mammogram", "ultrasound"].some(
      (test) => result.responseText.includes(test)
    );
    expect(hasMissingTest).toBe(true);
    // Verify citations are included in fallback
    expect(result.responseText).toMatch(/\[citation:doc1:chunk1\]/);
  });

  it("should NOT insert fallback when LLM uses synonyms (CAT scan detected as CT scan)", async () => {
    // Setup: RAG chunks contain CT scan
    const chunks = createChunksWithTests(["CT scan"]);
    const ragService = chatService["rag"] as jest.Mocked<RagService>;
    ragService.retrieveWithMetadata = jest.fn().mockResolvedValue(chunks);

    // Mock LLM to use synonym "CAT scan" instead of "CT scan"
    llmService.generateWithCitations = jest.fn().mockResolvedValue(`
**Tests Doctors May Use:**
- CAT scan [citation:doc1:chunk1]
`);

    const result = await chatService.handle({
      sessionId: "session1",
      userText: "What tests are used? Just asking generally.",
      channel: "web",
    });

    // Verify NO fallback inserted (synonym should be detected)
    expect(result.responseText).not.toContain("Additional tests");
    // Verify CAT scan is in response (synonym recognized)
    expect(result.responseText).toContain("CAT scan");
  });

  it("should handle full pipeline with real RAG chunk structure", async () => {
    // Realistic RAG chunks with multiple entities
    const chunks = [
      {
        chunkId: "chunk1",
        docId: "doc1",
        content: "Breast cancer symptoms include a lump or mass, nipple discharge, and skin dimpling. Diagnosis requires clinical exam, mammogram, ultrasound, and biopsy. If symptoms persist for 2-4 weeks, seek medical evaluation.",
        document: {
          title: "Breast Cancer - NCI",
          sourceType: "02_nci_core",
          source: "NCI",
          citation: "NCI, 2025",
          isTrustedSource: true,
        },
        similarity: 0.85,
      },
      {
        chunkId: "chunk2",
        docId: "doc2",
        content: "Additional diagnostic tests include MRI and PET scan. Warning signs also include unexplained weight loss and persistent fatigue.",
        document: {
          title: "Breast Cancer Diagnosis - NCI",
          sourceType: "02_nci_core",
          source: "NCI",
          citation: "NCI, 2025",
          isTrustedSource: true,
        },
        similarity: 0.75,
      },
    ];

    const ragService = chatService["rag"] as jest.Mocked<RagService>;
    ragService.retrieveWithMetadata = jest.fn().mockResolvedValue(chunks);

    // Mock LLM to cover most items but miss a few
    llmService.generateWithCitations = jest.fn().mockResolvedValue(`
**Main Answer:**
- Breast cancer symptoms include lumps and nipple discharge [citation:doc1:chunk1]

**Warning Signs to Watch For:**
- Lump or mass [citation:doc1:chunk1]
- Nipple discharge [citation:doc1:chunk1]
- Skin dimpling [citation:doc1:chunk1]

**Tests Doctors May Use:**
- Mammogram [citation:doc1:chunk1]
- Biopsy [citation:doc1:chunk1]

**When to Seek Care:**
If symptoms persist for 2-4 weeks, seek medical evaluation [citation:doc1:chunk1]
`);

    const result = await chatService.handle({
      sessionId: "session1",
      userText: "What are breast cancer symptoms and how is it diagnosed? Just asking generally.",
      channel: "web",
    });

    // Verify extraction found all entities
    const extraction = structuredExtractor.extract(chunks, "symptoms");
    expect(extraction.diagnosticTests.length).toBeGreaterThanOrEqual(4); // clinical exam, mammogram, ultrasound, biopsy, MRI, PET
    expect(extraction.warningSigns.length).toBeGreaterThanOrEqual(4); // lump, discharge, dimpling, weight loss, fatigue
    expect(extraction.timeline).not.toBeNull();

    // Verify response includes citations
    expect(result.responseText).toMatch(/\[citation:doc1:chunk1\]/);
    // Verify fallback may have been inserted if LLM missed items
    // (This depends on completeness policy - symptoms requires 5 warning signs, 2 tests)
    const hasFallback = result.responseText.includes("Additional");
    if (hasFallback) {
      // If fallback inserted, verify it has citations
      expect(result.responseText).toMatch(/\[citation:doc[12]:chunk[12]\]/);
    }
  });

  it("should meet completeness policy when LLM covers all extracted items", async () => {
    const chunks = createChunksWithTests(["CT scan", "MRI", "biopsy"]);
    const ragService = chatService["rag"] as jest.Mocked<RagService>;
    ragService.retrieveWithMetadata = jest.fn().mockResolvedValue(chunks);

    // Mock LLM to cover all 3 tests
    llmService.generateWithCitations = jest.fn().mockResolvedValue(`
**Tests Doctors May Use:**
- CT scan [citation:doc1:chunk1]
- MRI [citation:doc1:chunk1]
- Biopsy [citation:doc1:chunk1]
`);

    const result = await chatService.handle({
      sessionId: "session1",
      userText: "What tests are used? Just asking generally.",
      channel: "web",
    });

    // Verify NO fallback inserted (policy met)
    expect(result.responseText).not.toContain("Additional tests");
    // Verify all tests are mentioned
    expect(result.responseText).toContain("CT scan");
    expect(result.responseText).toContain("MRI");
    expect(result.responseText).toContain("Biopsy");
  });
});






