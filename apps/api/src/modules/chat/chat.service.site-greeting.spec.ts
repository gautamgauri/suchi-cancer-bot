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
import { ResponseTemplates } from "./response-templates";
import * as greetingPhrases from "./greeting-phrases";
import { WhatsAppService } from "../whatsapp/whatsapp.service";

/**
 * The first reply to the website's WhatsApp greeting, traced through the real
 * ChatService with the real greeting flow, template selector, intent
 * classifier and rule-based safety screens. LLM, retrieval and the database
 * are mocked.
 *
 * A brand-new WhatsApp contact has no messages yet. ChatService stores the
 * user's message before the greeting check, so the interactive greeting flow
 * (which needs zero messages) does not start, and a recognised greeting gets
 * the G1 template. A greeting with a Hindi line and an English line (the
 * site's message) gets the Hindi welcome then the English G1. A greeting in
 * Devanagari or romanised Hindi only gets the Hindi welcome. Any other
 * greeting gets the English G1, unchanged.
 *
 * The "as on main" runs switch the new Hindi matcher and the Hindi template
 * off, which restores the behaviour on main. Every safety probe must give
 * exactly the same reply either way.
 */

/** The site greeting as the pipeline sees it, after the `(src: ...)` line is stripped. */
const SITE_GREETING = "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.";

const CHUNKS = [
  {
    docId: "doc1",
    chunkId: "chunk1",
    content: "Breast cancer symptoms include lumps, nipple changes, and skin changes.",
    document: { title: "Breast Cancer Symptoms - NCI", url: "https://example.com/a", source: "NCI", sourceType: "02_nci_core", citation: "NCI, 2025" },
  },
];

async function buildService() {
  // A fresh session, as resolveSession mints for a new WhatsApp contact.
  const session = {
    id: "wa-new",
    createdAt: new Date(),
    channel: "whatsapp",
    locale: "hi",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: false,
    emotionalState: null,
  };
  const messages: Array<{ role: string; text: string }> = [];
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([session]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    session: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    message: {
      create: jest.fn().mockImplementation((args: any) => {
        messages.push({ role: args.data.role, text: args.data.text });
        return Promise.resolve({ id: `m${messages.length}`, ...args.data, createdAt: new Date() });
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(messages.map((m) => ({ ...m })))),
      count: jest.fn().mockImplementation((args: any) =>
        Promise.resolve(messages.filter((m) => !args?.where?.role || m.role === args.where.role).length),
      ),
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
    generateWithCitations: jest.fn().mockResolvedValue("Answer [citation:doc1:chunk1]"),
    generate: jest.fn().mockResolvedValue("Soft redirect text"),
  };
  const empathy = new EmpathyDetector();
  const abstention = new AbstentionService();

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
          generateClarifyingQuestion: jest.fn(),
        },
      },
      {
        provide: CitationService,
        useValue: {
          extractCitations: jest.fn().mockReturnValue({ citations: [], orphanCount: 0, orphanCitations: [] }),
          validateCitations: jest.fn().mockReturnValue({ isValid: true, confidenceLevel: "GREEN", citations: [], citationDensity: 0.5 }),
          enrichCitations: jest.fn().mockResolvedValue([]),
        },
      },
      { provide: AbstentionService, useValue: abstention },
      // The real greeting route: template selector, intent classifier and greeting flow.
      { provide: IntentClassifier, useValue: new IntentClassifier(abstention) },
      { provide: TemplateSelector, useFactory: (c: IntentClassifier) => new TemplateSelector(c), inject: [IntentClassifier] },
      { provide: GreetingFlowService, useValue: new GreetingFlowService(prisma as any, empathy) },
      { provide: StructuredExtractorService, useValue: new StructuredExtractorService() },
      { provide: ResponseValidatorService, useValue: { validate: jest.fn().mockReturnValue({ shouldAbstain: false, isValid: true, ungroundedEntities: [] }) } },
      { provide: EmpathyDetector, useValue: empathy },
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

  return { chat: module.get<ChatService>(ChatService), prisma, rag, llm, messages };
}

const G1 = ResponseTemplates.G1({ isFirstMessage: true, userText: "" });
const G1_HINDI = ResponseTemplates.G1Hindi({ isFirstMessage: true, userText: "" });
const G1_BILINGUAL = ResponseTemplates.G1Bilingual({ isFirstMessage: true, userText: "" });
const DEVANAGARI = /[ऀ-ॿ]/;

const G1_TEXT =
  "Hi. I'm Suchi, the Suchitra Cancer Bot. How can I help today?\n\nIs this about symptoms, a report, treatment side effects, or finding care?";
const G1_HINDI_TEXT =
  "नमस्ते। मैं सुचि हूँ, सुचित्रा कैंसर केयर फ़ाउंडेशन की कैंसर जानकारी बॉट। आज मैं आपकी क्या मदद कर सकती हूँ?" +
  "\n\n" +
  "क्या आपका सवाल लक्षणों, किसी जाँच रिपोर्ट, इलाज के साइड इफ़ेक्ट, या अस्पताल और डॉक्टर ढूँढने के बारे में है?";

async function firstTurn(userText: string, locale: string) {
  const built = await buildService();
  const result = await built.chat.handle({ sessionId: "wa-new", channel: "whatsapp", locale, userText });
  // Safety rows are written in the background since PR #202.
  await built.chat.settleBackgroundWrites();
  return { ...built, result };
}

/** The same turn with the new matcher and the Hindi templates off, i.e. as on main. */
async function firstTurnAsOnMain(userText: string, locale: string) {
  const spies = [
    jest.spyOn(greetingPhrases, "isHindiOrBilingualGreeting").mockReturnValue(false),
    jest.spyOn(greetingPhrases, "greetingReplyLanguage").mockReturnValue("en"),
  ];
  try {
    return await firstTurn(userText, locale);
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

/** SafetyEvent rows without the generated message id, for comparison. */
function safetyEvents(prisma: any): any[] {
  return prisma.safetyEvent.create.mock.calls.map((c: any) => {
    const { messageId, ...rest } = c[0].data ?? {};
    return rest;
  });
}

/** The text WhatsAppService hands to the pipeline for a raw message body. */
function whatsappText(body: string): { text: string; sourceCode?: string } {
  const wa = new WhatsAppService({} as any, {} as any, {} as any, new SafetyService(), new AbstentionService(), new EmpathyDetector());
  const [msg] = wa.parseInbound({
    entry: [{ changes: [{ value: { messages: [{ id: "w1", from: "9199", type: "text", text: { body } }] } }] }],
  });
  return { text: msg.text, sourceCode: msg.sourceCode };
}

const SITE_MESSAGE = (code: string) => `${SITE_GREETING}\n(src: ${code})`;

describe("ChatService: first reply to the website's WhatsApp greeting", () => {
  afterEach(() => jest.restoreAllMocks());

  it("answers the site greeting in Hindi then English, pinned character for character", async () => {
    const { text } = whatsappText(SITE_MESSAGE("wa-article"));
    expect(text).toBe(SITE_GREETING);
    const { result, rag, llm, messages } = await firstTurn(text, "hi");

    expect(result.responseText).toBe(G1_BILINGUAL);
    expect(result.responseText).toBe(G1_HINDI_TEXT + "\n\n" + G1_TEXT);
    expect(result.safety.classification).toBe("normal");
    expect(rag.retrieveWithMetadata).not.toHaveBeenCalled();
    expect(rag.retrieveWithExpansion).not.toHaveBeenCalled();
    expect(llm.generateWithCitations).not.toHaveBeenCalled();
    expect(llm.generate).not.toHaveBeenCalled();
    // The stored user message is the greeting as received, with no source line.
    expect(messages[0]).toEqual({ role: "user", text: SITE_GREETING });
  });

  it("pins both greeting texts character for character", () => {
    expect(G1_HINDI).toBe(G1_HINDI_TEXT);
    expect(G1).toBe(G1_TEXT);
  });

  it("on main the same greeting missed the greeting route", async () => {
    const { result } = await firstTurnAsOnMain(SITE_GREETING, "hi");
    expect([G1, G1_HINDI, G1_BILINGUAL]).not.toContain(result.responseText);
  });

  it.each([
    ["Devanagari", "नमस्ते सुचि", "hi"],
    ["Devanagari, namaskar", "नमस्कार", "hi"],
    ["Devanagari, pranam", "प्रणाम जी", "hi"],
    ["Devanagari hello", "हेलो सुचि", "hi"],
    ["the Hindi site line alone", "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।", "hi"],
    ["romanised namaste", "namaste", "en"],
    ["romanised namaskar", "namaskar", "en"],
    ["romanised namaste with the name", "namaste suchi", "en"],
    ["romanised info request", "Namaste Suchi! Mujhe kuchh jankari chahie.", "en"],
  ])("answers a %s greeting with the Hindi greeting only", async (_label, text, locale) => {
    const { result, llm } = await firstTurn(text, locale);
    expect(result.responseText).toBe(G1_HINDI_TEXT);
    expect(llm.generateWithCitations).not.toHaveBeenCalled();
  });

  it.each([
    ["hello", "hello", "en"],
    ["hi", "hi", "en"],
    ["Hi there, how are you", "Hi there, how are you", "en"],
    ["the English site line alone", "Hello Suchi, I would like some information.", "en"],
    ["the plain greeting used when only a source line arrived", "Hello", "en"],
  ])("answers %s with the unchanged English G1 only", async (_label, text, locale) => {
    const { result } = await firstTurn(text, locale);
    expect(result.responseText).toBe(G1_TEXT);
  });

  it("the web chat path gives the same replies (no locale is sent by the web client)", async () => {
    const hindi = await (await buildService()).chat.handle({ sessionId: "wa-new", channel: "web", userText: "नमस्ते सुचि" } as any);
    expect(hindi.responseText).toBe(G1_HINDI_TEXT);
    const both = await (await buildService()).chat.handle({ sessionId: "wa-new", channel: "web", userText: SITE_GREETING } as any);
    expect(both.responseText).toBe(G1_BILINGUAL);
    const english = await (await buildService()).chat.handle({ sessionId: "wa-new", channel: "web", userText: "hello" } as any);
    expect(english.responseText).toBe(G1_TEXT);
  });

  it("a later greeting in the same session still gets the English G2, as on main", async () => {
    const built = await buildService();
    await built.chat.handle({ sessionId: "wa-new", channel: "whatsapp", locale: "hi", userText: SITE_GREETING });
    const second = await built.chat.handle({ sessionId: "wa-new", channel: "whatsapp", locale: "hi", userText: "नमस्ते" });
    expect(second.responseText).toBe(ResponseTemplates.G2({ isFirstMessage: false, userText: "" }));
  });

  it("a visitor who then writes in English is answered in English on the next turn", async () => {
    const built = await buildService();
    const first = await built.chat.handle({ sessionId: "wa-new", channel: "whatsapp", locale: "hi", userText: SITE_GREETING });
    expect(first.responseText).toBe(G1_BILINGUAL);

    // WhatsApp detects the locale per message, so an English message arrives as "en".
    const question = "What are the early signs of breast cancer?";
    const second = await built.chat.handle({ sessionId: "wa-new", channel: "whatsapp", locale: "en", userText: question });

    // The answer comes from the LLM, which is given this turn's text only.
    // No earlier message (so not the Hindi greeting) is passed to it.
    const llmCalls = [...built.llm.generateWithCitations.mock.calls, ...built.llm.generate.mock.calls];
    expect(llmCalls.length).toBeGreaterThan(0);
    for (const call of llmCalls) expect(JSON.stringify(call)).not.toMatch(DEVANAGARI);
    // Nothing the pipeline adds (disclaimer, framing) is in Hindi.
    expect(second.responseText).not.toMatch(DEVANAGARI);
  });

  // Review B1: on main these reach the safety screens with the word intact.
  it.each(["(src: suicide)", "hello\n(src: suicide)", "(src: seizure)", "hello\n(src: unconscious)"])(
    "%j on the real WhatsApp path gets main's reply",
    async (body) => {
      const { text, sourceCode } = whatsappText(body);
      expect(text).toBe(body);
      expect(sourceCode).toBeUndefined();
      const now = await firstTurn(text, "en");
      // On main WhatsApp passed the body through unchanged.
      const main = await firstTurnAsOnMain(body, "en");
      expect(now.result.responseText).toBe(main.result.responseText);
      expect(now.result.safety).toEqual(main.result.safety);
      expect(safetyEvents(now.prisma)).toEqual(safetyEvents(main.prisma));
      expect([G1, G1_HINDI, G1_BILINGUAL]).not.toContain(now.result.responseText);
    },
  );

  // Review F4: the visitor types after the prefilled message.
  it.each([
    ["a symptom question", "mere stan mein gaanth hai, kya karun?"],
    ["an emergency phrase", "खून बहुत आ रहा है"],
    ["an ordinary question", "What is chemotherapy?"],
  ])("prefilled message plus %s: only the typed text reaches the pipeline, with main's reply to it", async (_label, typed) => {
    const { text, sourceCode } = whatsappText(`${SITE_MESSAGE("wa-video")}\n${typed}`);
    expect(text).toBe(typed);
    expect(sourceCode).toBe("wa-video");

    const now = await firstTurn(text, DEVANAGARI.test(typed) ? "hi" : "en");
    // Main's reply to the same typed text on its own.
    const main = await firstTurnAsOnMain(typed, DEVANAGARI.test(typed) ? "hi" : "en");
    expect(now.result.responseText).toBe(main.result.responseText);
    expect(now.result.safety).toEqual(main.result.safety);
    expect(safetyEvents(now.prisma)).toEqual(safetyEvents(main.prisma));

    // None of the prefilled text reaches the stored message, retrieval or the LLM.
    expect(now.messages[0]).toEqual({ role: "user", text: typed });
    const seen = JSON.stringify([
      now.rag.retrieveWithMetadata.mock.calls,
      now.rag.retrieveWithExpansion.mock.calls,
      now.llm.generateWithCitations.mock.calls,
      now.llm.generate.mock.calls,
      now.messages.filter((m) => m.role === "user"),
    ]);
    for (const prefilled of ["Hello Suchi", "I would like some information", "मुझे कुछ जानकारी", "(src:"]) {
      expect(seen).not.toContain(prefilled);
    }
  });

  it("the emergency phrase typed after the prefilled message gets the safety reply", async () => {
    const { text } = whatsappText(`${SITE_MESSAGE("wa-video")}\nखून बहुत आ रहा है`);
    const now = await firstTurn(text, "hi");
    expect(now.result.safety.classification).toBe("red_flag");
  });

  // Review F2: on main "namaste" followed by anything was a greeting.
  it.each([
    "namaste ji saans phool rahi hai",
    "namaskar ji, stan me ganth hai",
    "namaste 102 bukhar",
    "namaste, mujhe chemo ke baare mein jaanna hai",
  ])("%s is not answered with a greeting", async (text) => {
    const now = await firstTurn(text, "en");
    expect([G1, G1_HINDI, G1_BILINGUAL]).not.toContain(now.result.responseText);
  });

  // Probes taken from emergency-fast-path.spec.ts and hindi-safety-regression.spec.ts.
  const PROBES: Array<[string, string]> = [
    ["critical, Devanagari", "खून बहुत आ रहा है"],
    ["critical, Devanagari chest pain", "छाती में बहुत तेज दर्द"],
    ["critical, Hinglish", "khoon ruk nahi raha"],
    ["critical, English", "I'm vomiting blood"],
    ["urgent, English", "fever above 102 and on chemo"],
    ["self-harm, Devanagari", "मैं मरना चाहता हूँ"],
    ["self-harm, romanised", "main marna chahta hoon"],
  ];
  const PREFIXES: Array<[string, (probe: string) => string]> = [
    ["after a Devanagari greeting", (p) => `नमस्ते सुचि, ${p}`],
    ["after the site greeting", (p) => `${SITE_GREETING}\n${p}`],
    ["after a romanised greeting", (p) => `namaste suchi, ${p}`],
  ];

  for (const [prefixLabel, withGreeting] of PREFIXES) {
    it.each(PROBES)(`%s ${prefixLabel}: not a greeting, and the safety reply is the same as on main`, async (_label, probe) => {
      const text = withGreeting(probe);
      const now = await firstTurn(text, "hi");
      const main = await firstTurnAsOnMain(text, "hi");

      expect(now.result.safety.classification).not.toBe("normal");
      expect([G1, G1_HINDI, G1_BILINGUAL]).not.toContain(now.result.responseText);
      expect(now.result.responseText).toBe(main.result.responseText);
      expect(now.result.safety).toEqual(main.result.safety);
      expect(safetyEvents(now.prisma)).toEqual(safetyEvents(main.prisma));
    });
  }

  it("a greeting followed by a question still goes to retrieval, as on main", async () => {
    const text = "नमस्ते सुचि, स्तन कैंसर के लक्षण क्या हैं?";
    const now = await firstTurn(text, "hi");
    const main = await firstTurnAsOnMain(text, "hi");
    expect([G1, G1_HINDI, G1_BILINGUAL]).not.toContain(now.result.responseText);
    expect(now.result.responseText).toBe(main.result.responseText);
    expect(now.rag.retrieveWithMetadata.mock.calls.length + now.rag.retrieveWithExpansion.mock.calls.length).toBeGreaterThan(0);
  });
});
