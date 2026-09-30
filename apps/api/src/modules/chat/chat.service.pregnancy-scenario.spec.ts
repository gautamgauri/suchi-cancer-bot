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
 * Issue #126 — the retrieval half is fixed (the pregnancy document ranks first),
 * but the answer still carried a lactation bullet in 3/3 runs because chunk ::35
 * holds `### Lactation` + `### Fetal Consequences…` and generation was handed
 * the whole chunk. These tests pin the wiring: for a pregnancy question that
 * does not ask about breastfeeding, the lactation section never reaches
 * `generateWithCitations`; for a genuine breastfeeding question it does.
 * Synthetic question and chunk text only.
 */

const PREGNANCY_Q = "meri bhabhi pregnant hai, kya chemo ki dawai se bachche ko nuksaan hoga?";
const BREASTFEEDING_Q = "kya chemotherapy ke dauraan breastfeeding karna safe hai?";
const LACTATION_TERMS = /lactation|breast\s*milk|breast-?feed|nursing/i;

const TITLE = "Breast Cancer Treatment During Pregnancy (PDQ®) - NCI";
const chunk = (chunkId: string, content: string) => ({
  docId: chunkId.split("::")[0],
  chunkId,
  content,
  similarity: 0.7,
  vecSim: 0.7,
  document: { title: TITLE, url: "https://example.com/preg", source: "NCI", sourceType: "02_nci_core", citation: "NCI", isTrustedSource: true },
});

const CHEMO = chunk(
  "preg::18",
  "### Chemotherapy\n\nSynthetic sentence about chemotherapy timing across trimesters and outcomes for the newborn.\n"
);
const SPECIAL = chunk(
  "preg::35",
  "## Special Considerations for Pregnancy and Breast Cancer\n\n### Lactation\n\nSynthetic sentence: some anticancer drugs pass into breast milk and could affect a nursing baby.\n\n### Fetal Consequences of Maternal Breast Cancer\n\nSynthetic sentence about effects on the fetus.\n"
);

function session() {
  return {
    id: "wa-session",
    createdAt: new Date(),
    channel: "whatsapp",
    locale: "hi",
    userType: null,
    status: "active",
    userContext: "caregiver",
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
}

async function buildService(chunks: any[]) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([session()]),
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
    retrieveWithExpansion: jest.fn().mockResolvedValue(chunks),
    retrieveWithMetadata: jest.fn().mockResolvedValue(chunks),
    applyPatientStateFilter: jest.fn().mockImplementation((c: any[]) => c),
  };
  const llm = {
    generateWithCitations: jest
      .fn()
      .mockImplementation((_m: any, _s: any, _u: any, c: any[]) =>
        Promise.resolve(`Answer ${c.map((x: any) => `[citation:${x.docId}:${x.chunkId}]`).join(" ")}`)
      ),
    generate: jest.fn().mockResolvedValue("Soft redirect text"),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChatService,
      { provide: PrismaService, useValue: prisma },
      { provide: AnalyticsService, useValue: { emit: jest.fn().mockResolvedValue(undefined) } },
      { provide: SafetyService, useValue: new SafetyService() },
      { provide: RagService, useValue: rag },
      { provide: LlmService, useValue: llm },
      {
        provide: EvidenceGateService,
        useValue: {
          validateEvidence: jest.fn().mockImplementation((c: any[]) =>
            c && c.length > 0
              ? { status: "ok", approvedChunks: c, reasonCode: null, shouldAbstain: false, confidence: "medium", quality: "strong" }
              : { status: "insufficient", approvedChunks: [], reasonCode: "NO_RESULTS", shouldAbstain: true, confidence: "low", quality: "insufficient" }
          ),
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

  return { chat: module.get<ChatService>(ChatService), llm };
}

function chunksSentToLlm(llm: any): any[] {
  return llm.generateWithCitations.mock.calls.flatMap((c: any[]) => (Array.isArray(c[3]) ? c[3] : []));
}

describe("ChatService.handle — pregnancy question is not answered with lactation guidance (#126)", () => {
  it("the lactation section never reaches generation; the chemotherapy and fetal sections do", async () => {
    const { chat, llm } = await buildService([CHEMO, SPECIAL]);
    await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "hi", userText: PREGNANCY_Q });

    const sent = chunksSentToLlm(llm);
    expect(sent.length).toBeGreaterThan(0);
    for (const c of sent) {
      expect(c.content).not.toMatch(LACTATION_TERMS);
    }
    expect(sent.map((c) => c.chunkId)).toEqual(expect.arrayContaining(["preg::18", "preg::35"]));
    expect(sent.find((c) => c.chunkId === "preg::35").content).toMatch(/Fetal Consequences/);
  });

  it("control: a genuine breastfeeding question still gets the lactation section", async () => {
    const { chat, llm } = await buildService([SPECIAL, CHEMO]);
    await chat.handle({ sessionId: "wa-session", channel: "whatsapp", locale: "hi", userText: BREASTFEEDING_Q });

    const sent = chunksSentToLlm(llm);
    expect(sent.find((c) => c.chunkId === "preg::35")?.content).toMatch(/### Lactation/);
  });
});
