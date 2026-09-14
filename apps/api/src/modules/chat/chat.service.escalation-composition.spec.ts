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
 * Regression: an escalated reply must not append an answer that contradicts the
 * escalation (issue #112).
 *
 * Observed on live prod (browser QA run 2026-09-10T19-02-52, q05, messageId
 * f35aa46a): the escalation told the patient to call 112/108 now, and the
 * appended half said "…it does not typically require an emergency call to 112
 * or 108 unless you have other severe, life-threatening symptoms." The defect
 * is non-deterministic — a re-run of the same question escalated cleanly — so
 * the RAG half is stubbed here to make the contradiction deterministic.
 *
 * No patient text is reproduced: the user question below is synthetic.
 */
describe("ChatService — escalated replies cannot contradict the escalation (issue #112)", () => {
  let module: TestingModule;
  let chatService: ChatService;
  let llm: any;

  const CONTRADICTION =
    "While a new lump is concerning and needs evaluation, it does not typically require an emergency call to 112 or 108 unless you have other severe, life-threatening symptoms.";

  const CONTRADICTING_RAG_HALF = `**Educational answer**:
A new lump should be checked by a doctor.

**What to do next**:
It's important to see a doctor promptly for any new or unusual breast changes. ${CONTRADICTION}`;

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
    module = await Test.createTestingModule({
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
        // Real safety + abstention: the urgent path must be reached by production
        // classification, not by a stub that forces it.
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
            generateWithCitations: jest.fn().mockResolvedValue(CONTRADICTING_RAG_HALF),
            generateRaw: jest.fn().mockResolvedValue(CONTRADICTING_RAG_HALF),
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
    llm = module.get<LlmService>(LlmService);
  });

  afterEach(() => jest.clearAllMocks());

  const urgentTurn = () =>
    chatService.handle({
      sessionId: "test-session",
      userText: "my father is rapidly worsening since yesterday",
      channel: "web",
      locale: "en",
    } as any);

  it("delivers the escalation unchanged", async () => {
    const result = await urgentTurn();

    expect(result.safety.classification).toBe("red_flag");
    expect(result.safety.actions).toContain("show_emergency_banner");
    expect(result.responseText).toContain("Please seek emergency medical care now.");
    expect(result.responseText).toContain("**112** (national emergency number) or **108** (ambulance service)");
  });

  it("does not deliver the contradicting sentence the LLM produced", async () => {
    const result = await urgentTurn();

    // The stub really did emit it...
    expect(await (llm.generateWithCitations as jest.Mock).mock.results[0].value).toContain(CONTRADICTION);
    // ...and it must not reach the patient.
    expect(result.responseText).not.toContain(CONTRADICTION);
    expect(result.responseText).not.toContain("does not typically require an emergency call");
  });

  it("keeps the non-conflicting part of the appended answer", async () => {
    const result = await urgentTurn();

    expect(result.responseText).toContain("**Information from trusted sources:**");
    expect(result.responseText).toContain("A new lump should be checked by a doctor.");
    expect(result.responseText).toContain("see a doctor promptly");
  });

  it("leaves the emergency numbers to the escalation and the standard disclaimer", async () => {
    const result = await urgentTurn();

    const [escalationHalf, rest] = result.responseText.split(
      "\n\n**Information from trusted sources:**\n\n"
    );
    // Trim the machine-appended tail: citation markers and the emergency
    // disclaimer (safety copy, which legitimately repeats 112/108).
    const generatedHalf = rest.split("\n\n**Sources:**")[0].split("\n\n---")[0];

    expect(escalationHalf).toMatch(/\b112\b/);
    expect(generatedHalf).not.toMatch(/\b(?:112|108|102)\b/);
  });

  it("falls back to the escalation alone when the whole appended half was triage talk", async () => {
    (llm.generateWithCitations as jest.Mock).mockResolvedValue(
      "This is not an emergency. You do not need to call 112 or 108."
    );

    const result = await urgentTurn();

    expect(result.responseText).toContain("Please seek emergency medical care now.");
    expect(result.responseText).not.toContain("You do not need to call");
    // No empty "trusted sources" section left dangling.
    expect(result.responseText).not.toContain("**Information from trusted sources:**");
    expect(result.safety.classification).toBe("red_flag");
  });
});
