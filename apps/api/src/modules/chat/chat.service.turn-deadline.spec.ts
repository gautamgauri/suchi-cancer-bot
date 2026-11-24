import { Test, TestingModule } from "@nestjs/testing";
import { ChatService, TurnProgress, URGENT_EARLY_RAG_DEADLINE_MS } from "./chat.service";
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
 * Issue #225 / #221: a web turn must come back inside the 55s ChatController
 * timeout, degrading inside the budget rather than overrunning it.
 *
 * On 2026-10-14 production answered 5 of 39 eval turns; the other 34 hit the
 * controller's 504. Three code paths let a turn run past its own budget:
 *
 *  1. The budget clock started only AFTER the session read and the user-message
 *     insert. Each of those waits up to pool_timeout (10s) per prismaRetry
 *     attempt when the Prisma pool is exhausted, so a turn could spend 20-60s
 *     there and still be granted a fresh 45s.
 *  2. The identify / citation regenerations called the LLM without
 *     llmWithDeadline, so each claimed a fresh LLM_TIMEOUT_MS (45s).
 *  3. The urgent path's early retrieval had no deadline at all, so a slow
 *     database (dbMs reached 46s) held the urgent guidance until the 504.
 *
 * And the 504 body itself claimed `safety.classification: "normal"` whatever
 * the pipeline had concluded (#221).
 *
 * Time is virtual (Date.now is offset) except where a spec needs a real timer
 * to fire; those use deadlines shortened to a few milliseconds.
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

async function buildService(opts: {
  channel: string;
  ragStallMs?: number;
  /** Virtual ms burnt by each of the two pre-pipeline DB steps (session read, user-message insert). */
  initDbStallMs?: number;
  /** Virtual ms the first generation takes. */
  firstLlmMs?: number;
  /** Every citation validation is RED, forcing the regeneration path. */
  citationsRed?: boolean;
  /** The regeneration (2nd generation) never settles. */
  regenHangs?: boolean;
  urgent?: boolean;
  /** Early (urgent-path) retrieval never settles. */
  earlyRagHangs?: boolean;
}) {
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
      create: jest.fn().mockImplementation(async (args: any) => {
        if (args.data.role === "user") clockOffset += opts.initDbStallMs ?? 0;
        return { id: "msg1", sessionId: "session1", ...args.data };
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockImplementation(async () => {
        clockOffset += opts.initDbStallMs ?? 0;
        return 0;
      }),
    },
    messageCitation: { create: jest.fn(), createMany: jest.fn() },
    safetyEvent: { create: jest.fn() },
  };

  // Burn virtual time inside retrieval — i.e. *after* the pre-RAG budget guard
  // and *before* the generation stage, which is where the production turn lost
  // its budget.
  const stall = async () => {
    clockOffset += opts.ragStallMs ?? 0;
    return chunks;
  };
  const never = () => new Promise<never>(() => undefined);
  let earlyCallSeen = false;
  const retrieve = async () => {
    // The urgent path's early retrieval is the first retrieval of an urgent turn.
    if (opts.urgent && !earlyCallSeen) {
      earlyCallSeen = true;
      if (opts.earlyRagHangs) return never();
    }
    return stall();
  };
  let llmCalls = 0;
  const generate = async () => {
    llmCalls++;
    if (llmCalls === 1) {
      clockOffset += opts.firstLlmMs ?? 0;
      return EXPLAIN_REPLY;
    }
    if (opts.regenHangs) return never();
    return EXPLAIN_REPLY;
  };

  const llm = {
    generateWithCitations: jest.fn().mockImplementation(generate),
    generateDefinitionalResponse: jest.fn().mockResolvedValue(EXPLAIN_REPLY),
    generateRaw: jest.fn().mockResolvedValue(EXPLAIN_REPLY),
  };

  const abstention = {
    hasUrgencyIndicators: jest.fn().mockReturnValue(!!opts.urgent),
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
          retrieveWithMetadata: jest.fn().mockImplementation(retrieve),
          retrieveWithExpansion: jest.fn().mockImplementation(retrieve),
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
          validateCitations: jest.fn().mockReturnValue(
            opts.citationsRed
              ? { isValid: false, confidenceLevel: "RED" as const, citations: [], errors: ["no citations"] }
              : { isValid: true, confidenceLevel: "GREEN" as const, citations: [] },
          ),
        },
      },
      { provide: AbstentionService, useValue: abstention },
      { provide: IntentClassifier, useValue: new IntentClassifier(abstention as any) },
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

  return { service: module.get<ChatService>(ChatService), llm, analytics, prisma: mockPrisma };
}

describe("ChatService — a web turn stays inside its own budget (issue #225)", () => {
  beforeEach(() => {
    clockOffset = 0;
    const realNow = Date.now.bind(Date);
    dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);
  });

  afterEach(() => {
    jest.useRealTimers();
    dateNowSpy.mockRestore();
    jest.clearAllMocks();
  });

  it("counts the session read and user-message insert against the budget", async () => {
    // 2 x 20s of pool waiting before the pipeline proper. Before the fix the
    // budget only started after these, so the turn was still granted a fresh
    // 45s and called the LLM at ~40s into a 55s HTTP window.
    const { service, llm } = await buildService({ channel: "web", initDbStallMs: 20_000 });
    const progress: TurnProgress = {};

    const result: any = await service.handle(
      { sessionId: "session1", userText: EXPLAIN_QUERY, channel: "web" } as any,
      undefined,
      progress,
    );

    expect(llm.generateWithCitations).not.toHaveBeenCalled();
    expect(result.error).toBe("budget_exhausted_before_rag");
    // Degrading is a technical outcome, never the urgent-escalation template (#94).
    expect(result.responseText).not.toMatch(/seek emergency medical care/i);
    // The safety stage ran before the guard and concluded "normal" — that, and
    // only that, is what the progress record may say.
    expect(progress.safety).toEqual({ classification: "normal", source: "safety_module" });
  });

  it("WhatsApp keeps its 90s budget: the same pool wait still reaches the LLM (#168 unchanged)", async () => {
    const { service, llm } = await buildService({ channel: "whatsapp", initDbStallMs: 20_000 });

    const result: any = await service.handle({
      sessionId: "session1",
      userText: EXPLAIN_QUERY,
      channel: "whatsapp",
      locale: "en",
    } as any);

    expect(llm.generateWithCitations).toHaveBeenCalled();
    expect(result.error).toBeUndefined();
  });

  it("a citation regeneration that hangs is cut off at the turn deadline instead of running a fresh 45s", async () => {
    jest.useFakeTimers({ doNotFake: ["Date"] });
    // First generation takes 25s, leaving 20s: enough to start the RED-citation
    // regeneration (needs > MIN_BUDGET_FOR_LLM_MS = 15s). The regeneration then
    // never returns, as a slow Gemini call would not within the HTTP window.
    const { service, llm } = await buildService({
      channel: "web",
      firstLlmMs: 25_000,
      citationsRed: true,
      regenHangs: true,
    });

    const pending = service.handle({ sessionId: "session1", userText: EXPLAIN_QUERY, channel: "web" } as any);
    let settled = false;
    pending.then(() => (settled = true), () => (settled = true));

    // Before the fix nothing bounded the regeneration: the turn never settled.
    await jest.advanceTimersByTimeAsync(21_000);
    expect(settled).toBe(true);

    const result: any = await pending;
    expect(llm.generateWithCitations).toHaveBeenCalledTimes(2);
    expect(result.error).toBe("budget_exhausted_before_llm");
    expect(result.responseText).not.toMatch(/seek emergency medical care/i);
  });
});

describe("ChatService — urgent guidance does not wait on a slow database (issue #225 / #221)", () => {
  beforeEach(() => {
    clockOffset = 0;
    const realNow = Date.now.bind(Date);
    dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    jest.clearAllMocks();
  });

  it("an early retrieval that never returns still yields the urgent reply, without citations", async () => {
    const { service, llm } = await buildService({ channel: "web", urgent: true, earlyRagHangs: true });
    // Real timer, shortened so the spec does not wait the production 8s.
    (service as any).URGENT_EARLY_RAG_DEADLINE_MS = 20;
    const progress: TurnProgress = {};

    const result: any = await service.handle(
      { sessionId: "session1", userText: EXPLAIN_QUERY, channel: "web" } as any,
      undefined,
      progress,
    );

    // Same outcome as when early retrieval throws today: the urgent template
    // path, flagged red_flag, with the banner. No LLM call without chunks.
    expect(result.safety.classification).toBe("red_flag");
    expect(result.safety.actions).toContain("show_emergency_banner");
    expect(llm.generateWithCitations).not.toHaveBeenCalled();
    expect(progress.safety).toEqual({ classification: "red_flag", source: "urgency_indicators" });
  });

  it("the production early-retrieval deadline leaves the urgent path well inside the 55s window", () => {
    // 8s retrieval + the existing 15s urgent LLM deadline = 23s worst case
    // before persistence, against a 55s controller timeout.
    expect(URGENT_EARLY_RAG_DEADLINE_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("ChatService — 'normal' is reported only after every safety screen (issue #221)", () => {
  beforeEach(() => {
    clockOffset = 0;
    const realNow = Date.now.bind(Date);
    dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    jest.clearAllMocks();
  });

  /**
   * Captures what `progress` held when the mental-health screen was called,
   * and while the session-context write was in flight.
   *
   * PR #202 moved the four deterministic screens ahead of the session read,
   * so the mental-health screen now runs before the context write. The
   * invariant is unchanged: "normal" is never claimed before that screen has
   * run. The context write now sees the real verdict.
   */
  async function runWithContextWrite(crisis: boolean) {
    const { service } = await buildService({ channel: "web" });
    const progress: TurnProgress = {};
    const seen: Array<TurnProgress["safety"]> = [];
    const atMentalHealthScreen: Array<TurnProgress["safety"]> = [];
    const svc = service as any;
    // A non-neutral tone makes the turn write session context, which is slow
    // I/O that a 504 can interrupt.
    svc.empathyDetector.detectEmotionalTone.mockResolvedValue({ tone: "sad" });
    svc.greetingFlow.updateSessionContext.mockImplementation(async () => {
      seen.push(progress.safety);
    });
    const verdict = crisis
      ? { needsSupport: true, isCrisis: true, category: "crisis", keywords: ["synthetic-crisis-marker"] }
      : { needsSupport: false, isCrisis: false, category: null, keywords: [] };
    svc.empathyDetector.detectMentalHealthNeed.mockImplementation(() => {
      atMentalHealthScreen.push(progress.safety);
      return verdict;
    });
    const result: any = await service.handle(
      { sessionId: "session1", userText: EXPLAIN_QUERY, channel: "web" } as any,
      undefined,
      progress,
    );
    return { progress, seen, atMentalHealthScreen, result };
  }

  it("does not claim 'normal' while the mental-health screen has yet to run", async () => {
    const { progress, seen, atMentalHealthScreen, result } = await runWithContextWrite(true);

    // Nothing at all is recorded until the mental-health screen has run.
    expect(atMentalHealthScreen.length).toBeGreaterThan(0);
    for (const s of atMentalHealthScreen) expect(s).toBeUndefined();
    // The screen ran before the context write, so a 504 raised during that
    // write reports the crisis, never "normal".
    expect(seen).toEqual([{ classification: "mental_health_crisis", source: "mental_health" }]);
    expect(result.safety.classification).toBe("mental_health_crisis");
    expect(progress.safety).toEqual({ classification: "mental_health_crisis", source: "mental_health" });
  });

  it("records 'normal' once the mental-health screen has concluded without a crisis", async () => {
    const { progress, seen, atMentalHealthScreen } = await runWithContextWrite(false);

    for (const s of atMentalHealthScreen) expect(s).toBeUndefined();
    expect(seen).toEqual([{ classification: "normal", source: "safety_module" }]);
    expect(progress.safety).toEqual({ classification: "normal", source: "safety_module" });
  });

  it("records 'mental_health_support', not 'normal', before the MH2/MH3 reply is written", async () => {
    const { service, prisma } = await buildService({ channel: "web" });
    const svc = service as any;
    const progress: TurnProgress = {};
    svc.empathyDetector.detectMentalHealthNeed.mockReturnValue({
      needsSupport: true,
      isCrisis: false,
      category: "depression",
      keywords: ["synthetic-support-marker"],
    });
    // What a 504 raised while the assistant row is being written would report.
    let atAssistantWrite: TurnProgress["safety"] | "not reached" = "not reached";
    const create = prisma.message.create.getMockImplementation()!;
    prisma.message.create.mockImplementation(async (args: any) => {
      if (args.data.role === "assistant") atAssistantWrite = progress.safety;
      return create(args);
    });

    const result: any = await service.handle(
      { sessionId: "session1", userText: EXPLAIN_QUERY, channel: "web" } as any,
      undefined,
      progress,
    );

    expect(result.safety.classification).toBe("mental_health_support");
    // Since PR #202 the reply is returned first and stored behind it.
    await svc.settleBackgroundWrites();
    expect(atAssistantWrite).toEqual({ classification: "mental_health_support", source: "mental_health" });
    expect(progress.safety).toEqual({ classification: "mental_health_support", source: "mental_health" });
  });
});
