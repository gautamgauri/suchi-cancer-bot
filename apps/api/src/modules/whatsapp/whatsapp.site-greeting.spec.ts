import { EmpathyDetector } from "../chat/empathy-detector";
import { AbstentionService } from "../abstention/abstention.service";
import { SafetyService } from "../safety/safety.service";
import { SessionsService } from "../sessions/sessions.service";
import { tallySessionsBySource } from "../analytics/daily-report.service";
import { inboundLedgerId, WhatsAppService } from "./whatsapp.service";
import { SOURCE_ONLY_TEXT } from "./whatsapp-source";
import { MetaWebhookBody } from "./whatsapp.types";

/**
 * The website's "Ask on WhatsApp" links prefill a greeting that ends with a
 * `(src: <code>)` line. The line must be removed before the pipeline runs,
 * and the code recorded on session_created (so the daily report counts the
 * session under it, as it does for web `?src=` codes) and on the inbound
 * ledger row. Only the validated code is stored.
 */

const GREETING_TEXT = "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.";
const SITE_CODES = ["wa-header", "wa-article", "wa-video", "wa-hospitals"];

function siteGreeting(code: string): string {
  return `${GREETING_TEXT}\n(src: ${code})`;
}

function makeLedgerMock() {
  const rows = new Map<string, any>();
  return {
    rows,
    create: jest.fn(async ({ data }: any) => {
      if (rows.has(data.id)) {
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        throw err;
      }
      rows.set(data.id, { ...data });
      return data;
    }),
    findUnique: jest.fn(async ({ where }: any) => rows.get(where.id) ?? null),
    update: jest.fn(async ({ where, data }: any) => {
      const row = { ...(rows.get(where.id) ?? { id: where.id }), ...data };
      rows.set(where.id, row);
      return row;
    }),
  };
}

function textWebhook(wamid: string, from: string, body: string, type = "text"): MetaWebhookBody {
  const message: any = { id: wamid, from, type };
  if (type === "text") message.text = { body };
  if (type === "image") message.image = { caption: body };
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages: [message] } }] }],
  };
}

describe("WhatsApp: the website greeting and its source code", () => {
  let prisma: any;
  let chat: any;
  let analytics: { emit: jest.Mock };
  let sessions: SessionsService;
  let ledger: ReturnType<typeof makeLedgerMock>;
  let svc: WhatsAppService;

  beforeEach(() => {
    process.env.META_WABA_PHONE_NUMBER_ID = "PNID";
    process.env.META_WABA_TOKEN = "tok";
    process.env.META_APP_SECRET = "secret";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify";
    process.env.WHATSAPP_SESSION_TTL_HOURS = "24";

    ledger = makeLedgerMock();
    prisma = {
      whatsAppContact: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
      analyticsEvent: ledger,
      // SessionsService.create inserts with raw SQL.
      $queryRaw: jest.fn().mockResolvedValue([{ id: "sess-new", createdAt: new Date() }]),
    };
    chat = { handle: jest.fn().mockResolvedValue({ responseText: "Hi.", safety: { classification: "normal" } }) };
    analytics = { emit: jest.fn().mockResolvedValue(undefined) };
    // The real SessionsService, so the session_created payload is the one production emits.
    sessions = new SessionsService(prisma, analytics as any);
    jest.spyOn(sessions, "create");

    svc = new WhatsAppService(prisma, chat, sessions, new SafetyService(), new AbstentionService(), new EmpathyDetector());
    jest.spyOn(svc, "sendText").mockResolvedValue(1);
  });

  afterEach(() => jest.restoreAllMocks());

  async function receive(wamid: string, body: string, type = "text") {
    const msgs = svc.parseInbound(textWebhook(wamid, "9199", body, type));
    await svc.processInbound(msgs);
    return msgs;
  }

  function sessionCreatedPayloads(): any[] {
    return analytics.emit.mock.calls.filter((c) => c[0] === "session_created").map((c) => c[1]);
  }

  it.each(SITE_CODES)("strips the source line before the pipeline and records %s", async (code) => {
    const [msg] = await receive(`w-${code}`, siteGreeting(code));

    expect(msg.text).toBe(GREETING_TEXT);
    expect(msg.sourceCode).toBe(code);

    // The pipeline (and so the LLM, retrieval and the stored user message,
    // which all take dto.userText) gets the greeting without the source line.
    expect(chat.handle).toHaveBeenCalledTimes(1);
    const dto = chat.handle.mock.calls[0][0];
    expect(dto.userText).toBe(GREETING_TEXT);
    expect(dto.userText).not.toContain("src");
    expect(dto.channel).toBe("whatsapp");
    expect(dto.locale).toBe("hi");

    // session_created carries the code, as the web path does.
    expect(sessions.create).toHaveBeenCalledWith({ channel: "whatsapp", locale: "hi" }, undefined, false, { src: code });
    expect(sessionCreatedPayloads()).toEqual([expect.objectContaining({ channel: "whatsapp", src: code })]);
    expect(tallySessionsBySource(sessionCreatedPayloads())).toEqual([{ source: code, count: 1 }]);

    // The ledger row carries the code only, with no message text.
    const row = ledger.rows.get(inboundLedgerId(`w-${code}`));
    expect(row.payload).toMatchObject({ src: code, status: "processed", textLength: GREETING_TEXT.length });
    expect(JSON.stringify(row.payload)).not.toContain("Suchi");
    expect(JSON.stringify(row.payload)).not.toContain("(src:");
  });

  it("records the code on the ledger only when the contact already has an active session", async () => {
    prisma.whatsAppContact.findUnique.mockResolvedValue({ waId: "9199", sessionId: "sess-live", lastActiveAt: new Date() });
    await receive("w-existing", siteGreeting("wa-video"));

    expect(sessions.create).not.toHaveBeenCalled();
    expect(chat.handle.mock.calls[0][0]).toMatchObject({ sessionId: "sess-live", userText: GREETING_TEXT });
    expect(ledger.rows.get(inboundLedgerId("w-existing")).payload).toMatchObject({ src: "wa-video" });
  });

  it("carries the code to a session re-minted after a stale session id", async () => {
    prisma.whatsAppContact.findUnique.mockResolvedValueOnce({ waId: "9199", sessionId: "sess-gone", lastActiveAt: new Date() });
    chat.handle.mockRejectedValueOnce(new Error("Invalid sessionId")).mockResolvedValueOnce({ responseText: "Hi." });
    await receive("w-heal", siteGreeting("wa-header"));

    expect(sessions.create).toHaveBeenCalledWith({ channel: "whatsapp", locale: "hi" }, undefined, false, { src: "wa-header" });
    for (const call of chat.handle.mock.calls) expect(call[0].userText).toBe(GREETING_TEXT);
  });

  it("treats a message holding only the source line as a plain greeting", async () => {
    await receive("w-only", "(src: wa-article)");
    expect(chat.handle.mock.calls[0][0].userText).toBe(SOURCE_ONLY_TEXT);
    expect(ledger.rows.get(inboundLedgerId("w-only")).payload).toMatchObject({ src: "wa-article" });
  });

  it("leaves an invalid source line in the text and records nothing", async () => {
    const body = `${GREETING_TEXT}\n(src: WA Article)`;
    await receive("w-bad", body);

    expect(chat.handle.mock.calls[0][0].userText).toBe(body);
    expect(sessions.create).toHaveBeenCalledWith({ channel: "whatsapp", locale: "hi" });
    expect(sessionCreatedPayloads()[0]).not.toHaveProperty("src");
    expect(ledger.rows.get(inboundLedgerId("w-bad")).payload).not.toHaveProperty("src");
  });

  it("leaves a source line that is not the last line in the text", async () => {
    const body = "Hello\n(src: wa-article)\nmy question";
    await receive("w-mid", body);
    expect(chat.handle.mock.calls[0][0].userText).toBe(body);
    expect(ledger.rows.get(inboundLedgerId("w-mid")).payload).not.toHaveProperty("src");
  });

  it("does not change an ordinary message", async () => {
    await receive("w-plain", "breast cancer ke symptoms kya hain?");
    expect(chat.handle.mock.calls[0][0].userText).toBe("breast cancer ke symptoms kya hain?");
    expect(sessions.create).toHaveBeenCalledWith({ channel: "whatsapp", locale: "en" });
    expect(ledger.rows.get(inboundLedgerId("w-plain")).payload).not.toHaveProperty("src");
  });

  it("strips the source line before the stale-message safety check sees the text", async () => {
    // A greeting plus an emergency phrase, delivered long after it was sent:
    // the safety check must still see the emergency phrase and run the pipeline.
    // The guard ships off, so it is switched on here.
    process.env.WHATSAPP_STALE_MESSAGE_MINUTES = "60";
    try {
      const old = String(Math.floor(Date.now() / 1000) - 6 * 3600);
      const stale = (wamid: string, body: string) => {
        const hook = textWebhook(wamid, "9199", body);
        (hook.entry![0].changes![0].value!.messages![0] as any).timestamp = old;
        return svc.parseInbound(hook);
      };

      // A plain stale greeting gets the stale notice. The pipeline is not run.
      await svc.processInbound(stale("w-stale-greeting", siteGreeting("wa-article")));
      expect(chat.handle).not.toHaveBeenCalled();
      expect(ledger.rows.get(inboundLedgerId("w-stale-greeting")).payload).toMatchObject({ notice: "stale", src: "wa-article" });

      // With an emergency phrase the safety checks still see it and the pipeline runs.
      await svc.processInbound(stale("w-stale-urgent", "नमस्ते सुचि\nखून बहुत आ रहा है\n(src: wa-article)"));
      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(chat.handle.mock.calls[0][0].userText).toBe("नमस्ते सुचि\nखून बहुत आ रहा है");
    } finally {
      delete process.env.WHATSAPP_STALE_MESSAGE_MINUTES;
    }
  });
});
