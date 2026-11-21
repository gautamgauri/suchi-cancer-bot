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
 * Issue #136 — regression for the answer-first (definitional) gate.
 *
 * Daily web QA run 2026-09-13T04-00-12_seed1789272008, q04 [myth] (hi):
 *   "लोग कहते हैं कि बायोप्सी कराने से कैंसर फैल जाता है। क्या यह सच है?"
 * came back as a two-sentence definition of a biopsy plus a clarifying
 * question, never addressing the claim. That is exactly the output contract of
 * `LlmService.generateDefinitionalResponse` — the query was routed to the
 * answer-first path because every gate condition happened to hold
 * (mode=explain, intent=INFORMATIONAL_GENERAL, 6 chunks, avg similarity
 * 0.429 ≥ 0.40, no structured-response pattern). A claim-verification question
 * must go to the full explain path instead.
 *
 * Fixtures mirror the production payload: the six retrievedChunks similarities
 * from the run, and chunk content shaped like the NCI PDQ glossary sentence the
 * reply paraphrased. Retrieval quality itself is out of scope here.
 */

const Q04_HI = "लोग कहते हैं कि बायोप्सी कराने से कैंसर फैल जाता है। क्या यह सच है?";
const Q04_PROD_SIMILARITIES = [0.456, 0.435, 0.43, 0.429, 0.428, 0.396];
// Subjectless form flagged in the #137 review: "kya sach hai ki ..." with no
// यह/ये subject and no postposed क्या.
const SUBJECTLESS_HI = "\u0915\u094D\u092F\u093E \u0938\u091A \u0939\u0948 \u0915\u093F \u092C\u093E\u092F\u094B\u092A\u094D\u0938\u0940 \u0915\u0930\u093E\u0928\u0947 \u0938\u0947 \u0915\u0948\u0902\u0938\u0930 \u092B\u0948\u0932 \u091C\u093E\u0924\u093E \u0939\u0948?";

const DEFINITIONAL_REPLY = "DEFINITIONAL [citation:doc0:doc0::chunk::0] [citation:doc1:doc1::chunk::1]";
const FULL_EXPLAIN_REPLY = "FULL_EXPLAIN [citation:doc0:doc0::chunk::0] [citation:doc1:doc1::chunk::1]";

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

async function buildService(opts: { userContext: string | null; chunks: any[] }) {
  const mockPrisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        id: "session1",
        createdAt: new Date(),
        channel: "web",
        locale: "en",
        userType: null,
        status: "active",
        userContext: opts.userContext,
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
        userContext: opts.userContext,
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
    messageCitation: { create: jest.fn(), createMany: jest.fn() },
    safetyEvent: { create: jest.fn() },
  };

  const llm = {
    generateWithCitations: jest.fn().mockResolvedValue(FULL_EXPLAIN_REPLY),
    generateDefinitionalResponse: jest.fn().mockResolvedValue(DEFINITIONAL_REPLY),
  };

  const abstention = {
    hasUrgencyIndicators: jest.fn().mockReturnValue(false),
    generateAbstentionMessage: jest.fn(),
    generateSafeFallbackResponse: jest.fn(),
  };

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
          retrieveWithMetadata: jest.fn().mockResolvedValue(opts.chunks),
          retrieveWithExpansion: jest.fn().mockResolvedValue(opts.chunks),
          applyPatientStateFilter: (chunks: any[]) => chunks,
        },
      },
      { provide: LlmService, useValue: llm },
      {
        provide: EvidenceGateService,
        useValue: {
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
      { provide: AbstentionService, useValue: abstention },
      // Real rule-based classifier: the production intent for q04 was
      // INFORMATIONAL_GENERAL regardless of userContext (verified 2026-09-13).
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
          extractContextFromMessage: jest.fn().mockResolvedValue({
            context: opts.userContext,
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
      { provide: PatientStateService, useValue: new PatientStateService() },
      { provide: CrossLingualService, useValue: new CrossLingualService() },
      { provide: OutputVerifierService, useValue: new OutputVerifierService() },
      { provide: ClinicalKeywordEnforcerService, useValue: { enforce: (text: string) => text } },
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

  return { service: module.get<ChatService>(ChatService), llm };
}

describe("Answer-first definitional gate — claim-verification questions (issue #136)", () => {
  it("q04 [myth] (hi): the biopsy-spreads-cancer question must NOT take the answer-first definitional path", async () => {
    // "Prefer not to say" role in the run → no userContext on the session.
    const { service, llm } = await buildService({ userContext: null, chunks: makeChunks(Q04_PROD_SIMILARITIES) });

    const result = await service.handle({ sessionId: "session1", userText: Q04_HI, channel: "web" } as any);

    expect(llm.generateDefinitionalResponse).not.toHaveBeenCalled();
    expect(llm.generateWithCitations).toHaveBeenCalledTimes(1);
    expect(result.responseText).toContain("FULL_EXPLAIN");

    // The full explain path must still see the original Devanagari question
    // (language routing is unchanged: the reply was correctly in Hindi).
    const [systemPrompt, , userMessage] = llm.generateWithCitations.mock.calls[0];
    expect(systemPrompt).toBe("explain");
    expect(userMessage).toBe(Q04_HI);
  });

  it("subjectless Hindi truth check (#137 review): \u0915\u094D\u092F\u093E \u0938\u091A \u0939\u0948 \u0915\u093F \u2026 must also skip the definitional path", async () => {
    // Same evidence and gate conditions as q04, but with the hearsay clause
    // dropped — the form Codex flagged as still reaching the definitional path.
    const { service, llm } = await buildService({ userContext: null, chunks: makeChunks(Q04_PROD_SIMILARITIES) });

    const result = await service.handle({
      sessionId: "session1",
      userText: SUBJECTLESS_HI,
      channel: "web",
    } as any);

    expect(llm.generateDefinitionalResponse).not.toHaveBeenCalled();
    expect(llm.generateWithCitations).toHaveBeenCalledTimes(1);
    expect(result.responseText).toContain("FULL_EXPLAIN");

    const [systemPrompt, , userMessage] = llm.generateWithCitations.mock.calls[0];
    expect(systemPrompt).toBe("explain");
    expect(userMessage).toBe(SUBJECTLESS_HI);
  });

  it("control: a plain definitional question with the same evidence still takes the answer-first path", async () => {
    const { service, llm } = await buildService({ userContext: "general", chunks: makeChunks(Q04_PROD_SIMILARITIES) });

    await service.handle({ sessionId: "session1", userText: "What is a biopsy?", channel: "web" } as any);

    expect(llm.generateDefinitionalResponse).toHaveBeenCalledTimes(1);
    expect(llm.generateWithCitations).not.toHaveBeenCalled();
  });
});
