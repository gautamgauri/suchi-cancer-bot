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

function buildService(prisma: any): ChatService {
  const empathy = new EmpathyDetector();
  const abstention = new AbstentionService();
  const intent = new IntentClassifier(abstention);
  const fail = () => Promise.reject(new Error("unavailable"));
  return new ChatService(
    prisma,
    new AnalyticsService(prisma),
    new SafetyService(),
    { retrieveWithMetadata: jest.fn(fail), retrieveWithExpansion: jest.fn(fail) } as any,
    { generateWithCitations: jest.fn(fail), generateRaw: jest.fn(fail), generate: jest.fn(fail) } as any,
    { validateEvidence: jest.fn() } as any,
    { extractCitations: jest.fn(), validateCitations: jest.fn(), enrichCitations: jest.fn() } as any,
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
    { copilotMode: "off", review: jest.fn(fail), persistRecord: jest.fn(fail), buildBlockedFallback: jest.fn() } as any,
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

  it("cuts a long emergency message to the pipeline bound and still escalates", async () => {
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
