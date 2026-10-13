import { Logger } from "@nestjs/common";
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
 * A failed DB write must never withhold an emergency / safety / crisis reply.
 *
 * These branches used to persist with a bare prisma.message.create /
 * safetyEvent.create; a Cloud SQL blip or exhausted pool threw out of
 * handle() and the patient got a 500 instead of emergency numbers. They now
 * retry (prismaRetry) and, if the write still fails, log and return the
 * template with messageId undefined. analytics.emit failures are absorbed
 * inside AnalyticsService, so they cannot fail a turn either.
 */
describe("ChatService — safety replies survive persistence failures", () => {
  let chatService: ChatService;

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

  const dbDown = () => Promise.reject(Object.assign(new Error("Can't reach database server"), { code: "P1001" }));

  let prisma: any;
  let safety: any;
  let empathy: any;
  let llmGenerate: jest.Mock;
  let ragRetrieve: jest.Mock;
  let errorLog: jest.SpyInstance;

  beforeEach(async () => {
    errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([SESSION]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      session: { findUnique: jest.fn().mockResolvedValue(SESSION), update: jest.fn() },
      message: {
        // User message stores fine; every assistant write fails.
        create: jest.fn().mockImplementation((args: any) =>
          args.data.role === "assistant"
            ? dbDown()
            : Promise.resolve({ id: "user-msg", ...args.data, createdAt: new Date() }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      messageCitation: { create: jest.fn(), createMany: jest.fn().mockImplementation(dbDown) },
      safetyEvent: { create: jest.fn().mockImplementation(dbDown) },
      analyticsEvent: { create: jest.fn().mockImplementation(dbDown) },
    };
    const realSafety = new SafetyService();
    safety = { evaluate: jest.fn((t: string) => realSafety.evaluate(t)) };
    empathy = {
      detectEmotionalTone: jest.fn().mockResolvedValue({ tone: "urgent" }),
      detectMentalHealthNeed: jest
        .fn()
        .mockReturnValue({ needsSupport: false, isCrisis: false, category: null, keywords: [] }),
    };
    llmGenerate = jest.fn().mockResolvedValue(RAG_ANSWER);
    ragRetrieve = jest.fn().mockResolvedValue([CHUNK]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        // Real AnalyticsService over the failing prisma mock: emit() must absorb it.
        { provide: AnalyticsService, useValue: new AnalyticsService(prisma as any) },
        // Real safety + abstention: this test must exercise the production
        // urgent path, not a stubbed approximation of it.
        { provide: SafetyService, useValue: safety },
        { provide: AbstentionService, useValue: new AbstentionService() },
        {
          provide: RagService,
          useValue: {
            retrieveWithMetadata: ragRetrieve,
            retrieveWithExpansion: jest.fn().mockResolvedValue([CHUNK]),
          },
        },
        {
          provide: LlmService,
          useValue: {
            generateWithCitations: llmGenerate,
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
          useValue: empathy,
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

  afterEach(() => jest.restoreAllMocks());

  const turn = (userText: string) =>
    chatService.handle({ sessionId: "test-session", userText, channel: "web", locale: "en" } as any);

  it("emergency fast path: returns the emergency template when message + safetyEvent writes fail", async () => {
    const result: any = await turn("I am coughing up blood right now");

    expect(result.safety.classification).toBe("red_flag");
    expect(result.safety.actions).toContain("show_emergency_banner");
    expect(result.responseText).toMatch(/112|108/);
    expect(result.safety.bannerText).toBe(result.responseText);
    expect(result.messageId).toBeUndefined();
    expect(prisma.safetyEvent.create).toHaveBeenCalled(); // attempted; audit trail is best-effort
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("[safety-persist] emergencyFastPath"));
  });

  it("emergency fast path still answers when even the USER message cannot be stored", async () => {
    prisma.message.create.mockImplementation(dbDown);
    const result: any = await turn("I am coughing up blood right now");

    expect(result.safety.actions).toContain("show_emergency_banner");
    expect(result.responseText).toMatch(/112|108/);
  });

  it("safety-classifier template: returned when the writes fail", async () => {
    safety.evaluate.mockReturnValue({
      classification: "self_harm",
      rulesFired: ["self_harm_intent"],
      actions: ["show_crisis_resources"],
      responseText: "Please reach out now — call Tele-MANAS 14416.",
    });
    const result: any = await turn("please help");

    expect(result.safety.classification).toBe("self_harm");
    expect(result.responseText).toContain("Tele-MANAS 14416");
    expect(result.safety.bannerText).toBe(result.responseText);
    expect(result.messageId).toBeUndefined();
  });

  it("S2 urgency with RAG: escalation + answer returned when persistAssistantMessage fails", async () => {
    const result: any = await turn("my father is rapidly worsening since yesterday");

    expect(result.safety.classification).toBe("red_flag");
    expect(result.safety.bannerText).toContain("112");
    expect(result.responseText.startsWith(result.safety.bannerText)).toBe(true);
    expect(result.responseText).toContain("Educational answer");
    expect(result.messageId).toBeUndefined();
  });

  it("S2 urgency template-only (no RAG): returned, and the awaited analytics.emit failure does not reject", async () => {
    ragRetrieve.mockResolvedValue([]);
    const result: any = await turn("my father is rapidly worsening since yesterday");

    expect(result.safety.classification).toBe("red_flag");
    expect(result.safety.actions).toContain("show_emergency_banner");
    expect(result.responseText.length).toBeGreaterThan(0);
    expect(prisma.analyticsEvent.create).toHaveBeenCalled();
  });

  it("mental-health crisis: MH1 returned when message + safetyEvent writes fail", async () => {
    empathy.detectMentalHealthNeed.mockReturnValue({
      needsSupport: true,
      isCrisis: true,
      category: "crisis",
      keywords: ["no reason to live"],
    });
    empathy.detectEmotionalTone.mockResolvedValue({ tone: "sad" });
    const result: any = await turn("I feel so tired of everything today");

    expect(result.safety.classification).toBe("mental_health_crisis");
    expect(result.responseText).toBe(
      ResponseTemplates.MH1({ isFirstMessage: true, userText: "I feel so tired of everything today", locale: "en" } as any),
    );
    expect(result.messageId).toBeUndefined();
  });

  it("an ordinary turn whose user message cannot be stored still fails (unchanged contract)", async () => {
    prisma.message.create.mockImplementation(dbDown);
    await expect(turn("what is chemotherapy?")).rejects.toThrow("Can't reach database server");
  });
});
