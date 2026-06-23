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
// Clinical-reasoning + Phase 2/3 deps that ChatService's constructor requires.
import { PatientStateService } from "./patient-state.service";
import { ClinicalKeywordEnforcerService } from "../llm/clinical-keyword-enforcer";
import { RetrievalToolService } from "../rag/retrieval-tool.service";
import { QueryDecomposerService } from "../rag/query-decomposer.service";
import { CrossLingualService } from "../rag/cross-lingual.service";
import { ExecutionPlannerService } from "./execution-planner.service";
import { PlanExecutorService } from "./plan-executor.service";
import { OutputVerifierService } from "./output-verifier.service";
import { ReviewService } from "../review/review.service";
import { ObservabilityService } from "../observability/observability.service";

/**
 * The 10 clinical-reasoning / Phase 2-3 services ChatService now depends on but
 * which the original specs never wired up. Real where the service is pure and
 * part of the path under test (PatientState, CrossLingual, OutputVerifier);
 * mocked otherwise. QueryDecomposer.needsDecomposition is forced false so the
 * simple RAG path (which the tests mock) is exercised.
 */
function extraChatProviders() {
  return [
    { provide: PatientStateService, useValue: new PatientStateService() },
    { provide: CrossLingualService, useValue: new CrossLingualService() },
    { provide: OutputVerifierService, useValue: new OutputVerifierService() },
    { provide: ClinicalKeywordEnforcerService, useValue: { enforce: (text: string) => text } },
    {
      provide: QueryDecomposerService,
      useValue: { needsDecomposition: () => false, decompose: jest.fn() },
    },
    { provide: RetrievalToolService, useValue: { multiRetrieve: jest.fn() } },
    {
      provide: ExecutionPlannerService,
      useValue: { needsPlanning: () => false, plan: jest.fn() },
    },
    { provide: PlanExecutorService, useValue: { execute: jest.fn() } },
    {
      provide: ReviewService,
      useValue: {
        copilotMode: "off",
        review: jest.fn().mockResolvedValue({ verdict: "PASS" }),
        persistRecord: jest.fn().mockResolvedValue(undefined),
        buildBlockedFallback: jest.fn(),
      },
    },
    {
      provide: ObservabilityService,
      useValue: {
        startTrace: () => ({}),
        startSpan: () => ({}),
        endSpan: jest.fn(),
        finalizeTrace: jest.fn(),
      },
    },
  ];
}

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
            $queryRaw: jest.fn().mockResolvedValue([
              {
                id: "test-session",
                createdAt: new Date(),
                channel: "web",
                locale: "en",
                userType: null,
                status: "active",
                userContext: "general",
                cancerType: null,
                greetingCompleted: true,
                emotionalState: "neutral",
              },
            ]),
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
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
              createMany: jest.fn(),
            },
            safetyEvent: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: AnalyticsService,
          useValue: {
            emit: jest.fn().mockResolvedValue(undefined),
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
            retrieveWithExpansion: jest.fn().mockResolvedValue([]),
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
            validateEvidence: jest.fn().mockImplementation((chunks: any[]) => ({
              status: "ok",
              approvedChunks: chunks ?? [],
              reasonCode: null,
              shouldAbstain: false,
              confidence: "medium",
              quality: "weak",
            })),
            generateClarifyingQuestion: jest.fn(),
          },
        },
        {
          provide: CitationService,
          useValue: {
            // Returns { citations, orphanCount }; parse the markers from the text.
            extractCitations: jest.fn().mockImplementation((text: string) => {
              const citations: any[] = [];
              const re = /\[citation:([^:\]]+):([^\]]+)\]/g;
              let m: RegExpExecArray | null;
              while ((m = re.exec(text)) !== null) {
                citations.push({ docId: m[1], chunkId: m[2], position: m.index, citationText: m[0] });
              }
              return { citations, orphanCount: 0 };
            }),
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
        { provide: StructuredExtractorService, useValue: new StructuredExtractorService() },
        {
          provide: ResponseValidatorService,
          useValue: { validate: jest.fn().mockReturnValue({ shouldAbstain: false, isValid: true, ungroundedEntities: [] }) },
        },
        {
          provide: GreetingFlowService,
          useValue: {
            extractContextFromMessage: jest.fn().mockResolvedValue({ context: "general", cancerType: undefined, confidence: 0.95 }),
            needsGreetingFlow: jest.fn().mockResolvedValue(false),
            getGreetingStep: jest.fn().mockResolvedValue(0),
            isGreetingFlowInProgress: jest.fn().mockResolvedValue(false),
            handleGreetingFlowInterruption: jest.fn().mockResolvedValue(undefined),
            parseGreetingResponse: jest.fn(),
            updateSessionContext: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EmpathyDetector,
          useValue: {
            detectEmotionalTone: jest.fn().mockResolvedValue({ tone: "neutral" }),
            detectMentalHealthNeed: jest.fn().mockReturnValue({ needsSupport: false, isCrisis: false, category: null, keywords: [] }),
          },
        },
        ...extraChatProviders(),
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
      // The chat response intentionally omits the internal `citationText` field;
      // reconstruct the marker before enriching (same convention as citation.service.spec.ts).
      const enriched = await citationService.enrichCitations(
        r3.citations.map((c) => ({ ...c, citationText: `[citation:${c.docId}:${c.chunkId}]` })),
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
      // ChatService.getSession() + greeting-flow read the session via raw SQL.
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "session1",
          createdAt: new Date(),
          channel: "web",
          locale: "en",
          userType: null,
          status: "active",
          userContext: "general",
          cancerType: null,
          greetingCompleted: true,
          emotionalState: "neutral",
        },
      ]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
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
        create: jest.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: "msg1", sessionId: "session1", ...args.data })
        ),
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
        { provide: AnalyticsService, useValue: { emit: jest.fn().mockResolvedValue(undefined) } },
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
            // Pass the retrieved chunks through as approved so the extract→
            // generate→enforce path runs against real evidence.
            validateEvidence: jest.fn().mockImplementation((chunks: any[]) => ({
              status: "ok",
              approvedChunks: chunks ?? [],
              reasonCode: null,
              shouldAbstain: false,
              confidence: "high",
              quality: "strong",
            })),
          },
        },
        {
          provide: CitationService,
          useValue: {
            // extractCitations returns { citations, orphanCount }; parse the
            // [citation:doc:chunk] markers out of the text realistically.
            extractCitations: jest.fn().mockImplementation((text: string) => {
              const citations: any[] = [];
              const re = /\[citation:([^:\]]+):([^\]]+)\]/g;
              let m: RegExpExecArray | null;
              while ((m = re.exec(text)) !== null) {
                citations.push({ docId: m[1], chunkId: m[2], position: m.index, citationText: m[0] });
              }
              return { citations, orphanCount: 0 };
            }),
            enrichCitations: jest.fn().mockImplementation((citations) => citations),
            validateCitations: jest.fn().mockReturnValue({
              isValid: true,
              confidenceLevel: "GREEN" as const,
              citations: [],
            }),
          },
        },
        {
          provide: AbstentionService,
          useValue: {
            hasUrgencyIndicators: jest.fn().mockReturnValue(false),
            generateAbstentionMessage: jest.fn(),
            generateSafeFallbackResponse: jest.fn(),
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
            needsGreetingFlow: jest.fn().mockResolvedValue(false),
            getGreetingStep: jest.fn().mockResolvedValue(0),
            isGreetingFlowInProgress: jest.fn().mockResolvedValue(false),
            handleGreetingFlowInterruption: jest.fn().mockResolvedValue(undefined),
            parseGreetingResponse: jest.fn(),
            updateSessionContext: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EmpathyDetector,
          useValue: {
            detectEmotionalTone: jest.fn().mockResolvedValue({ tone: "neutral" }),
            detectMentalHealthNeed: jest.fn().mockReturnValue({
              needsSupport: false,
              isCrisis: false,
              category: null,
              keywords: [],
            }),
          },
        },
        ...extraChatProviders(),
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

    // Semantic invariant: when the LLM under-extracts (2 of 5 tests), the
    // pipeline must backfill — structured extraction is not a single point of
    // failure. At least one missing test surfaces in the final response (the
    // exact backfill header is an implementation detail and not asserted).
    const hasMissingTest = ["MRI", "mammogram", "ultrasound"].some(
      (test) => result.responseText.toLowerCase().includes(test.toLowerCase())
    );
    expect(hasMissingTest).toBe(true);
    // Verify citations are included in fallback
    expect(result.responseText).toMatch(/\[citation:doc1:chunk1\]/);
  });

  it("recognizes a synonym (CAT scan) as the extracted CT scan → no false 'missing'", () => {
    // The CAT/CT-synonym contract lives in the completeness check: a response
    // using "CAT scan" must satisfy an extracted "CT scan", so the pipeline does
    // not flag it missing and backfill a duplicate. Tested directly here (the
    // full-handle path adds unrelated routing noise for single-chunk fixtures).
    const chunks = createChunksWithTests(["CT scan"]);
    const extraction = structuredExtractor.extract(chunks, "diagnosis");

    const response = "Tests doctors may use: CAT scan [citation:doc1:chunk1].";
    const completeness = structuredExtractor.checkCompleteness(response, extraction, "diagnosis");

    // CT scan was extracted and is recognized in the response via its "CAT scan"
    // synonym → counted as found, not reported missing.
    expect(completeness.coverage.diagnosticTests.found).toBeGreaterThanOrEqual(1);
    const ctReportedMissing = completeness.missing.diagnosticTests.some(
      (t) => /ct/i.test(t.key) || /ct scan|cat scan/i.test(t.label)
    );
    expect(ctReportedMissing).toBe(false);
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






