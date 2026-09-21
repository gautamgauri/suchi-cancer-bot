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
 * Issue #162 — every reply used to carry the ENGLISH disclaimer, because the
 * global append in persistAssistantMessage() passed `undefined` for the locale
 * and omitted the user text entirely, so detectLocale() fell through to "en"
 * unconditionally.
 *
 * These tests drive the real `handle()` control flow with everything else
 * mocked. They assert only which *existing* disclaimer string comes out — no
 * disclaimer wording is defined or changed here.
 */

// A Hindi answer body, as the model would produce it for a Hindi-speaking user.
const HINDI_ANSWER =
  "कीमोथेरेपी एक ऐसा इलाज है जिसमें दवाओं की मदद से कैंसर कोशिकाओं को नष्ट किया जाता है। " +
  "इसे आमतौर पर कई चक्रों में दिया जाता है और हर चक्र के बीच शरीर को ठीक होने का समय मिलता है। " +
  "[citation:doc1:chunk1] [citation:doc2:chunk2]";

const ENGLISH_ANSWER =
  "Chemotherapy uses medicines to destroy cancer cells. It is usually given in cycles, " +
  "with recovery time between them. [citation:doc1:chunk1] [citation:doc2:chunk2]";

// Markers unique to each language's standard disclaimer (see disclaimer-engine.ts).
const EN_STANDARD = "educational purposes";
const HI_STANDARD = "शैक्षिक उद्देश्यों";
const BH_STANDARD = "जानकारी खातिर बा";
// ...and to each language's emergency disclaimer. The English marker has to be
// a phrase the emergency *template body* does not itself use.
const EN_EMERGENCY = "does not replace emergency medical care";
const HI_EMERGENCY = "आपातकालीन";

const CHUNKS = [
  {
    docId: "doc1",
    chunkId: "chunk1",
    content: "Chemotherapy uses drugs to destroy cancer cells and is given in cycles.",
    document: {
      title: "Chemotherapy - NCI",
      url: "https://example.com/a",
      source: "NCI",
      sourceType: "02_nci_core",
      citation: "NCI, 2025",
      isTrustedSource: true,
    },
    similarity: 0.8,
  },
  {
    docId: "doc2",
    chunkId: "chunk2",
    content: "Side effects of chemotherapy include fatigue, nausea and low blood counts.",
    document: {
      title: "Chemotherapy Side Effects - NCI",
      url: "https://example.com/b",
      source: "NCI",
      sourceType: "02_nci_core",
      citation: "NCI, 2025",
      isTrustedSource: true,
    },
    similarity: 0.75,
  },
];

function session(locale: string | null) {
  return {
    id: "s1",
    createdAt: new Date(),
    channel: "whatsapp",
    locale,
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
}

async function buildService(opts: { locale: string | null; answer: string }) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([session(opts.locale)]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    session: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    message: {
      create: jest
        .fn()
        .mockImplementation((args: any) =>
          Promise.resolve({ id: "m1", ...args.data, createdAt: new Date() })
        ),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(3), // not the first message
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
    generateWithCitations: jest.fn().mockResolvedValue(opts.answer),
    generate: jest.fn().mockResolvedValue(opts.answer),
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
          validateEvidence: jest.fn().mockImplementation((chunks: any[]) => ({
            status: "ok",
            approvedChunks: chunks ?? [],
            reasonCode: null,
            shouldAbstain: false,
            confidence: "medium",
            quality: "strong",
          })),
          generateClarifyingQuestion: jest.fn().mockReturnValue("Could you tell me a bit more?"),
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
              citations.push({
                docId: m[1],
                chunkId: m[2],
                position: m.index,
                citationText: m[0],
              });
            }
            return { citations, orphanCount: 0, orphanCitations: [] };
          }),
          validateCitations: jest.fn().mockReturnValue({
            isValid: true,
            confidenceLevel: "GREEN",
            citations: [],
            citationDensity: 0.5,
          }),
          enrichCitations: jest.fn().mockResolvedValue([]),
        },
      },
      { provide: AbstentionService, useValue: new AbstentionService() },
      {
        provide: IntentClassifier,
        useFactory: (a: AbstentionService) => new IntentClassifier(a),
        inject: [AbstentionService],
      },
      {
        provide: TemplateSelector,
        useValue: {
          selectAndGenerate: jest
            .fn()
            .mockReturnValue({ responseText: opts.answer, intent: "INFORMATIONAL_GENERAL" }),
        },
      },
      { provide: StructuredExtractorService, useValue: new StructuredExtractorService() },
      {
        provide: ResponseValidatorService,
        useValue: {
          validate: jest
            .fn()
            .mockReturnValue({ shouldAbstain: false, isValid: true, ungroundedEntities: [] }),
        },
      },
      {
        provide: GreetingFlowService,
        useValue: {
          extractContextFromMessage: jest
            .fn()
            .mockResolvedValue({ context: undefined, cancerType: undefined, confidence: 0.3 }),
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
      {
        provide: QueryDecomposerService,
        useValue: { needsDecomposition: () => false, decompose: jest.fn() },
      },
      {
        provide: RetrievalToolService,
        useValue: { multiRetrieve: jest.fn(), retrieve: jest.fn() },
      },
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

  return { chat: module.get<ChatService>(ChatService), prisma, rag, llm };
}

/**
 * The disclaimer engine always appends its block last, after a "\n---\n" rule.
 * Assert on that block alone: some paths also prepend an English "**Important:**"
 * preamble from the template layer, which is not what this issue is about.
 */
function trailingDisclaimer(text: string): string {
  const i = text.lastIndexOf("\n---\n");
  expect(i).toBeGreaterThan(-1);
  return text.slice(i);
}

describe("ChatService.handle — disclaimer language (#162)", () => {
  it("Devanagari question, Hindi answer: the disclaimer is Hindi, not English", async () => {
    const { chat } = await buildService({ locale: "hi", answer: HINDI_ANSWER });

    const result = await chat.handle({
      sessionId: "s1",
      channel: "whatsapp",
      locale: "hi",
      userText: "कीमोथेरेपी क्या होती है और यह कैसे दी जाती है",
    });

    expect(trailingDisclaimer(result.responseText!)).toContain(HI_STANDARD);
    expect(trailingDisclaimer(result.responseText!)).not.toContain(EN_STANDARD);
  });

  it("romanised Hinglish question, Devanagari answer: the body's language wins (layer b)", async () => {
    // The question is Latin script, so the WhatsApp channel derives locale "en"
    // and user-script detection also yields "en" — yet the reader is looking at
    // a Devanagari answer, so the disclaimer must be Devanagari too.
    const { chat } = await buildService({ locale: "en", answer: HINDI_ANSWER });

    const result = await chat.handle({
      sessionId: "s1",
      channel: "whatsapp",
      locale: "en",
      userText: "chemotherapy kya hoti hai aur kaise di jati hai",
    });

    expect(trailingDisclaimer(result.responseText!)).toContain(HI_STANDARD);
    expect(trailingDisclaimer(result.responseText!)).not.toContain(EN_STANDARD);
  });

  it("English question, English answer: still the English disclaimer", async () => {
    const { chat } = await buildService({ locale: "en", answer: ENGLISH_ANSWER });

    const result = await chat.handle({
      sessionId: "s1",
      channel: "whatsapp",
      locale: "en",
      userText: "what is chemotherapy and how is it given",
    });

    expect(trailingDisclaimer(result.responseText!)).toContain(EN_STANDARD);
    expect(trailingDisclaimer(result.responseText!)).not.toContain(HI_STANDARD);
  });

  // The two tests below are the ones that pin layer (a) — the arguments being
  // threaded through persistAssistantMessage(). They cannot be satisfied by the
  // response body alone: an English body carries no Devanagari at all.
  it("session locale 'bh' with an English answer still gets the Bhojpuri disclaimer", async () => {
    const { chat } = await buildService({ locale: "bh", answer: ENGLISH_ANSWER });

    const result = await chat.handle({
      sessionId: "s1",
      channel: "whatsapp",
      userText: "what is chemotherapy and how is it given",
    });

    expect(trailingDisclaimer(result.responseText!)).toContain(BH_STANDARD);
    expect(trailingDisclaimer(result.responseText!)).not.toContain(EN_STANDARD);
  });

  it("Devanagari question with an English answer and no locale anywhere falls back to Hindi", async () => {
    const { chat } = await buildService({ locale: null, answer: ENGLISH_ANSWER });

    const result = await chat.handle({
      sessionId: "s1",
      channel: "whatsapp",
      userText: "कीमोथेरेपी क्या होती है और यह कैसे दी जाती है",
    });

    expect(trailingDisclaimer(result.responseText!)).toContain(HI_STANDARD);
    expect(trailingDisclaimer(result.responseText!)).not.toContain(EN_STANDARD);
  });

  // A WhatsApp contact keeps one Session for the whole TTL, and Session.locale
  // is written once when it is minted — whatsapp.service.ts re-detects the
  // language of every message but refreshes only WhatsAppContact.locale. So a
  // session opened in Hindi still reads locale "hi" on a later English turn,
  // and the turn's own locale has to outrank it.
  describe("a session that opened in Hindi and switched to English", () => {
    it("takes the English disclaimer for an English answer", async () => {
      const { chat } = await buildService({ locale: "hi", answer: ENGLISH_ANSWER });

      const result = await chat.handle({
        sessionId: "s1",
        channel: "whatsapp",
        locale: "en",
        userText: "what is chemotherapy and how is it given",
      });

      expect(trailingDisclaimer(result.responseText!)).toContain(EN_STANDARD);
      expect(trailingDisclaimer(result.responseText!)).not.toContain(HI_STANDARD);
    });

    it("still takes the Hindi disclaimer when the answer comes back in Devanagari", async () => {
      // The request locale is "en" but the body is not: the body wins, exactly
      // as it does for romanised Hinglish. Preferring the turn's locale must
      // not undo that.
      const { chat } = await buildService({ locale: "hi", answer: HINDI_ANSWER });

      const result = await chat.handle({
        sessionId: "s1",
        channel: "whatsapp",
        locale: "en",
        userText: "what is chemotherapy and how is it given",
      });

      expect(trailingDisclaimer(result.responseText!)).toContain(HI_STANDARD);
      expect(trailingDisclaimer(result.responseText!)).not.toContain(EN_STANDARD);
    });

    it("takes the English emergency disclaimer on the fast path", async () => {
      const { chat } = await buildService({ locale: "hi", answer: ENGLISH_ANSWER });

      const result = await chat.handle({
        sessionId: "s1",
        channel: "whatsapp",
        locale: "en",
        userText: "the bleeding won't stop",
      });

      expect(result.safety.classification).toBe("red_flag");
      expect(trailingDisclaimer(result.responseText!)).toContain(EN_EMERGENCY);
      expect(trailingDisclaimer(result.responseText!)).not.toContain(HI_EMERGENCY);
    });
  });

  it("emergency fast path with a Hindi locale keeps its Hindi emergency disclaimer (no regression)", async () => {
    // This path at chat.service.ts:257 always passed locale and userText; the
    // test exists to prove the precedence change did not disturb it.
    const { chat } = await buildService({ locale: "hi", answer: HINDI_ANSWER });

    const result = await chat.handle({
      sessionId: "s1",
      channel: "whatsapp",
      locale: "hi",
      userText: "खून रुक नहीं रहा",
    });

    expect(result.safety.classification).toBe("red_flag");
    expect(trailingDisclaimer(result.responseText!)).toContain(HI_EMERGENCY);
    expect(trailingDisclaimer(result.responseText!)).not.toContain(EN_EMERGENCY);
  });

  it("emergency fast path in English is unchanged", async () => {
    const { chat } = await buildService({ locale: "en", answer: ENGLISH_ANSWER });

    const result = await chat.handle({
      sessionId: "s1",
      channel: "whatsapp",
      locale: "en",
      userText: "the bleeding won't stop",
    });

    expect(result.safety.classification).toBe("red_flag");
    expect(trailingDisclaimer(result.responseText!)).toContain(EN_EMERGENCY);
    expect(trailingDisclaimer(result.responseText!)).not.toContain(HI_EMERGENCY);
  });
});
