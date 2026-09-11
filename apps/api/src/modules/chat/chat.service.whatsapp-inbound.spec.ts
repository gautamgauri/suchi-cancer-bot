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
import { isChatTimeoutError } from "./timeout-fallback";

/**
 * Issue #115 — what actually reaches the WhatsApp worker from `ChatService.handle`
 * for the Hinglish texts sent on the live public number (2026-09-10).
 *
 * The texts below are the tester's own messages as quoted in the issue (no
 * patient data). All LLM / RAG / DB dependencies are mocked; the point of these
 * tests is the *control flow* of `handle()` for `channel: "whatsapp"`, not the
 * answer content.
 */

const HINGLISH_BENIGN = "breast cancer ke early symptoms kya hote hain? kab tak dhyan dena chahiye";
const HINGLISH_RED_FLAG =
  "meri didi chemo ke baad se bahut kamjor hai, aaj bleeding bahut zyada ho gayi aur chakkar aa raha hai. kya karu??";

const CHUNKS = [
  {
    docId: "doc1",
    chunkId: "chunk1",
    content: "Breast cancer symptoms include lumps, nipple changes, and skin changes.",
    document: { title: "Breast Cancer Symptoms - NCI", url: "https://example.com/a", source: "NCI", sourceType: "02_nci_core", citation: "NCI, 2025" },
  },
  {
    docId: "doc2",
    chunkId: "chunk2",
    content: "Diagnosis requires clinical exam, mammogram, ultrasound, and biopsy.",
    document: { title: "Breast Cancer Diagnosis - NCI", url: "https://example.com/b", source: "NCI", sourceType: "02_nci_core", citation: "NCI, 2025" },
  },
];

function session(channel: string) {
  return {
    id: "wa-session",
    createdAt: new Date(),
    channel,
    locale: "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
}

async function buildService(opts: { channel: string; ragDelayMs?: number }) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([session(opts.channel)]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    session: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    message: {
      create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: "m1", ...args.data, createdAt: new Date() })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(3), // not the first message (mirrors the live session)
    },
    messageCitation: { create: jest.fn(), createMany: jest.fn() },
    safetyEvent: { create: jest.fn() },
  };
  const rag = {
    retrieveWithExpansion: jest.fn().mockResolvedValue(CHUNKS),
    retrieveWithMetadata: jest.fn().mockImplementation(async () => {
      if (opts.ragDelayMs) {
        // Fake-timer clock: model a slow retrieval stage without waiting for it.
        jest.advanceTimersByTime(opts.ragDelayMs);
      }
      return CHUNKS;
    }),
    applyPatientStateFilter: jest.fn().mockImplementation((chunks: any[]) => chunks),
  };
  const llm = {
    generateWithCitations: jest.fn().mockResolvedValue("Answer [citation:doc1:chunk1] [citation:doc2:chunk2]"),
    generate: jest.fn().mockResolvedValue("Soft redirect text"),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChatService,
      { provide: PrismaService, useValue: prisma },
      { provide: AnalyticsService, useValue: { emit: jest.fn().mockResolvedValue(undefined) } },
      // Real rule-based safety layer: the point is that it stays "normal" for these texts.
      { provide: SafetyService, useValue: new SafetyService() },
      { provide: RagService, useValue: rag },
      { provide: LlmService, useValue: llm },
      {
        provide: EvidenceGateService,
        useValue: {
          validateEvidence: jest.fn().mockImplementation((chunks: any[]) => ({
            status: "ok",
            approvedChunks: chunks ?? [],
            reasonCode: null,
            shouldAbstain: false,
            confidence: "medium",
            quality: "strong",
          })),
          generateClarifyingQuestion: jest.fn(),
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
            return { citations, orphanCount: 0, orphanCitations: [] };
          }),
          validateCitations: jest.fn().mockReturnValue({ isValid: true, confidenceLevel: "GREEN", citations: [], citationDensity: 0.5 }),
          enrichCitations: jest.fn().mockResolvedValue([]),
        },
      },
      // Real rule-based urgency layer + intent classifier: these are what route the live texts.
      { provide: AbstentionService, useValue: new AbstentionService() },
      { provide: IntentClassifier, useFactory: (a: AbstentionService) => new IntentClassifier(a), inject: [AbstentionService] },
      { provide: TemplateSelector, useValue: { selectAndGenerate: jest.fn().mockReturnValue({ responseText: "template", intent: "UNCLEAR_REQUEST" }) } },
      { provide: StructuredExtractorService, useValue: new StructuredExtractorService() },
      { provide: ResponseValidatorService, useValue: { validate: jest.fn().mockReturnValue({ shouldAbstain: false, isValid: true, ungroundedEntities: [] }) } },
      {
        provide: GreetingFlowService,
        useValue: {
          extractContextFromMessage: jest.fn().mockResolvedValue({ context: undefined, cancerType: undefined, confidence: 0.3 }),
          needsGreetingFlow: jest.fn().mockResolvedValue(false),
          getGreetingStep: jest.fn().mockResolvedValue(0),
          isGreetingFlowInProgress: jest.fn().mockResolvedValue(false),
          handleGreetingFlowInterruption: jest.fn().mockResolvedValue(undefined),
          parseGreetingResponse: jest.fn(),
          updateSessionContext: jest.fn().mockResolvedValue(undefined),
        },
      },
      { provide: EmpathyDetector, useValue: new EmpathyDetector() },
      { provide: PatientStateService, useValue: new PatientStateService() },
      { provide: CrossLingualService, useValue: new CrossLingualService() },
      { provide: OutputVerifierService, useValue: new OutputVerifierService() },
      { provide: ClinicalKeywordEnforcerService, useValue: { enforce: (text: string) => text } },
      { provide: QueryDecomposerService, useValue: { needsDecomposition: () => false, decompose: jest.fn() } },
      { provide: RetrievalToolService, useValue: { multiRetrieve: jest.fn(), retrieve: jest.fn() } },
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

  return { chat: module.get<ChatService>(ChatService), prisma, rag, llm };
}

describe("ChatService.handle on channel=whatsapp — Hinglish inbound (#115)", () => {
  afterEach(() => jest.useRealTimers());

  it("keeps the caregiver's typed words intact: 'didi' is not collapsed to 'di' on WhatsApp", async () => {
    const { chat, prisma, rag } = await buildService({ channel: "whatsapp" });
    await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "en", userText: HINGLISH_RED_FLAG });

    // Persisted user turn and the retrieval query both see the original text.
    const userTurn = prisma.message.create.mock.calls.map((c: any) => c[0].data).find((d: any) => d.role === "user");
    expect(userTurn.text).toBe(HINGLISH_RED_FLAG);
    expect(userTurn.text).toContain("meri didi");
    for (const call of rag.retrieveWithMetadata.mock.calls) {
      expect(call[0]).not.toMatch(/\bmeri di\b/);
    }
  });

  it("still applies the voice-stutter cleanup on the web channel (unchanged behaviour)", async () => {
    const { chat, prisma } = await buildService({ channel: "web" });
    await chat.handle({ sessionId: "wa-session", channel: "web", locale: "en", userText: "telltell me about chemo" });
    const userTurn = prisma.message.create.mock.calls.map((c: any) => c[0].data).find((d: any) => d.role === "user");
    expect(userTurn.text).toBe("tell me about chemo");
  });

  it("rule layer: neither Hinglish text trips the emergency fast path, safety rules or urgency guard (the #81 coverage gap)", async () => {
    const { chat, prisma } = await buildService({ channel: "whatsapp" });
    for (const text of [HINGLISH_BENIGN, HINGLISH_RED_FLAG]) {
      prisma.safetyEvent.create.mockClear();
      const result = await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "en", userText: text });
      // No rule-based escalation fired: no SafetyEvent row, and the reply is not red-flag classified.
      expect(prisma.safetyEvent.create).not.toHaveBeenCalled();
      expect(result.safety.classification).toBe("normal");
    }
  });

  it("REPRODUCTION: a slow pre-LLM stage makes handle() throw the 'LLM generation timeout' budget error that the WhatsApp worker used to answer with FALLBACK_REPLY", async () => {
    jest.useFakeTimers();
    // Retrieval alone eats 31s of the 45s turn budget → llmWithDeadline refuses to start
    // the generation (MIN_BUDGET_FOR_LLM_MS = 15s) and throws instead of returning.
    const { chat, llm } = await buildService({ channel: "whatsapp", ragDelayMs: 31_000 });

    await expect(
      chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "en", userText: HINGLISH_BENIGN }),
    ).rejects.toThrow(/LLM generation timeout: no budget left/);

    expect(llm.generateWithCitations).not.toHaveBeenCalled();
    // …and it is exactly the class the shared predicate (web controller + WhatsApp worker) recognises.
    await chat
      .handle({ sessionId: "wa-session", channel: "whatsapp", locale: "en", userText: HINGLISH_BENIGN })
      .catch((err) => expect(isChatTimeoutError(err)).toBe(true));
  });

  it("the same text completes normally when the pre-LLM stage is fast", async () => {
    jest.useFakeTimers();
    const { chat } = await buildService({ channel: "whatsapp", ragDelayMs: 1_000 });
    const result = await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "en", userText: HINGLISH_BENIGN });
    expect(result.responseText).toBeTruthy();
    expect(result.safety.classification).toBe("normal");
  });
});
