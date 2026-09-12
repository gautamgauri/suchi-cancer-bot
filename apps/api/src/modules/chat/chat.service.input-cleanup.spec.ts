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
 * Issue #115 — Phase 0 input cleanup must follow the input MODALITY, not the
 * channel: speech-recognition output gets stutter/repeat/filler removal, typed
 * text on any channel (WhatsApp, web) only gets medical-spelling normalisation.
 * The texts below are the tester's own messages as quoted in the issue (no
 * patient data).
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

async function buildService(opts: { channel: string }) {
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
    retrieveWithMetadata: jest.fn().mockResolvedValue(CHUNKS),
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

describe("ChatService.handle — Phase 0 input cleanup by modality (#115)", () => {
  function persistedUserText(prisma: any): string {
    return prisma.message.create.mock.calls.map((c: any) => c[0].data).find((d: any) => d.role === "user").text;
  }

  it("WhatsApp (typed): keeps the caregiver's words intact — 'didi' is not collapsed to 'di'", async () => {
    const { chat, prisma, rag } = await buildService({ channel: "whatsapp" });
    await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "en", userText: HINGLISH_RED_FLAG });

    // Persisted user turn and the retrieval query both see the original text.
    expect(persistedUserText(prisma)).toBe(HINGLISH_RED_FLAG);
    expect(persistedUserText(prisma)).toContain("meri didi");
    for (const call of rag.retrieveWithMetadata.mock.calls) {
      expect(call[0]).not.toMatch(/\bmeri di\b/);
    }
  });

  it("web (typed): also left intact — web is typed input too (review on #121)", async () => {
    const { chat, prisma } = await buildService({ channel: "web" });
    await chat.handle({ sessionId: "wa-session", channel: "web", locale: "en", userText: "mere papa ko bahut bahut dard hai, didi ke saath hospital gaye" });
    expect(persistedUserText(prisma)).toBe("mere papa ko bahut bahut dard hai, didi ke saath hospital gaye");
  });

  it("web (typed): medical-spelling normalisation still applies to typed text", async () => {
    const { chat, prisma } = await buildService({ channel: "web" });
    await chat.handle({ sessionId: "wa-session", channel: "web", locale: "en", userText: "what is keemo therapy" });
    expect(persistedUserText(prisma)).toMatch(/chemo/i);
    expect(persistedUserText(prisma)).not.toMatch(/keemo/i);
  });

  it("web + inputMode 'voice' (browser mic): speech-stutter cleanup runs", async () => {
    const { chat, prisma } = await buildService({ channel: "web" });
    await chat.handle({ sessionId: "wa-session", channel: "web", locale: "en", inputMode: "voice", userText: "telltell me about chemo chemo" });
    expect(persistedUserText(prisma)).toBe("tell me about chemo");
  });

  it("voice channel: speech-stutter cleanup runs regardless of inputMode", async () => {
    const { chat, prisma } = await buildService({ channel: "voice" });
    await chat.handle({ sessionId: "wa-session", channel: "voice", locale: "en", userText: "um tell me about chemo" });
    expect(persistedUserText(prisma)).toBe("tell me about chemo");
  });

  it("rule layer: neither Hinglish text trips the emergency fast path, safety rules or urgency guard (the #81 coverage gap — documented, not fixed here)", async () => {
    const { chat, prisma } = await buildService({ channel: "whatsapp" });
    for (const text of [HINGLISH_BENIGN, HINGLISH_RED_FLAG]) {
      prisma.safetyEvent.create.mockClear();
      const result = await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "en", userText: text });
      // No rule-based escalation fired: no SafetyEvent row, and the reply is not red-flag classified.
      expect(prisma.safetyEvent.create).not.toHaveBeenCalled();
      expect(result.safety.classification).toBe("normal");
    }
  });
});
