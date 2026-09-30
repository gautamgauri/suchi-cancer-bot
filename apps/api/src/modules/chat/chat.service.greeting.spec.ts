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
 * The interactive greeting questionnaire (step 1/2 prompts, "Getting started
 * X of 2") was removed: it never ran in production because handleTurn
 * persists the user message before the old `messageCount === 0` check. These
 * tests pin what live traffic actually gets:
 *
 *  (a) a bare greeting returns the one-line G1 greeting on the first turn and
 *      G2 afterwards, with no LLM or retrieval call;
 *  (b) a later non-greeting message with no extractable context no longer
 *      forces Session.userContext to "general" (the old interruption handler
 *      did, which steered IntentClassifier on following turns);
 *  (c) silent context / cancer-type extraction from normal messages still
 *      writes to the session.
 */

const G1 =
  "Hi. I'm Suchi, the Suchitra Cancer Bot. How can I help today?\n\nIs this about symptoms, a report, treatment side effects, or finding care?";
const G2 = "Hi again. How can I help—symptoms, a report, treatment side effects, or finding care?";

const CHUNKS = [
  {
    docId: "doc1",
    chunkId: "chunk1",
    content: "Doctors can give medicines and other treatments to help with tiredness.",
    document: { title: "Fatigue - NCI", url: "https://example.com/a", source: "NCI", sourceType: "02_nci_core", citation: "NCI, 2025" },
  },
];

function session() {
  // A live session as it looks before this change on turn 2: greeting never
  // marked complete, no context extracted yet.
  return {
    id: "s1",
    createdAt: new Date(),
    channel: "web",
    locale: "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: false,
    emotionalState: null,
  };
}

async function buildService(opts: { assistantTurns: number }) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([session()]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    session: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    message: {
      create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: "m1", ...args.data, createdAt: new Date() })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(opts.assistantTurns),
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
      // Real selector: the greeting text asserted below is the production G1/G2.
      { provide: TemplateSelector, useFactory: (i: IntentClassifier) => new TemplateSelector(i), inject: [IntentClassifier] },
      { provide: StructuredExtractorService, useValue: new StructuredExtractorService() },
      { provide: ResponseValidatorService, useValue: { validate: jest.fn().mockReturnValue({ shouldAbstain: false, isValid: true, ungroundedEntities: [] }) } },
      // Real service: the regression below is about what it writes to Session.
      { provide: GreetingFlowService, useFactory: (p: PrismaService) => new GreetingFlowService(p), inject: [PrismaService] },
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

function sessionWrites(prisma: any): Array<{ sql: string; values: unknown[] }> {
  return prisma.$executeRawUnsafe.mock.calls
    .map((c: any[]) => ({ sql: c[0] as string, values: c.slice(1) }))
    .filter((w: { sql: string }) => w.sql.includes('UPDATE "Session"'));
}

describe("ChatService.handle — greeting after questionnaire removal", () => {
  it("(a) first-turn greeting returns the G1 greeting, no LLM or retrieval", async () => {
    const { chat, rag, llm } = await buildService({ assistantTurns: 0 });
    const result = await chat.handle({ sessionId: "s1", channel: "web", locale: "en", userText: "hi" });

    expect(result.responseText).toBe(G1);
    expect(result.safety).toEqual({ classification: "normal", actions: [] });
    expect(llm.generateWithCitations).not.toHaveBeenCalled();
    expect(rag.retrieveWithMetadata).not.toHaveBeenCalled();
  });

  it("(a) a later greeting returns G2", async () => {
    const { chat } = await buildService({ assistantTurns: 1 });
    const result = await chat.handle({ sessionId: "s1", channel: "web", locale: "en", userText: "hello" });

    expect(result.responseText).toBe(G2);
  });

  it("(b) a second non-greeting message with no extractable context does not set userContext to \"general\"", async () => {
    const { chat, prisma } = await buildService({ assistantTurns: 1 });
    await chat.handle({ sessionId: "s1", channel: "web", locale: "en", userText: "Why do people feel so tired all the time?" });

    for (const w of sessionWrites(prisma)) {
      expect(w.sql).not.toContain('"userContext"');
      expect(w.values).not.toContain("general");
      expect(w.sql).not.toContain("greetingCompleted");
      expect(w.sql).not.toContain("currentGreetingStep");
    }
  });

  it("(c) silent extraction still stores context and cancer type from a normal message", async () => {
    const { chat, prisma } = await buildService({ assistantTurns: 1 });
    await chat.handle({
      sessionId: "s1",
      channel: "web",
      locale: "en",
      userText: "My mother was told she has breast cancer, what happens next?",
    });

    const writes = sessionWrites(prisma);
    expect(writes).toContainEqual({
      sql: expect.stringContaining('"userContext" = $1, "cancerType" = $2'),
      values: expect.arrayContaining(["caregiver", "breast", "s1"]),
    });
  });
});
