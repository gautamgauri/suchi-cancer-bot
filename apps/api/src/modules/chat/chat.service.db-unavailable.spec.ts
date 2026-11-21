import { Logger } from "@nestjs/common";
import { ChatService, TurnProgress } from "./chat.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { SafetyService } from "../safety/safety.service";
import { AbstentionService } from "../abstention/abstention.service";
import { IntentClassifier } from "./intent-classifier";
import { TemplateSelector } from "./template-selector";
import { StructuredExtractorService } from "./structured-extractor.service";
import { GreetingFlowService } from "./greeting-flow.service";
import { EmpathyDetector } from "./empathy-detector";
import { PatientStateService } from "./patient-state.service";
import { CrossLingualService } from "../rag/cross-lingual.service";
import { OutputVerifierService } from "./output-verifier.service";
import { evaluateEmergencyFastPath } from "../safety/emergency-fast-path";
import { appendDisclaimer } from "../safety/disclaimer-engine";
import { ResponseTemplates } from "./response-templates";
import { SAFETY_WRITE_BOUND_MS } from "./deterministic-safety";

/**
 * Emergency and self-harm replies when the database is unreachable (PR #202).
 *
 * The earlier persist-failure spec kept the session read and the message count
 * working and failed only `message.create`. That hid the real gap: the session
 * lookup ran before every safety gate, so an unreachable database or an
 * exhausted pool threw there and the emergency reply was lost. These cases
 * break the session read itself, then every Prisma call, then make every
 * Prisma call hang.
 *
 * All message text below is synthetic and comes from the existing safety and
 * empathy specs.
 */

const EMERGENCY = "I am coughing up blood right now";
const SELF_HARM = "I want to kill myself";
const MH_CRISIS = "I don't want to live anymore";
const ORDINARY = "what is chemotherapy?";
const LOCALE = "en";

/** Generous ceiling for "promptly": the session-lookup bound plus scheduling slack. */
const REPLY_BOUND_MS = 4_500;

const dbDown = () =>
  Promise.reject(Object.assign(new Error("Can't reach database server"), { code: "P1001" }));
const hang = () => new Promise<never>(() => undefined);

type Mode = "session-read-rejects" | "all-reject" | "all-hang";

function makePrisma(mode: Mode) {
  const sessionRow = {
    id: "s",
    createdAt: new Date(0),
    channel: "web",
    locale: "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
  const fail = mode === "all-hang" ? hang : dbDown;
  const ok = (v: any) => (mode === "session-read-rejects" ? () => Promise.resolve(v) : fail);
  const model = () =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          jest.fn((args: any) => {
            if (mode !== "session-read-rejects") return fail();
            if (method === "count") return Promise.resolve(0);
            return Promise.resolve({ id: args?.data?.id ?? "row", ...(args?.data ?? {}) });
          }),
      },
    );
  const prisma: any = {
    // The session read: broken in every mode.
    $queryRaw: jest.fn(fail),
    $executeRawUnsafe: jest.fn(ok(1)),
    $executeRaw: jest.fn(ok(1)),
  };
  for (const m of ["session", "message", "messageCitation", "safetyEvent", "analyticsEvent", "reviewRecord"]) {
    prisma[m] = model();
  }
  void sessionRow;
  return prisma;
}

function buildService(prisma: any, overrides: { rag?: any; llm?: any; citations?: any; review?: any } = {}): ChatService {
  const empathy = new EmpathyDetector();
  const abstention = new AbstentionService();
  const intent = new IntentClassifier(abstention);
  const fail = () => Promise.reject(new Error("unavailable"));
  return new ChatService(
    prisma,
    new AnalyticsService(prisma),
    new SafetyService(),
    overrides.rag ?? ({ retrieveWithMetadata: jest.fn(fail), retrieveWithExpansion: jest.fn(fail) } as any),
    overrides.llm ?? ({ generateWithCitations: jest.fn(fail), generateRaw: jest.fn(fail), generate: jest.fn(fail) } as any),
    { validateEvidence: jest.fn() } as any,
    overrides.citations ?? ({ extractCitations: jest.fn(), validateCitations: jest.fn(), enrichCitations: jest.fn() } as any),
    abstention,
    intent,
    new TemplateSelector(intent),
    { validate: jest.fn() } as any,
    new GreetingFlowService(prisma, empathy),
    empathy,
    new StructuredExtractorService(),
    new PatientStateService(),
    { enforce: (t: string) => t } as any,
    { multiRetrieve: jest.fn(fail) } as any,
    { needsDecomposition: () => false, decompose: jest.fn() } as any,
    new CrossLingualService(),
    { needsPlanning: () => false, plan: jest.fn() } as any,
    { execute: jest.fn() } as any,
    new OutputVerifierService(),
    overrides.review ?? ({ copilotMode: "off", review: jest.fn(fail), persistRecord: jest.fn(fail), buildBlockedFallback: jest.fn() } as any),
    { startTrace: () => ({}), startSpan: () => ({}), endSpan: () => undefined, finalizeTrace: () => undefined } as any,
  );
}

/** Resolve to the turn's outcome, or "pending" if it has not settled within `ms`. */
async function within<T>(p: Promise<T>, ms: number): Promise<{ status: "ok"; value: T } | { status: "err"; err: any } | { status: "pending" }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ status: "pending" }>((r) => {
    timer = setTimeout(() => r({ status: "pending" }), ms);
  });
  try {
    return await Promise.race([
      p.then(
        (value) => ({ status: "ok" as const, value }),
        (err) => ({ status: "err" as const, err }),
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const expectedEmergency = () =>
  appendDisclaimer(evaluateEmergencyFastPath(EMERGENCY).responseText!, LOCALE, true, EMERGENCY);
const expectedSelfHarm = () => {
  const r = new SafetyService().evaluate(SELF_HARM);
  return { text: appendDisclaimer(r.responseText!, LOCALE, r.classification === "red_flag", SELF_HARM), classification: r.classification };
};

describe("ChatService with a readable session but writes that hang (pool exhausted)", () => {
  // Before PR #202 the user-message write, the reply write and the SafetyEvent
  // write were each awaited with retries of up to about 31 s, so a safety
  // reply could miss the controller's 55 s limit. They now run behind it.
  const sessionRow = {
    id: "s",
    createdAt: new Date(0),
    channel: "web",
    locale: "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
  let prisma: any;
  let svc: ChatService;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    const writes = () => ({
      create: jest.fn(hang),
      update: jest.fn(hang),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    });
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([sessionRow]),
      session: writes(),
      message: writes(),
      safetyEvent: writes(),
      analyticsEvent: writes(),
    };
    svc = buildService(prisma);
  });

  afterEach(async () => {
    await new Promise((r) => setImmediate(r));
    process.off("unhandledRejection", onUnhandled);
    jest.restoreAllMocks();
  });

  it.each([
    ["emergency", EMERGENCY, "red_flag"],
    ["self-harm", SELF_HARM, "self_harm"],
    ["mental-health crisis", MH_CRISIS, "mental_health_crisis"],
  ])("the %s reply returns without waiting for its writes", async (_name, text, classification) => {
    const r = await within(
      svc.handle({ sessionId: "00000000-0000-4000-8000-000000000002", channel: "web", locale: LOCALE, userText: text } as any),
      1_000,
    );
    expect(r.status).toBe("ok");
    const result: any = (r as any).value;
    expect(result.safety.classification).toBe(classification);
    // The session was read, so the id chosen for the reply row comes back.
    expect(result.messageId).toMatch(/^[0-9a-f-]{36}$/);
    // The user message write was started behind the reply.
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: { sessionId: "00000000-0000-4000-8000-000000000002", role: "user", text },
    });
    expect(unhandled).toEqual([]);
  });
});

describe.each<Mode>(["session-read-rejects", "all-reject", "all-hang"])(
  "ChatService with the database unavailable (%s)",
  (mode) => {
    let svc: ChatService;
    let logged: string[];
    let unhandled: unknown[];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);

    beforeEach(() => {
      logged = [];
      unhandled = [];
      process.on("unhandledRejection", onUnhandled);
      for (const level of ["log", "warn", "error", "debug"] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: any[]) => {
          logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        });
      }
      svc = buildService(makePrisma(mode));
    });

    afterEach(async () => {
      // Give any rejected background write a chance to surface as unhandled.
      await new Promise((r) => setImmediate(r));
      process.off("unhandledRejection", onUnhandled);
      jest.restoreAllMocks();
    });

    const turn = (userText: string) =>
      svc.handle({ sessionId: "00000000-0000-4000-8000-000000000001", channel: "web", locale: LOCALE, userText } as any);

    it("an emergency message still gets the emergency template, promptly", async () => {
      const started = Date.now();
      const r = await within(turn(EMERGENCY), REPLY_BOUND_MS);
      expect(r.status).toBe("ok");
      const result: any = (r as any).value;
      expect(Date.now() - started).toBeLessThan(REPLY_BOUND_MS);
      expect(result.responseText).toBe(expectedEmergency());
      expect(result.safety.classification).toBe("red_flag");
      expect(result.safety.actions).toContain("show_emergency_banner");
      expect(result.safety.bannerText).toBe(result.responseText);
      // Nothing was stored, so there is no message id to attach feedback to.
      expect(result.messageId).toBeUndefined();
      // The failure is logged, and no log line carries the user's words.
      expect(logged.some((l) => l.includes("[safety-fallback]"))).toBe(true);
      expect(logged.some((l) => l.includes(EMERGENCY))).toBe(false);
      expect(unhandled).toEqual([]);
    });

    it("a self-harm message still gets the self-harm template, promptly", async () => {
      const started = Date.now();
      const r = await within(turn(SELF_HARM), REPLY_BOUND_MS);
      expect(r.status).toBe("ok");
      const result: any = (r as any).value;
      expect(Date.now() - started).toBeLessThan(REPLY_BOUND_MS);
      const want = expectedSelfHarm();
      expect(want.classification).toBe("self_harm");
      expect(result.responseText).toBe(want.text);
      expect(result.safety.classification).toBe("self_harm");
      expect(result.messageId).toBeUndefined();
      expect(logged.some((l) => l.includes(SELF_HARM))).toBe(false);
      expect(unhandled).toEqual([]);
    });

    it("a mental-health crisis message still gets MH1, promptly", async () => {
      const r = await within(turn(MH_CRISIS), REPLY_BOUND_MS);
      expect(r.status).toBe("ok");
      const result: any = (r as any).value;
      expect(result.responseText).toBe(ResponseTemplates.MH1({ isFirstMessage: false, userText: MH_CRISIS, locale: LOCALE } as any));
      expect(result.safety.classification).toBe("mental_health_crisis");
      expect(result.safety.actions).toEqual(["show_crisis_resources"]);
      expect(unhandled).toEqual([]);
    });

    it("an ordinary message fails as it does today", async () => {
      const r = await within(turn(ORDINARY), REPLY_BOUND_MS);
      if (mode === "all-hang") {
        // Today an ordinary turn waits on the database until the controller's
        // 55 s timeout. That is unchanged.
        expect(r.status).toBe("pending");
      } else {
        expect(r.status).toBe("err");
        expect((r as any).err.message).toContain("Can't reach database server");
      }
    });
  },
);

describe("ChatService with over-length input (PR #202)", () => {
  // A web message above MAX_USER_TEXT_LENGTH used to get a 400, which the web
  // client shows as a generic error. It is now cut on the server, so a long
  // message that opens with an emergency still gets the emergency reply.
  afterEach(() => jest.restoreAllMocks());

  it("cuts a long emergency message to the pipeline bound after screening, and still escalates", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const sessionRow = {
      id: "s",
      createdAt: new Date(0),
      channel: "web",
      locale: "en",
      userType: null,
      status: "active",
      userContext: null,
      cancerType: null,
      greetingCompleted: true,
      emotionalState: "neutral",
    };
    const created: any[] = [];
    const rows = () => ({
      create: jest.fn(async (args: any) => {
        created.push(args.data);
        return { id: args.data.id ?? "row", ...args.data };
      }),
      update: jest.fn(async () => ({})),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    });
    const prisma: any = {
      $queryRaw: jest.fn(async () => [sessionRow]),
      session: rows(),
      message: rows(),
      safetyEvent: rows(),
      analyticsEvent: rows(),
    };
    const svc = buildService(prisma);
    const long = `${EMERGENCY}. ${"My notes from the clinic visit follow. ".repeat(200)}`;
    expect(long.length).toBeGreaterThan(4096);

    const result: any = await svc.handle({
      sessionId: "00000000-0000-4000-8000-000000000003",
      channel: "web",
      locale: LOCALE,
      userText: long,
    } as any);
    await svc.settleBackgroundWrites();

    const bounded = long.slice(0, 4096);
    expect(result.safety.classification).toBe("red_flag");
    expect(result.responseText).toBe(
      appendDisclaimer(evaluateEmergencyFastPath(bounded).responseText!, LOCALE, true, bounded),
    );
    const userRow = created.find((d) => d.role === "user");
    expect(userRow.text).toHaveLength(4096);
  });
});

describe("ChatService progress verdict when the session read stalls (#221 with PR #202)", () => {
  // The screens run before the session read, so a turn cut off there, or
  // answered without a session, reports the real verdict.
  const URGENT_ONLY = "my father is rapidly worsening since yesterday";

  beforeEach(() => {
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [EMERGENCY, { classification: "red_flag", source: "emergency_fast_path" }],
    [SELF_HARM, { classification: "self_harm", source: "safety_module" }],
    [MH_CRISIS, { classification: "mental_health_crisis", source: "mental_health" }],
  ])("a no-session reply to %p records its verdict", async (text, verdict) => {
    const svc = buildService(makePrisma("all-hang"));
    const progress: TurnProgress = {};
    const r = await within(
      svc.handle(
        { sessionId: "00000000-0000-4000-8000-000000000004", channel: "web", locale: LOCALE, userText: text } as any,
        undefined,
        progress,
      ),
      REPLY_BOUND_MS,
    );
    expect(r.status).toBe("ok");
    expect(progress.safety).toEqual(verdict);
  });

  it.each([
    [URGENT_ONLY, { classification: "red_flag", source: "urgency_indicators" }],
    [ORDINARY, { classification: "normal", source: "safety_module" }],
  ])("a turn stalled in the session read already reports the verdict for %p", async (text, verdict) => {
    const svc = buildService(makePrisma("all-hang"));
    const progress: TurnProgress = {};
    const r = await within(
      svc.handle(
        { sessionId: "00000000-0000-4000-8000-000000000005", channel: "web", locale: LOCALE, userText: text } as any,
        undefined,
        progress,
      ),
      200,
    );
    // Still waiting on the database, as before, but the verdict is known.
    expect(r.status).toBe("pending");
    expect(progress.safety).toEqual(verdict);
  });
});

describe("ChatService screens the whole of a long message (PR #202, review B1)", () => {
  // Main has no length limit and screens the whole message. A safety phrase
  // beyond 4096 characters must still get its template. Synthetic text.
  const EN_LONG_SELF_HARM = "I have some questions about my treatment plan. ".repeat(200) + " I want to kill myself";
  const HI_LONG_BREATHING = "मेरे इलाज के बारे में कुछ सवाल हैं। ".repeat(400) + " सांस नहीं आ रही";

  let created: any[];
  let svc: ChatService;

  beforeEach(() => {
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    created = [];
    const rows = () => ({
      create: jest.fn(async (args: any) => {
        created.push(args.data);
        return { id: args.data.id ?? "row", ...args.data };
      }),
      update: jest.fn(async () => ({})),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    });
    const sessionRow = {
      id: "s",
      createdAt: new Date(0),
      channel: "web",
      locale: "en",
      userType: null,
      status: "active",
      userContext: null,
      cancerType: null,
      greetingCompleted: true,
      emotionalState: "neutral",
    };
    svc = buildService({
      $queryRaw: jest.fn(async () => [sessionRow]),
      session: rows(),
      message: rows(),
      safetyEvent: rows(),
      analyticsEvent: rows(),
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["English self-harm at the end", EN_LONG_SELF_HARM],
    ["Devanagari breathing emergency at the end", HI_LONG_BREATHING],
  ])("%s gets the same template as the whole message would", async (_name, text) => {
    expect(text.length).toBeGreaterThan(4096);
    const safety = new SafetyService().evaluate(text);
    const fast = evaluateEmergencyFastPath(text);
    // The phrase sits beyond the pipeline bound, so the first 4096 characters alone are clean.
    const head = text.slice(0, 4096);
    expect(evaluateEmergencyFastPath(head).isEmergency || new SafetyService().evaluate(head).classification !== "normal").toBe(false);
    expect(fast.isEmergency || safety.classification !== "normal").toBe(true);

    const result: any = await svc.handle({
      sessionId: "00000000-0000-4000-8000-000000000006",
      channel: "web",
      userText: text,
    } as any);
    await svc.settleBackgroundWrites();

    const want = fast.isEmergency
      ? appendDisclaimer(fast.responseText!, "en", true, text)
      : appendDisclaimer(safety.responseText!, "en", safety.classification === "red_flag", text);
    expect(result.responseText).toBe(want);
    expect(result.safety.classification).toBe(fast.isEmergency ? "red_flag" : safety.classification);
    // Intended difference from main: the stored user message is cut to 4096.
    const userRow = created.find((d) => d.role === "user");
    expect(userRow.text).toBe(text.slice(0, 4096));
  });
});

describe("ChatService mental-health replies do not wait on a hung context write (PR #202)", () => {
  const MH_SUPPORT = "I feel so alone in this cancer journey";

  beforeEach(() => {
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [MH_CRISIS, "mental_health_crisis"],
    [MH_SUPPORT, "mental_health_support"],
  ])("%p is answered within the write bound when updateSessionContext hangs", async (text, classification) => {
    const sessionRow = {
      id: "s",
      createdAt: new Date(0),
      channel: "web",
      locale: "en",
      userType: null,
      status: "active",
      userContext: null,
      cancerType: null,
      greetingCompleted: true,
      emotionalState: "neutral",
    };
    const svc: any = buildService({
      $queryRaw: jest.fn(async () => [sessionRow]),
      message: { count: jest.fn(async () => 0), create: jest.fn(hang) },
      session: { update: jest.fn(hang) },
      safetyEvent: { create: jest.fn(hang) },
      analyticsEvent: { create: jest.fn(hang) },
    });
    const contextWrite = jest.spyOn(svc.greetingFlow, "updateSessionContext").mockImplementation(hang);
    // Make sure the context write is attempted: a non-neutral tone triggers it.
    jest.spyOn(svc.empathyDetector, "detectEmotionalTone").mockResolvedValue({ tone: "sad" });

    const started = Date.now();
    const r = await within(
      svc.handle({ sessionId: "00000000-0000-4000-8000-000000000007", channel: "web", locale: LOCALE, userText: text }),
      SAFETY_WRITE_BOUND_MS + 1_500,
    );
    expect(contextWrite).toHaveBeenCalled();
    expect(r.status).toBe("ok");
    expect((r as any).value.safety.classification).toBe(classification);
    expect(Date.now() - started).toBeLessThan(SAFETY_WRITE_BOUND_MS + 1_500);
  }, 15_000);
});

describe("ChatService.recordSessionFreeSafetyTurn (WhatsApp audit, PR #202)", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [SELF_HARM, "self_harm", false],
    [MH_CRISIS, "mental_health_crisis", true],
  ])("stores %p like the healthy path, with the review flag for a crisis", async (text, classification, flagged) => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const created: Array<{ model: string; data: any }> = [];
    const rows = (model: string) => ({
      create: jest.fn(async (args: any) => {
        created.push({ model, data: args.data });
        return { id: args.data.id ?? "row", ...args.data };
      }),
      update: jest.fn(async (args: any) => {
        created.push({ model: `${model}.update`, data: args.data });
        return {};
      }),
    });
    const svc = buildService({ message: rows("message"), safetyEvent: rows("safetyEvent"), session: rows("session") });
    const reply = svc.deterministicSafetyReplyWithoutSession({ userText: text, channel: "whatsapp" })!;
    expect(reply.safety.classification).toBe(classification);

    svc.recordSessionFreeSafetyTurn("sess-late", { userText: text, channel: "whatsapp" }, reply);
    await svc.settleBackgroundWrites();
    await new Promise((r) => setImmediate(r));

    const user = created.find((c) => c.model === "message" && c.data.role === "user");
    const assistant = created.find((c) => c.model === "message" && c.data.role === "assistant");
    const event = created.find((c) => c.model === "safetyEvent");
    expect(user?.data).toEqual({ sessionId: "sess-late", role: "user", text });
    expect(assistant?.data).toMatchObject({ sessionId: "sess-late", text: reply.responseText, safetyClassification: classification });
    expect(event?.data).toMatchObject({ sessionId: "sess-late", messageId: assistant?.data.id, type: classification });
    const flag = created.find((c) => c.model === "session.update");
    expect(flag ? flag.data : undefined).toEqual(flagged ? { reviewFlagged: true, reviewFlagReason: "distress" } : undefined);
  });
});

describe("ChatService drains safety writes on shutdown (PR #202)", () => {
  beforeEach(() => {
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  const sessionRow = {
    id: "s",
    createdAt: new Date(0),
    channel: "web",
    locale: "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };

  it("waits for pending writes that finish", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const created: string[] = [];
    const slowCreate = (model: string) =>
      jest.fn(async (args: any) => {
        await gate;
        created.push(`${model}:${args.data.role ?? args.data.type}`);
        return { id: args.data.id ?? "row", ...args.data };
      });
    const svc = buildService({
      $queryRaw: jest.fn(async () => [sessionRow]),
      message: { count: jest.fn(async () => 0), create: slowCreate("message") },
      safetyEvent: { create: slowCreate("safetyEvent") },
      analyticsEvent: { create: jest.fn(async () => ({})) },
    });
    await svc.handle({ sessionId: "00000000-0000-4000-8000-000000000008", channel: "web", locale: LOCALE, userText: EMERGENCY } as any);
    expect(created).toEqual([]);
    const draining = svc.onModuleDestroy();
    release();
    await draining;
    expect(created).toEqual(["message:user", "message:assistant", expect.stringMatching(/^safetyEvent:emergency_fast_path_/)]);
  });

  it("gives up after a short bound when the writes hang", async () => {
    const svc = buildService({
      $queryRaw: jest.fn(async () => [sessionRow]),
      message: { count: jest.fn(async () => 0), create: jest.fn(hang) },
      safetyEvent: { create: jest.fn(hang) },
      analyticsEvent: { create: jest.fn(hang) },
    });
    await svc.handle({ sessionId: "00000000-0000-4000-8000-000000000009", channel: "web", locale: LOCALE, userText: EMERGENCY } as any);
    const started = Date.now();
    await svc.onModuleDestroy();
    expect(Date.now() - started).toBeLessThan(3_500);
  }, 10_000);

  it("returns at once with nothing pending", async () => {
    const svc = buildService({});
    const started = Date.now();
    await svc.onModuleDestroy();
    expect(Date.now() - started).toBeLessThan(50);
  });
});

describe("ChatService urgency path on a long message (PR #202, review B2)", () => {
  // Urgency-only phrases (no fast path, no safety rule) beyond 4096
  // characters. Main answers them with the urgent escalation template (the
  // 112 and 108 block). Synthetic text.
  const EN_LONG_URGENT = "I have some questions about my treatment plan. ".repeat(200) + " weakness on one side";
  const HI_LONG_URGENT = "मेरे इलाज के बारे में कुछ सवाल हैं। ".repeat(400) + " coughed up blood";
  const S2_HEAD = ResponseTemplates.S2({ isFirstMessage: true, userText: "" } as any).split("\n\n")[0];
  const CHUNK = {
    id: "chunk-1",
    docId: "doc-1",
    chunkId: "chunk-1",
    text: "Synthetic evidence text about getting urgent care.",
    similarity: 0.9,
    document: { sourceType: "NCI", isTrustedSource: true, title: "Synthetic" },
  };
  const sessionRow = {
    id: "s",
    createdAt: new Date(0),
    channel: "web",
    locale: "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
  const rows = () => ({
    create: jest.fn(async (args: any) => ({ id: args?.data?.id ?? "row", ...(args?.data ?? {}) })),
    createMany: jest.fn(async () => ({ count: 0 })),
    update: jest.fn(async () => ({})),
    count: jest.fn(async () => 0),
    findMany: jest.fn(async () => []),
  });
  const build = (chunks: any[], llmAnswer: string | null) =>
    buildService(
      {
        $queryRaw: jest.fn(async () => [sessionRow]),
        message: rows(),
        messageCitation: rows(),
        safetyEvent: rows(),
        analyticsEvent: rows(),
        session: rows(),
      },
      {
        rag: { retrieveWithMetadata: jest.fn(async () => chunks), retrieveWithExpansion: jest.fn(async () => chunks) },
        llm: {
          generateWithCitations: jest.fn(async () => {
            if (llmAnswer === null) throw new Error("LLM unavailable");
            return llmAnswer;
          }),
        },
        citations: {
          extractCitations: jest.fn(() => ({ citations: [], orphanCount: 0 })),
          validateCitations: jest.fn(() => ({ isValid: true, confidenceLevel: "GREEN", citations: [] })),
          enrichCitations: jest.fn(async () => []),
        },
        review: {
          copilotMode: "off",
          review: jest.fn(async () => ({ verdict: "PASS", hardFailures: [] })),
          persistRecord: jest.fn(async () => undefined),
          buildBlockedFallback: jest.fn(),
        },
      },
    );

  beforeEach(() => {
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  const turn = (svc: ChatService, text: string) =>
    svc.handle({ sessionId: "00000000-0000-4000-8000-00000000000c", channel: "web", userText: text } as any) as Promise<any>;

  it.each([
    ["English", EN_LONG_URGENT],
    ["Devanagari", HI_LONG_URGENT],
  ])("%s: the template fallback with no retrieval sends the urgent escalation", async (_n, text) => {
    expect(new AbstentionService().hasUrgencyIndicators(text.slice(0, 4096))).toBe(false);
    const result = await turn(build([], null), text);
    expect(result.safety.classification).toBe("red_flag");
    expect(result.responseText.startsWith(S2_HEAD)).toBe(true);
    expect(result.responseText).toContain("**112**");
  });

  it.each([
    ["English", EN_LONG_URGENT],
    ["Devanagari", HI_LONG_URGENT],
  ])("%s: the template fallback when the LLM fails sends the urgent escalation", async (_n, text) => {
    const result = await turn(build([CHUNK], null), text);
    expect(result.safety.classification).toBe("red_flag");
    expect(result.responseText.startsWith(S2_HEAD)).toBe(true);
    expect(result.responseText).toContain("**112**");
  });

  it.each([
    ["English", EN_LONG_URGENT],
    ["Devanagari", HI_LONG_URGENT],
  ])("%s: with retrieval and the LLM the escalation leads and the answer follows", async (_n, text) => {
    const result = await turn(build([CHUNK], "Synthetic educational answer [citation:doc-1:chunk-1]."), text);
    expect(result.safety.classification).toBe("red_flag");
    expect(result.safety.bannerText.startsWith(S2_HEAD)).toBe(true);
    expect(result.safety.bannerText).toContain("**112**");
    expect(result.responseText.startsWith(result.safety.bannerText)).toBe(true);
    expect(result.responseText).toContain("Synthetic educational answer");
  });
});

describe("ChatService above the 20,000 character ceiling (PR #202, review N3)", () => {
  // No length is refused. handle() cuts at the ceiling, so a phrase inside
  // the first 20,000 characters is answered. Synthetic text.
  const FILLER = "I have some questions about my treatment plan. ";
  const sessionRow = {
    id: "s",
    createdAt: new Date(0),
    channel: "web",
    locale: "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
  const rows = () => ({
    create: jest.fn(async (args: any) => ({ id: args?.data?.id ?? "row", ...(args?.data ?? {}) })),
    update: jest.fn(async () => ({})),
    count: jest.fn(async () => 0),
    findMany: jest.fn(async () => []),
  });
  const build = () =>
    buildService({
      $queryRaw: jest.fn(async () => [sessionRow]),
      message: rows(),
      safetyEvent: rows(),
      analyticsEvent: rows(),
      session: rows(),
    });

  beforeEach(() => {
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it("a 30,000 character message with an emergency phrase at the start gets the template", async () => {
    const text = EMERGENCY + ". " + FILLER.repeat(700);
    expect(text.length).toBeGreaterThan(30_000);
    const result: any = await build().handle({
      sessionId: "00000000-0000-4000-8000-00000000000d",
      channel: "web",
      locale: LOCALE,
      userText: text,
    } as any);
    expect(result.safety.classification).toBe("red_flag");
    expect(result.responseText).toContain("112");
  });

  it("a phrase only beyond 20,000 characters is outside the ceiling (known limit)", async () => {
    const text = FILLER.repeat(450) + " " + SELF_HARM;
    expect(text.indexOf(SELF_HARM)).toBeGreaterThan(20_000);
    const svc: any = build();
    jest.spyOn(svc.greetingFlow, "isGreetingFlowInProgress").mockRejectedValue(new Error("PAST_SAFETY_GATES"));
    await expect(
      svc.handle({ sessionId: "00000000-0000-4000-8000-00000000000e", channel: "web", locale: LOCALE, userText: text }),
    ).rejects.toThrow("PAST_SAFETY_GATES");
  });
});
