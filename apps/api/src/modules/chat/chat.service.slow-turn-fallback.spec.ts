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

/**
 * Regression: a turn that runs out of request budget *before* RAG must not be
 * answered with the S2 urgent-escalation template (issue #94).
 *
 * Production incident (2026-09-06, WhatsApp): a user sent "Hii" / "Hi" / "Hey" /
 * "Hello" back-to-back. "Hii" is not matched by `GreetingDetector` (its patterns
 * only accept exactly hi/hello/hey), so it fell through to the full pipeline.
 * Under four concurrent turns on one session the pre-RAG phase burned the 30s
 * budget, and the budget-exhaustion branch in `chat.service` returned
 * `ResponseTemplates.S2` — "Please seek emergency medical care now… 112/108/102"
 * — stored with `safetyClassification: "normal"`. A patient who typed a greeting
 * was told to call an ambulance.
 *
 * Nothing in the safety module was involved: `safety.evaluate`,
 * `evaluateEmergencyFastPath` and `abstention.hasUrgencyIndicators` (all real in
 * this spec) return "normal"/no-match for the greeting. The escalation text came
 * from a timeout fallback that had no relationship to the user's text.
 */
describe("ChatService — slow-turn fallback must not escalate (issue #94)", () => {
  let chatService: ChatService;
  let prisma: any;
  let empathy: any;

  /** Virtual clock offset in ms, applied on top of the real clock. */
  let clockOffset = 0;
  let dateNowSpy: jest.SpyInstance;

  const SESSION = {
    id: "test-session",
    createdAt: new Date(),
    channel: "whatsapp",
    locale: "en",
    userType: null,
    status: "active",
    userContext: "general",
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };

  beforeEach(async () => {
    clockOffset = 0;
    const realNow = Date.now.bind(Date);
    dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);

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
        // Real safety + abstention: the point of the test is that neither of them
        // classifies the input as urgent.
        { provide: SafetyService, useValue: new SafetyService() },
        { provide: AbstentionService, useValue: new AbstentionService() },
        {
          provide: RagService,
          useValue: {
            retrieveWithMetadata: jest.fn().mockResolvedValue([]),
            retrieveWithExpansion: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: LlmService,
          useValue: {
            generateWithCitations: jest.fn().mockResolvedValue("Some grounded text."),
            generateRaw: jest.fn().mockResolvedValue("Some grounded text."),
          },
        },
        {
          provide: EvidenceGateService,
          useValue: {
            validateEvidence: jest.fn().mockReturnValue({
              status: "abstain",
              approvedChunks: [],
              reasonCode: "no_evidence",
              shouldAbstain: true,
              confidence: "low",
              quality: "weak",
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
        // Real intent classifier + template selector, so the escalation branch of
        // the urgency guard test is exercised by production code, not a stub.
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
            // The pre-RAG phase this test slows down. In production the same
            // stall came from Prisma-pool contention + LLM latency while four
            // WhatsApp turns ran concurrently on one session.
            detectEmotionalTone: jest.fn().mockResolvedValue({ tone: "neutral" }),
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
    prisma = module.get<PrismaService>(PrismaService);
    empathy = module.get<EmpathyDetector>(EmpathyDetector);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    jest.clearAllMocks();
  });

  /** Burn 31s of virtual time inside the pre-RAG phase (budget guard trips at 30s). */
  function stallPreRagPhase(ms = 31_000) {
    (empathy.detectEmotionalTone as jest.Mock).mockImplementation(async () => {
      clockOffset += ms;
      return { tone: "neutral" };
    });
  }

  it("'Hii' is not recognised as a greeting, so it reaches the general pipeline", () => {
    // Documents the pre-condition of the incident: a one-character typo drops the
    // message out of the fast greeting path and into the full (slow) pipeline.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GreetingDetector } = require("./greeting-detector");
    expect(GreetingDetector.isGreeting("Hi")).toBe(true);
    expect(GreetingDetector.isGreeting("Hii")).toBe(false);
  });

  it("does not tell a user who typed a greeting to seek emergency care when the turn runs out of budget", async () => {
    stallPreRagPhase();

    const result = await chatService.handle({
      sessionId: "test-session",
      userText: "Hii",
      channel: "whatsapp",
      locale: "en",
    } as any);

    // The turn did time out on the pre-RAG budget guard...
    expect((result as any).error).toBe("budget_exhausted_before_rag");

    // ...but the reply must not be an emergency escalation.
    expect(result.responseText).not.toMatch(/seek emergency medical care/i);
    expect(result.responseText).not.toMatch(/could be urgent/i);
    expect(result.responseText).not.toMatch(/\b(112|108|102)\b/);
    expect(result.responseText).not.toMatch(/ambulance/i);

    // It should say plainly that Suchi could not answer this time.
    expect(result.responseText).toMatch(/trouble accessing reliable sources/i);
    expect(result.safety.classification).toBe("normal");

    // And no safety event should have been recorded for a plain greeting.
    expect(prisma.safetyEvent.create).not.toHaveBeenCalled();
  });

  it("still escalates when the text genuinely contains urgency indicators", async () => {
    // Guard against 'fixing' the timeout fallback by weakening escalation:
    // an urgent message must keep getting the S2 template.
    const result = await chatService.handle({
      sessionId: "test-session",
      userText: "my father is rapidly worsening since yesterday",
      channel: "whatsapp",
      locale: "en",
    } as any);

    expect(result.responseText).toMatch(/seek emergency medical care now/i);
    expect(result.responseText).toMatch(/\b112\b/);
  });
});
