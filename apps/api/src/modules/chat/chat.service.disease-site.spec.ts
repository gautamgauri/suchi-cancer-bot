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
 * Issue #170 — the WhatsApp tester reuses one conversation, and earlier turns in
 * it were about lung cancer, so the session carried `cancerType = "lung"`. A
 * later Hindi question about MOUTH cancer was then retrieved with the stale
 * `lung` tag (the non-identify retrieval path passed `session.cancerType`
 * straight through, and the detector could not read "मुँह के कैंसर" anyway), and
 * lung evidence answered it.
 *
 * All LLM / RAG / DB dependencies are mocked; these tests pin the control flow:
 * which cancer type retrieval is given, and which evidence reaches generation.
 * Synthetic question text only.
 */

const ORAL_QUESTION_HI = "तंबाकू छोड़ने के बाद मुँह के कैंसर का जोखिम कितना रहता है?";

const chunk = (docId: string, chunkId: string, title: string) => ({
  docId,
  chunkId,
  content: `Synthetic evidence text for ${title}.`,
  similarity: 0.8,
  vecSim: 0.8,
  document: { title, url: `https://example.com/${docId}`, source: "NCI", sourceType: "02_nci_core", citation: "NCI", isTrustedSource: true },
});

const LUNG_1 = chunk("lung-prev", "lung-prev::1", "Lung Cancer Prevention (PDQ®) - NCI");
const LUNG_2 = chunk("nsclc", "nsclc::4", "Non-Small Cell Lung Cancer Treatment (PDQ®) - NCI");
const BLADDER = chunk("bladder", "bladder::2", "Bladder Cancer Causes & Risk Factors");
const ORAL = chunk("oral-prev", "oral-prev::3", "Oral Cavity, Oropharynx, Hypopharynx, & Larynx Cancer Prevention (PDQ®) - NCI");

function session(cancerType: string | null) {
  return {
    id: "wa-session",
    createdAt: new Date(),
    channel: "whatsapp",
    locale: "hi",
    userType: null,
    status: "active",
    userContext: "general",
    cancerType,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
}

async function buildService(opts: { sessionCancerType: string | null; chunks: any[] }) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([session(opts.sessionCancerType)]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    session: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    message: {
      create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: "m1", ...args.data, createdAt: new Date() })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(3),
    },
    messageCitation: { create: jest.fn(), createMany: jest.fn() },
    safetyEvent: { create: jest.fn() },
  };
  const rag = {
    retrieveWithExpansion: jest.fn().mockResolvedValue(opts.chunks),
    retrieveWithMetadata: jest.fn().mockResolvedValue(opts.chunks),
    applyPatientStateFilter: jest.fn().mockImplementation((chunks: any[]) => chunks),
  };
  const llm = {
    generateWithCitations: jest
      .fn()
      .mockImplementation((_m: any, _s: any, _u: any, chunks: any[]) =>
        Promise.resolve(`Answer ${chunks.map((c: any) => `[citation:${c.docId}:${c.chunkId}]`).join(" ")}`)
      ),
    generate: jest.fn().mockResolvedValue("Soft redirect text"),
  };
  const evidenceGate = {
    validateEvidence: jest.fn().mockImplementation((chunks: any[]) =>
      chunks && chunks.length > 0
        ? { status: "ok", approvedChunks: chunks, reasonCode: null, shouldAbstain: false, confidence: "medium", quality: "strong" }
        : { status: "insufficient", approvedChunks: [], reasonCode: "NO_RESULTS", shouldAbstain: true, confidence: "low", quality: "insufficient" }
    ),
    generateClarifyingQuestion: jest.fn(),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChatService,
      { provide: PrismaService, useValue: prisma },
      { provide: AnalyticsService, useValue: { emit: jest.fn().mockResolvedValue(undefined) } },
      { provide: SafetyService, useValue: new SafetyService() },
      { provide: RagService, useValue: rag },
      { provide: LlmService, useValue: llm },
      { provide: EvidenceGateService, useValue: evidenceGate },
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

  return { chat: module.get<ChatService>(ChatService), rag, llm };
}

/** Every chunk list any generation call was handed. */
function chunksSentToLlm(llm: any): any[] {
  return llm.generateWithCitations.mock.calls.flatMap((c: any[]) => (Array.isArray(c[3]) ? c[3] : []));
}

/** The cancer type passed to every retrieval call. */
function retrievalCancerTypes(rag: any): Array<string | null | undefined> {
  return [
    ...rag.retrieveWithMetadata.mock.calls.map((c: any[]) => c[2]),
    ...rag.retrieveWithExpansion.mock.calls.map((c: any[]) => c[2]),
  ];
}

describe("ChatService.handle — the asked disease site is not substituted (#170)", () => {
  it("retrieval for a Hindi mouth-cancer question on a lung-tagged session is steered to 'oral', never 'lung'", async () => {
    const { chat, rag } = await buildService({ sessionCancerType: "lung", chunks: [ORAL] });
    await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "hi", userText: ORAL_QUESTION_HI });

    const types = retrievalCancerTypes(rag);
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) {
      expect(t).toBe("oral");
    }
  });

  it("lung and bladder chunks never reach generation for the mouth-cancer question; the oral chunk does", async () => {
    const { chat, llm } = await buildService({ sessionCancerType: "lung", chunks: [LUNG_1, BLADDER, ORAL, LUNG_2] });
    await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "hi", userText: ORAL_QUESTION_HI });

    const sent = chunksSentToLlm(llm);
    expect(sent.map((c) => c.chunkId)).toContain("oral-prev::3");
    expect(sent.map((c) => c.docId)).not.toEqual(expect.arrayContaining(["lung-prev"]));
    expect(sent.map((c) => c.docId)).not.toEqual(expect.arrayContaining(["nsclc"]));
    expect(sent.map((c) => c.docId)).not.toEqual(expect.arrayContaining(["bladder"]));
  });

  it("safe failure: when retrieval returns only lung evidence, no lung text is composed into the answer", async () => {
    const { chat, llm } = await buildService({ sessionCancerType: "lung", chunks: [LUNG_1, LUNG_2] });
    const result = await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "hi", userText: ORAL_QUESTION_HI });

    expect(chunksSentToLlm(llm)).toEqual([]);
    expect(result.responseText).not.toMatch(/lung|फेफड़/i);
  });

  it("unchanged: a message that names no site still falls back to the session's cancer type", async () => {
    const { chat, rag } = await buildService({ sessionCancerType: "lung", chunks: [LUNG_1] });
    await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "en", userText: "What side effects can chemotherapy have?" });

    const types = retrievalCancerTypes(rag);
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) {
      expect(t).toBe("lung");
    }
  });
});
