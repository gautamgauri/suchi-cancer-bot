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
 * Regression: a turn whose *pre-generation* stages are slow must still answer
 * the patient (issue #168).
 *
 * Production incident (2026-09-18, public WhatsApp number): two turns ended on
 *
 *   Error: LLM generation timeout: no budget left for explain-mode-llm1
 *       at ChatService.llmWithDeadline / ChatService.handle
 *       at async WhatsAppService.processOne
 *
 * The whole pipeline shares ONE wall-clock budget. Retrieval and the stages
 * around it spent enough of it that less than MIN_BUDGET_FOR_LLM_MS was left,
 * `llmWithDeadline` threw, the throw escaped `handle()`, and
 * `WhatsAppService.processOne` answered with the generic FALLBACK_REPLY — the
 * patient got nothing. Two things were wrong:
 *
 *  1. WhatsApp turns were held to the 45s budget derived from the 55s
 *     `ChatController` timeout, even though the webhook ACKs first and runs the
 *     turn detached (whatsapp.controller.ts) — no HTTP client is waiting.
 *  2. The pre-RAG budget guard degrades to a template, but exhaustion at the
 *     generation stage threw instead, with no fallback anywhere below the
 *     channel worker.
 *
 * Evidence fixtures (chunk shape, similarities, the explain-path query) are
 * borrowed from chat.service.answer-first-gate.spec.ts so this spec exercises
 * the real explain path that failed in production. Retrieval quality is out of
 * scope here; only the budget arithmetic is under test.
 */

const EXPLAIN_QUERY = "लोग कहते हैं कि बायोप्सी कराने से कैंसर फैल जाता है। क्या यह सच है?";
const PROD_SIMILARITIES = [0.456, 0.435, 0.43, 0.429, 0.428, 0.396];
const EXPLAIN_REPLY = "FULL_EXPLAIN [citation:doc0:doc0::chunk::0] [citation:doc1:doc1::chunk::1]";

function makeChunks(similarities: number[]) {
  return similarities.map((similarity, i) => ({
    chunkId: `doc${i}::chunk::${i}`,
    docId: `doc${i}`,
    content:
      "Biopsy: The removal of cells or tissues so they can be viewed under a microscope by a pathologist to check for signs of cancer.",
    document: {
      title: `Childhood Treatment Summary ${i} - NCI`,
      sourceType: "02_nci_core",
      source: "NCI",
      citation: "NCI PDQ",
      isTrustedSource: true,
    },
    similarity,
  }));
}

/** Virtual clock offset in ms, applied on top of the real clock. */
let clockOffset = 0;
let dateNowSpy: jest.SpyInstance;

async function buildService(opts: { channel: string; ragStallMs: number }) {
  const chunks = makeChunks(PROD_SIMILARITIES);

  const mockPrisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        id: "session1",
        createdAt: new Date(),
        channel: opts.channel,
        locale: "en",
        userType: null,
        status: "active",
        userContext: null,
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
        userContext: null,
      }),
      update: jest.fn(),
    },
    message: {
      create: jest
        .fn()
        .mockImplementation((args: any) => Promise.resolve({ id: "msg1", sessionId: "session1", ...args.data })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    messageCitation: { create: jest.fn(), createMany: jest.fn() },
    safetyEvent: { create: jest.fn() },
  };

  // Burn virtual time inside retrieval — i.e. *after* the pre-RAG budget guard
  // and *before* the generation stage, which is where the production turn lost
  // its budget.
  const stall = async () => {
    clockOffset += opts.ragStallMs;
    return chunks;
  };

  const llm = {
    generateWithCitations: jest.fn().mockResolvedValue(EXPLAIN_REPLY),
    generateDefinitionalResponse: jest.fn().mockResolvedValue(EXPLAIN_REPLY),
    generateRaw: jest.fn().mockResolvedValue(EXPLAIN_REPLY),
  };

  const abstention = {
    hasUrgencyIndicators: jest.fn().mockReturnValue(false),
    generateAbstentionMessage: jest.fn(),
    generateSafeFallbackResponse: jest.fn(),
  };

  const analytics = { emit: jest.fn().mockResolvedValue(undefined) };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChatService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AnalyticsService, useValue: analytics },
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
          retrieveWithMetadata: jest.fn().mockImplementation(stall),
          retrieveWithExpansion: jest.fn().mockImplementation(stall),
          applyPatientStateFilter: (c: any[]) => c,
        },
      },
      { provide: LlmService, useValue: llm },
      {
        provide: EvidenceGateService,
        useValue: {
          validateEvidence: jest.fn().mockImplementation((c: any[]) => ({
            status: "ok",
            approvedChunks: c ?? [],
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
          validateCitations: jest.fn().mockReturnValue({ isValid: true, confidenceLevel: "GREEN" as const, citations: [] }),
        },
      },
      { provide: AbstentionService, useValue: abstention },
      { provide: IntentClassifier, useValue: new IntentClassifier(abstention as any) },
      { provide: TemplateSelector, useValue: {} },
      { provide: StructuredExtractorService, useValue: new StructuredExtractorService() },
      {
        provide: ResponseValidatorService,
        useValue: { validate: jest.fn().mockReturnValue({ shouldAbstain: false, isValid: true, ungroundedEntities: [] }) },
      },
      {
        provide: GreetingFlowService,
        useValue: {
          extractContextFromMessage: jest.fn().mockResolvedValue({ context: undefined, cancerType: undefined, confidence: 0 }),
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
        useValue: { startTrace: () => ({}), startSpan: () => ({}), endSpan: jest.fn(), finalizeTrace: jest.fn() },
      },
    ],
  }).compile();

  return { service: module.get<ChatService>(ChatService), llm, analytics };
}

describe("ChatService — turn budget vs. the generation stage (issue #168)", () => {
  beforeEach(() => {
    clockOffset = 0;
    const realNow = Date.now.bind(Date);
    dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    jest.clearAllMocks();
  });

  it("WhatsApp: a 50s pre-generation phase still reaches the LLM, because no HTTP client is waiting", async () => {
    const { service, llm } = await buildService({ channel: "whatsapp", ragStallMs: 50_000 });

    const result: any = await service.handle({
      sessionId: "session1",
      userText: EXPLAIN_QUERY,
      channel: "whatsapp",
      locale: "en",
    } as any);

    // Before the fix this rejected with "no budget left for explain-mode-llm1":
    // 50s > the 45s HTTP-derived budget, so the generation stage never ran.
    expect(llm.generateWithCitations).toHaveBeenCalledTimes(1);
    expect(result.responseText).toContain("FULL_EXPLAIN");
    expect(result.error).toBeUndefined();
  });

  it("WhatsApp: an exhausted budget still yields a usable reply instead of throwing at the caller", async () => {
    // 80s of pre-generation work leaves under MIN_BUDGET_FOR_LLM_MS even on the
    // 90s async-channel budget, so the generation stage is genuinely skipped.
    const { service, llm, analytics } = await buildService({ channel: "whatsapp", ragStallMs: 80_000 });

    const result: any = await service.handle({
      sessionId: "session1",
      userText: EXPLAIN_QUERY,
      channel: "whatsapp",
      locale: "en",
    } as any);

    expect(llm.generateWithCitations).not.toHaveBeenCalled();
    expect(result.error).toBe("budget_exhausted_before_llm");

    // The patient must get the technical-failure template (A3), not the generic
    // WhatsApp FALLBACK_REPLY that an escaping throw produced.
    expect(result.responseText).toMatch(/trouble accessing reliable sources/i);
    expect(result.safety.classification).toBe("normal");

    // A technical timeout is not a clinical finding — never the S2 escalation
    // template (issue #94).
    expect(result.responseText).not.toMatch(/seek emergency medical care/i);
    expect(result.responseText).not.toMatch(/\b(112|108|102)\b/);

    // And the exhaustion must be visible in the ledger rather than an opaque error.
    expect(analytics.emit).toHaveBeenCalledWith(
      "turn_budget_exhausted",
      expect.objectContaining({ channel: "whatsapp", stage: "generation" }),
      "session1",
    );
  });

  it("web keeps the 45s budget: an HTTP client is waiting, so a 50s turn degrades instead of running the LLM", async () => {
    const { service, llm } = await buildService({ channel: "web", ragStallMs: 50_000 });

    const result: any = await service.handle({
      sessionId: "session1",
      userText: EXPLAIN_QUERY,
      channel: "web",
    } as any);

    expect(llm.generateWithCitations).not.toHaveBeenCalled();
    expect(result.error).toBe("budget_exhausted_before_llm");
    expect(result.responseText).toMatch(/trouble accessing reliable sources/i);
  });

  it("a controller abort is still surfaced to the controller, which has its own fallback", async () => {
    const { service } = await buildService({ channel: "web", ragStallMs: 50_000 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.handle({ sessionId: "session1", userText: EXPLAIN_QUERY, channel: "web" } as any, controller.signal),
    ).rejects.toThrow(/aborted/i);
  });
});
