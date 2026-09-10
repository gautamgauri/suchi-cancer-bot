import { Test, TestingModule } from "@nestjs/testing";
import { ChatService, ESCALATION_RAG_SEPARATOR } from "./chat.service";
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
import { ResponseTemplates } from "./response-templates";

/**
 * Regression: the chat response must expose the escalation block on its own, so
 * the web emergency banner can render *only* that block (issue #111).
 *
 * Live browser QA on 2026-09-10 (run `2026-09-10T19-02-52`, q05) found the
 * banner being handed the entire ~3,000-character reply and rendering it as
 * plain text. DOM proof from the same message:
 *
 *   banner : literal_asterisks=true,  <strong>=0, <em>=0
 *   bubble : literal_asterisks=false, <strong>=8, <em>=1
 *
 * The escalation copy is unchanged by this fix — `bannerText` is a byte-exact
 * prefix of `responseText`.
 */
describe("ChatService — escalation banner text (issue #111)", () => {
  let chatService: ChatService;

  /** The half the LLM contributes on the urgent path. */
  const RAG_ANSWER =
    "**Educational answer**:\nA new lump should be *evaluated* by a doctor within a few days.";

  const SESSION = {
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
  };

  const CHUNK = {
    id: "chunk-1",
    docId: "doc-1",
    chunkId: "chunk-1",
    text: "A new breast lump should be evaluated by a clinician.",
    similarity: 0.9,
    document: { sourceType: "NCI", isTrustedSource: true, title: "Breast changes" },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([SESSION]),
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
            session: { findUnique: jest.fn().mockResolvedValue(SESSION), update: jest.fn() },
            message: {
              create: jest.fn().mockImplementation((args: any) =>
                Promise.resolve({ id: "msg-1", ...args.data, createdAt: new Date() }),
              ),
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
            messageCitation: { create: jest.fn(), createMany: jest.fn() },
            safetyEvent: { create: jest.fn().mockResolvedValue({}) },
          },
        },
        { provide: AnalyticsService, useValue: { emit: jest.fn().mockResolvedValue(undefined) } },
        // Real safety + abstention: this test must exercise the production
        // urgent path, not a stubbed approximation of it.
        { provide: SafetyService, useValue: new SafetyService() },
        { provide: AbstentionService, useValue: new AbstentionService() },
        {
          provide: RagService,
          useValue: {
            retrieveWithMetadata: jest.fn().mockResolvedValue([CHUNK]),
            retrieveWithExpansion: jest.fn().mockResolvedValue([CHUNK]),
          },
        },
        {
          provide: LlmService,
          useValue: {
            generateWithCitations: jest.fn().mockResolvedValue(RAG_ANSWER),
            generateRaw: jest.fn().mockResolvedValue(RAG_ANSWER),
          },
        },
        {
          provide: EvidenceGateService,
          useValue: {
            validateEvidence: jest.fn().mockReturnValue({
              status: "ok",
              approvedChunks: [CHUNK],
              reasonCode: null,
              shouldAbstain: false,
              confidence: "high",
              quality: "strong",
            }),
            generateClarifyingQuestion: jest.fn(),
          },
        },
        {
          provide: CitationService,
          useValue: {
            extractCitations: jest.fn().mockReturnValue({ citations: [], orphanCount: 0 }),
            validateCitations: jest
              .fn()
              .mockReturnValue({ isValid: true, confidenceLevel: "GREEN", citations: [], citationDensity: 0 }),
            enrichCitations: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: IntentClassifier, useValue: new IntentClassifier(new AbstentionService()) },
        {
          provide: TemplateSelector,
          useValue: new TemplateSelector(new IntentClassifier(new AbstentionService())),
        },
        { provide: StructuredExtractorService, useValue: new StructuredExtractorService() },
        {
          provide: ResponseValidatorService,
          useValue: { validate: jest.fn().mockReturnValue({ shouldAbstain: false, isValid: true, ungroundedEntities: [] }) },
        },
        {
          provide: GreetingFlowService,
          useValue: {
            extractContextFromMessage: jest
              .fn()
              .mockResolvedValue({ context: undefined, cancerType: undefined, confidence: 0 }),
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
            detectEmotionalTone: jest.fn().mockResolvedValue({ tone: "urgent" }),
            detectMentalHealthNeed: jest
              .fn()
              .mockReturnValue({ needsSupport: false, isCrisis: false, category: null, keywords: [] }),
          },
        },
        { provide: PatientStateService, useValue: new PatientStateService() },
        { provide: CrossLingualService, useValue: new CrossLingualService() },
        { provide: OutputVerifierService, useValue: new OutputVerifierService() },
        { provide: ClinicalKeywordEnforcerService, useValue: { enforce: (t: string) => t } },
        { provide: QueryDecomposerService, useValue: { needsDecomposition: () => false, decompose: jest.fn() } },
        { provide: RetrievalToolService, useValue: { multiRetrieve: jest.fn() } },
        { provide: ExecutionPlannerService, useValue: { needsPlanning: () => false, plan: jest.fn() } },
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
      ],
    }).compile();

    chatService = module.get<ChatService>(ChatService);
  });

  afterEach(() => jest.clearAllMocks());

  const urgentTurn = () =>
    chatService.handle({
      sessionId: "test-session",
      userText: "my father is rapidly worsening since yesterday",
      channel: "web",
      locale: "en",
    } as any);

  it("still escalates and still appends the trusted-sources half", async () => {
    const result = await urgentTurn();

    expect(result.safety.classification).toBe("red_flag");
    expect(result.safety.actions).toContain("show_emergency_banner");
    expect(result.responseText).toContain(ESCALATION_RAG_SEPARATOR.trim());
    expect(result.responseText).toContain("Educational answer");
  });

  it("returns bannerText holding the escalation block alone", async () => {
    const result = await urgentTurn();
    const bannerText = (result.safety as any).bannerText as string;

    expect(bannerText).toBeTruthy();
    expect(bannerText).toContain("seek emergency medical care now");
    expect(bannerText).toContain("112");
    // The appended answer must not be repeated in the banner.
    expect(bannerText).not.toContain("Educational answer");
    expect(bannerText).not.toContain("Information from trusted sources");
  });

  it("keeps the escalation copy byte-identical to the S2 template", async () => {
    const result = await urgentTurn();
    const bannerText = (result.safety as any).bannerText as string;

    // Nothing is reworded: bannerText is exactly the S2 template, and exactly
    // the prefix of the delivered response.
    expect(bannerText).toBe(ResponseTemplates.S2({ isFirstMessage: true } as any));
    expect(result.responseText.startsWith(bannerText)).toBe(true);
  });

  it("sets bannerText on the emergency fast path too", async () => {
    const result = await chatService.handle({
      sessionId: "test-session",
      userText: "I am coughing up blood right now",
      channel: "web",
      locale: "en",
    } as any);

    expect(result.safety.actions).toContain("show_emergency_banner");
    expect((result.safety as any).bannerText).toBe(result.responseText);
  });
});
