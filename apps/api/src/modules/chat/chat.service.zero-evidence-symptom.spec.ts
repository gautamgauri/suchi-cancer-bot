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
import { ModeDetector } from "./mode-detector";
import { ResponseTemplates } from "./response-templates";

/**
 * Regression: issue #166 — symptom guidance returned with zero retrieved chunks
 * and zero citations.
 *
 * The Navigate-Mode soft redirect for PERSONAL_SYMPTOMS deliberately uses no KB
 * content (FR-JOURNEY-003), yet it had the LLM free-write symptom guidance ("many
 * possible causes… see a doctor soon…", with the model deciding on its own
 * whether the symptom sounded urgent). Whatever it produced was, by
 * construction, medical guidance without KB backing — the one thing CLAUDE.md
 * says must never ship. It also reported `retrievedChunks: []` regardless of
 * what retrieval found, so the payload looked like a retrieval miss.
 *
 * These tests pin:
 *  - no free-generated symptom guidance on that path (English + Hinglish);
 *  - the existing no-medical-content fallback is delivered instead, with an
 *    explicit abstention reason;
 *  - the zero-chunk hard evidence gate keeps abstaining;
 *  - red-flag escalation and the emergency fast path still go out with zero
 *    chunks.
 *
 * All user text is synthetic.
 */
describe("ChatService — zero-evidence symptom guidance (issue #166)", () => {
  let chatService: ChatService;
  let llm: { generate: jest.Mock; generateWithCitations: jest.Mock; generateRaw: jest.Mock; generateDefinitionalResponse: jest.Mock };
  let rag: { retrieveWithMetadata: jest.Mock; retrieveWithExpansion: jest.Mock; applyPatientStateFilter: jest.Mock };
  let analytics: { emit: jest.Mock };

  const abstention = new AbstentionService();
  const realGate = new EvidenceGateService({} as any);

  /** Distinctive marker so the test can tell model-written text apart. */
  const MODEL_WRITTEN =
    "UNGROUNDED_MODEL_TEXT: this symptom has many possible causes. Please see a doctor soon.";

  const SESSION = {
    id: "test-session",
    createdAt: new Date(),
    channel: "web",
    locale: "en",
    userType: null,
    status: "active",
    // Fresh web session: no greeting-flow context yet. (A "general" context
    // would reroute cancer-keyword turns to INFORMATIONAL_GENERAL.)
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };

  const CHUNK = {
    id: "chunk-1",
    docId: "doc-1",
    chunkId: "chunk-1",
    content: "Synthetic KB passage about seeing a doctor for new symptoms.",
    text: "Synthetic KB passage about seeing a doctor for new symptoms.",
    similarity: 0.9,
    document: { sourceType: "NCI", isTrustedSource: true, title: "Synthetic" },
  };

  const OK_GATE = {
    status: "ok",
    approvedChunks: [CHUNK],
    reasonCode: null,
    shouldAbstain: false,
    confidence: "high",
    quality: "strong",
  };

  async function build(retrieved: any[]) {
    llm = {
      generate: jest.fn().mockResolvedValue(MODEL_WRITTEN),
      generateWithCitations: jest.fn().mockResolvedValue(MODEL_WRITTEN),
      generateRaw: jest.fn().mockResolvedValue(MODEL_WRITTEN),
      generateDefinitionalResponse: jest.fn().mockResolvedValue(MODEL_WRITTEN),
    };
    rag = {
      retrieveWithMetadata: jest.fn().mockResolvedValue(retrieved),
      retrieveWithExpansion: jest.fn().mockResolvedValue(retrieved),
      applyPatientStateFilter: jest.fn().mockImplementation((chunks: any[]) => chunks),
    };
    analytics = { emit: jest.fn().mockResolvedValue(undefined) };

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
              count: jest.fn().mockResolvedValue(3),
            },
            messageCitation: { create: jest.fn(), createMany: jest.fn() },
            safetyEvent: { create: jest.fn().mockResolvedValue({}) },
          },
        },
        { provide: AnalyticsService, useValue: analytics },
        // Real safety + abstention: the red-flag and emergency assertions below
        // must exercise the production paths, not stubs.
        { provide: SafetyService, useValue: new SafetyService() },
        { provide: AbstentionService, useValue: abstention },
        { provide: RagService, useValue: rag },
        { provide: LlmService, useValue: llm },
        {
          provide: EvidenceGateService,
          useValue: {
            // Zero chunks -> the real gate (it returns before touching Prisma).
            // Non-empty -> "ok", i.e. the gate let the turn through.
            validateEvidence: jest.fn().mockImplementation((chunks: any[], ...rest: any[]) =>
              chunks.length === 0
                ? realGate.validateEvidence(chunks, ...(rest as [any, any, any, any]))
                : Promise.resolve(OK_GATE),
            ),
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
  }

  const turn = (userText: string, channel: "web" | "voice" = "web") =>
    chatService.handle({ sessionId: "test-session", userText, channel, locale: "en" } as any);

  /** The existing, no-medical-content fallback text (no new wording). */
  const SAFE_FALLBACK_OPENING =
    "I don't have enough specific information in my knowledge base to answer this accurately.";

  afterEach(() => jest.clearAllMocks());

  // Synthetic personal-symptom questions, English and Hinglish, that route to
  // Navigate Mode + PERSONAL_SYMPTOMS without tripping any urgency pattern.
  const PERSONAL_SYMPTOM_TURNS: Array<[string, string]> = [
    ["English", "how do I know if I have cancer"],
    ["Hinglish", "mujhe pet mein dard ho raha hai"],
  ];

  describe("Navigate-Mode PERSONAL_SYMPTOMS soft redirect", () => {
    it.each(PERSONAL_SYMPTOM_TURNS)("precondition — %s turn routes to navigate/PERSONAL_SYMPTOMS", (_l, text) => {
      expect(ModeDetector.detectMode(text)).toBe("navigate");
      const intent = new IntentClassifier(new AbstentionService()).classify(
        text,
        [CHUNK] as any,
        OK_GATE as any,
        "normal",
      ).intent;
      expect(intent).toBe("PERSONAL_SYMPTOMS");
      expect(abstention.hasUrgencyIndicators(text)).toBe(false);
    });

    it.each(PERSONAL_SYMPTOM_TURNS)(
      "%s: never ships model-written symptom guidance with no KB backing",
      async (_l, text) => {
        await build([CHUNK]);
        const result: any = await turn(text);

        expect(llm.generate).not.toHaveBeenCalled();
        expect(result.responseText).not.toContain("UNGROUNDED_MODEL_TEXT");
        expect(result.citations ?? []).toHaveLength(0);
        expect(result.safety.classification).toBe("normal");
      },
    );

    it.each(PERSONAL_SYMPTOM_TURNS)(
      "%s: delivers the existing no-medical-content fallback with an explicit abstention reason",
      async (_l, text) => {
        await build([CHUNK]);
        const result: any = await turn(text);

        expect(result.responseText.startsWith(SAFE_FALLBACK_OPENING)).toBe(true);
        expect(result.abstentionReason).toBe("PERSONAL_SYMPTOM_NO_KB_BACKING");
      },
    );

    it("does not fall back to the unreviewed navigateModeFrame template either", async () => {
      await build([CHUNK]);
      llm.generate.mockRejectedValue(new Error("llm down"));
      const text = "how do I know if I have cancer";
      const result: any = await turn(text);

      expect(result.responseText).not.toContain(ResponseTemplates.navigateModeFrame(text).split("\n")[0]);
      expect(result.responseText.startsWith(SAFE_FALLBACK_OPENING)).toBe(true);
    });

    it("reports what retrieval actually found instead of a hard-coded empty list", async () => {
      await build([CHUNK]);
      const result: any = await turn("how do I know if I have cancer");

      // The reply is not built from these chunks (no citations), but the payload
      // must not disguise an abstention as a retrieval miss.
      expect(result.retrievedChunks).toHaveLength(1);
      expect(result.retrievedChunks[0].chunkId).toBe("chunk-1");
    });

    it("emits an abstention_response analytics event so the canary can see it", async () => {
      await build([CHUNK]);
      await turn("mujhe pet mein dard ho raha hai");

      const events = analytics.emit.mock.calls.map((c: any[]) => c[0]);
      expect(events).toContain("abstention_response");
      const payload = analytics.emit.mock.calls.find((c: any[]) => c[0] === "abstention_response")![1];
      expect(payload.reason).toBe("PERSONAL_SYMPTOM_NO_KB_BACKING");
      expect(payload.intent).toBe("PERSONAL_SYMPTOMS");
    });
  });

  describe("zero retrieved chunks", () => {
    it.each(PERSONAL_SYMPTOM_TURNS)(
      "%s: the hard evidence gate still abstains with NO_RESULTS and no LLM call",
      async (_l, text) => {
        await build([]);
        const result: any = await turn(text);

        expect(llm.generate).not.toHaveBeenCalled();
        expect(llm.generateWithCitations).not.toHaveBeenCalled();
        expect(result.responseText.startsWith(SAFE_FALLBACK_OPENING)).toBe(true);
        expect(result.abstentionReason).toBe("NO_RESULTS");
        expect(result.citations ?? []).toHaveLength(0);
      },
    );

    it("red-flag symptom still escalates (S2, 112) with zero chunks and no model text", async () => {
      await build([]);
      const result: any = await turn("I have a lump and severe pain in my stomach");

      expect(result.safety.classification).toBe("red_flag");
      expect(result.safety.actions).toContain("show_emergency_banner");
      expect(result.responseText).toContain("112");
      expect(result.responseText).not.toContain("UNGROUNDED_MODEL_TEXT");
      expect(result.responseText.startsWith(SAFE_FALLBACK_OPENING)).toBe(false);
    });

    it("emergency fast path still goes out with zero chunks", async () => {
      await build([]);
      const result: any = await turn("I am coughing up blood right now");

      expect(result.safety.classification).toBe("red_flag");
      expect(result.safety.actions).toContain("show_emergency_banner");
      expect(rag.retrieveWithMetadata).not.toHaveBeenCalled();
      expect(llm.generate).not.toHaveBeenCalled();
    });
  });
});
