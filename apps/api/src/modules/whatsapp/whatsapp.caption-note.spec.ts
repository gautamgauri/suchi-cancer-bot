import { EmpathyDetector } from "../chat/empathy-detector";
import { cleanResponseForDisplay } from "../chat/display-text-cleaner";
import { AbstentionService } from "../abstention/abstention.service";
import { evaluateEmergencyFastPath } from "../safety/emergency-fast-path";
import { SafetyService } from "../safety/safety.service";
import {
  CAPTION_NOTE_TIMEOUT_MS,
  inboundLedgerId,
  SEND_TIMEOUT_MS,
  WhatsAppDeliveryError,
  WhatsAppService,
} from "./whatsapp.service";
import {
  CAPTION_MEDIA_NOTICE,
  NOTICE_COOLDOWN_MS,
  STALE_MESSAGE_NOTICE,
  UNSUPPORTED_TYPE_NOTICE,
} from "./whatsapp-notices";
import { MetaMessage, MetaWebhookBody } from "./whatsapp.types";

// Synthetic contact ids only. No real number appears in this file.
const CONTACT_A = "910000000001";
const CONTACT_B = "910000000002";
const ANSWER = "Here is some info.";
const NORMAL = { classification: "normal", actions: [] };
const NOTE_OPTS = { retry: false, timeoutMs: CAPTION_NOTE_TIMEOUT_MS };

// Probes from whatsapp.notices.spec.ts (originally emergency-fast-path.spec.ts
// and safety.service.spec.ts).
const EMERGENCY = "I can't breathe properly";
const SELF_HARM = "I want to kill myself";

const NOW_MS = Date.UTC(2026, 0, 15, 10, 0, 0);
const secondsAgo = (s: number) => String(Math.floor(NOW_MS / 1000) - s);

function webhook(messages: MetaMessage[]): MetaWebhookBody {
  return { entry: [{ changes: [{ value: { messages } }] }] };
}

function captioned(id: string, from: string, type: "image" | "video" | "document", caption: string, age = 5): MetaMessage {
  return { id, from, type, [type]: { caption }, timestamp: secondsAgo(age) } as MetaMessage;
}

function text(id: string, from: string, body: string): MetaMessage {
  return { id, from, type: "text", text: { body }, timestamp: secondsAgo(5) };
}

function makeLedgerMock() {
  const rows = new Map<string, any>();
  return {
    rows,
    create: jest.fn(async ({ data }: any) => {
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

describe("WhatsApp note after answering a captioned attachment", () => {
  let chat: any;
  let ledger: ReturnType<typeof makeLedgerMock>;
  let svc: WhatsAppService;
  let sendText: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW_MS });
    delete process.env.WHATSAPP_STALE_MESSAGE_MINUTES;
    ledger = makeLedgerMock();
    const prisma: any = {
      whatsAppContact: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
      analyticsEvent: ledger,
    };
    chat = { handle: jest.fn().mockResolvedValue({ responseText: ANSWER, safety: NORMAL }) };
    const sessions: any = { create: jest.fn().mockResolvedValue({ id: "sess-new", createdAt: new Date() }) };
    svc = new WhatsAppService(prisma, chat, sessions, new SafetyService(), new AbstentionService(), new EmpathyDetector());
    sendText = jest.spyOn(svc, "sendText").mockResolvedValue(1);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete process.env.WHATSAPP_STALE_MESSAGE_MINUTES;
  });

  const run = (messages: MetaMessage[]) => svc.processInbound(svc.parseInbound(webhook(messages)));
  const payload = (wamid: string) => ledger.rows.get(inboundLedgerId(wamid))?.payload;
  const notesSent = () => sendText.mock.calls.filter((c) => c[1] === CAPTION_MEDIA_NOTICE).length;
  const FALLBACK = /something went wrong/;

  it("uses the wording the owner approved on 21 November 2026, Hindi first", () => {
    expect(CAPTION_MEDIA_NOTICE).toBe(
      "मैं फ़ोटो या फ़ाइलें नहीं देख सकती, इसलिए मैंने केवल आपके लिखे हुए संदेश का जवाब दिया है।\n\n" +
        "I cannot see photos or files, so I have answered your written message only.",
    );
  });

  it.each(["image", "video", "document"] as const)(
    "answers a captioned %s from its caption, then sends the note as a separate message",
    async (type) => {
      await run([captioned("w1", CONTACT_A, type, "synthetic question")]);

      expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: "synthetic question" }));
      expect(sendText).toHaveBeenCalledTimes(2);
      expect(sendText).toHaveBeenNthCalledWith(1, CONTACT_A, ANSWER);
      // One attempt, no retry, bounded.
      expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, CAPTION_MEDIA_NOTICE, NOTE_OPTS);
      expect(payload("w1")).toMatchObject({
        status: "processed",
        partsSent: 1,
        messageType: type,
        captionNote: true,
        captionNoteSent: true,
      });
      expect(payload("w1")).not.toHaveProperty("captionNoteSkipped");
    },
  );

  it("records the answer as processed before the note is sent, and starts the note only after the answer", async () => {
    const order: string[] = [];
    sendText.mockImplementation(async (_to: string, t: string) => {
      order.push(t === ANSWER ? "answer" : `note (row ${payload("w1")?.status})`);
      return 1;
    });

    await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);
    expect(order).toEqual(["answer", "note (row processed)"]);
  });

  it("does not send the note for media without a caption, which gets the typed-messages notice only", async () => {
    await run([{ id: "w1", from: CONTACT_A, type: "image", timestamp: secondsAgo(5) }]);

    expect(chat.handle).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
    expect(payload("w1")).not.toHaveProperty("captionNote");
  });

  it("does not send the note for a plain text message", async () => {
    await run([text("w1", CONTACT_A, "synthetic question")]);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(CONTACT_A, ANSWER);
    expect(payload("w1")).not.toHaveProperty("captionNote");
    expect(payload("w1")).not.toHaveProperty("messageType");
  });

  it("sends at most one note per contact inside the cooldown, and records the suppressed one", async () => {
    await run([
      captioned("w1", CONTACT_A, "image", "first synthetic question"),
      captioned("w2", CONTACT_A, "document", "second synthetic question"),
      captioned("w3", CONTACT_B, "image", "synthetic question"),
    ]);

    expect(chat.handle).toHaveBeenCalledTimes(3);
    expect(sendText.mock.calls.filter((c) => c[0] === CONTACT_A && c[1] === CAPTION_MEDIA_NOTICE)).toHaveLength(1);
    expect(sendText.mock.calls.filter((c) => c[0] === CONTACT_B && c[1] === CAPTION_MEDIA_NOTICE)).toHaveLength(1);
    expect(payload("w2")).toMatchObject({
      status: "processed",
      captionNote: true,
      captionNoteSent: false,
      captionNoteSkipped: "cooldown",
    });

    jest.setSystemTime(NOW_MS + NOTICE_COOLDOWN_MS + 1000);
    await run([captioned("w4", CONTACT_A, "image", "later synthetic question", 0)]);
    expect(notesSent()).toBe(3);
  });

  it("keeps its cooldown separate from the typed-messages notice", async () => {
    await run([
      { id: "w1", from: CONTACT_A, type: "image", timestamp: secondsAgo(10) },
      captioned("w2", CONTACT_A, "image", "synthetic question"),
    ]);

    expect(sendText).toHaveBeenNthCalledWith(1, CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
    expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, ANSWER);
    expect(sendText).toHaveBeenNthCalledWith(3, CONTACT_A, CAPTION_MEDIA_NOTICE, NOTE_OPTS);
  });

  describe("after a safety reply", () => {
    it.each([
      ["an emergency", EMERGENCY, evaluateEmergencyFastPath(EMERGENCY).isEmergency ? "red_flag" : "normal"],
      ["a self-harm", SELF_HARM, new SafetyService().evaluate(SELF_HARM).classification],
    ])("%s caption gets its safety reply unchanged and no note", async (_label, caption, classification) => {
      expect(classification).not.toBe("normal");
      const reply = `Synthetic ${classification} reply with helpline numbers.`;
      chat.handle.mockResolvedValueOnce({ responseText: reply, safety: { classification, actions: [] } });

      await run([captioned("w1", CONTACT_A, "image", caption)]);

      expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: caption }));
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, cleanResponseForDisplay(reply));
      expect(payload("w1")).toMatchObject({
        status: "processed",
        partsSent: 1,
        captionNote: true,
        captionNoteSent: false,
        captionNoteSkipped: "safety_reply",
      });

      // No limiter slot was taken: the next ordinary captioned attachment gets the note.
      await run([captioned("w2", CONTACT_A, "image", "synthetic question")]);
      expect(notesSent()).toBe(1);
    });
  });

  it("sends no note when the answer itself failed to send", async () => {
    sendText.mockRejectedValueOnce(new WhatsAppDeliveryError("WhatsApp send failed (401)", 0, "http", 401));

    await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(notesSent()).toBe(0);
    expect(payload("w1")).toMatchObject({ status: "failed", failedStage: "delivery" });
    expect(payload("w1")).not.toHaveProperty("captionNote");
  });

  it("sends no note after the pipeline's generic failure fallback", async () => {
    chat.handle.mockRejectedValue(new Error("synthetic pipeline failure"));

    await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][1]).toMatch(FALLBACK);
    expect(notesSent()).toBe(0);
  });

  it("sends no note after a budget-exhausted template, and says why in the ledger", async () => {
    chat.handle.mockResolvedValue({
      responseText: "Synthetic try-again template.",
      safety: NORMAL,
      error: "budget_exhausted_before_llm",
    });

    await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(notesSent()).toBe(0);
    expect(payload("w1")).toMatchObject({
      status: "processed",
      partsSent: 1,
      captionNote: true,
      captionNoteSent: false,
      captionNoteSkipped: "degraded_reply",
    });
  });

  it("when the note fails, the turn stays processed, the slot is freed and no fallback is sent", async () => {
    sendText.mockImplementation(async (_to: string, t: string) => {
      if (t === CAPTION_MEDIA_NOTICE) throw new WhatsAppDeliveryError("WhatsApp send failed (500)", 0, "http", 500);
      return 1;
    });
    const warn = jest.spyOn((svc as any).logger, "warn");

    await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText.mock.calls.some((c) => FALLBACK.test(c[1]))).toBe(false);
    expect(payload("w1")).toMatchObject({
      status: "processed",
      partsSent: 1,
      captionNote: true,
      captionNoteSent: false,
      captionNoteFailed: true,
    });
    expect(payload("w1")).not.toHaveProperty("failedStage");
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("caption note");
    expect(logged).not.toContain(CONTACT_A);
    expect(logged).not.toContain("synthetic question");

    sendText.mockResolvedValue(1);
    sendText.mockClear();
    await run([captioned("w2", CONTACT_A, "image", "another synthetic question")]);
    expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, CAPTION_MEDIA_NOTICE, NOTE_OPTS);
  });

  it("a fault in the limiter cannot turn a good answer into a fallback or a failed row", async () => {
    jest.spyOn((svc as any).noticeLimiter, "tryAcquire").mockImplementation(() => {
      throw new Error("synthetic limiter fault");
    });

    await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(CONTACT_A, ANSWER);
    expect(sendText.mock.calls.some((c) => FALLBACK.test(c[1]))).toBe(false);
    expect(payload("w1")).toMatchObject({ status: "processed", partsSent: 1, captionNoteSent: false });
    expect(payload("w1")).not.toHaveProperty("failedStage");
  });

  it("a failed write of the note's ledger fields does not affect the turn", async () => {
    const update = ledger.update.getMockImplementation()!;
    ledger.update.mockImplementation(async (args: any) => {
      if ("captionNote" in args.data.payload) throw new Error("synthetic ledger fault");
      return update(args);
    });

    await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

    expect(notesSent()).toBe(1);
    expect(sendText.mock.calls.some((c) => FALLBACK.test(c[1]))).toBe(false);
    expect(payload("w1")).toMatchObject({ status: "processed", partsSent: 1 });
  });

  it("records messageType for captioned media at claim time", async () => {
    for (const [id, type] of [["w1", "image"], ["w2", "video"], ["w3", "document"]] as const) {
      await svc.claimInbound(svc.parseInbound(webhook([captioned(id, CONTACT_A, type, "synthetic question")])));
      expect(payload(id)).toMatchObject({ status: "received", messageType: type });
      expect(JSON.stringify(ledger.rows.get(inboundLedgerId(id)))).not.toContain(CONTACT_A);
    }
  });

  describe("with the stale guard on", () => {
    beforeEach(() => {
      process.env.WHATSAPP_STALE_MESSAGE_MINUTES = "30";
    });

    it("a stale captioned attachment gets the stale notice only, and the pipeline does not run", async () => {
      await run([captioned("w1", CONTACT_A, "image", "synthetic question", 7 * 3600)]);

      expect(chat.handle).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
    });

    it("a stale captioned emergency runs the pipeline and gets its safety reply, with no stale notice and no note", async () => {
      chat.handle.mockResolvedValueOnce({ responseText: "Synthetic red_flag reply.", safety: { classification: "red_flag", actions: [] } });

      await run([captioned("w1", CONTACT_A, "image", EMERGENCY, 7 * 3600)]);

      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
      expect(payload("w1")).toMatchObject({ captionNoteSkipped: "safety_reply" });
    });

    it("a stale captioned message that a check flags but the pipeline answers normally gets the answer, then the note", async () => {
      await run([captioned("w1", CONTACT_A, "image", EMERGENCY, 7 * 3600)]);

      expect(sendText).toHaveBeenNthCalledWith(1, CONTACT_A, ANSWER);
      expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, CAPTION_MEDIA_NOTICE, NOTE_OPTS);
    });
  });

  // Through the real sendText and postPart, with fetch stubbed.
  describe("Graph API requests", () => {
    let fetchMock: jest.Mock;
    const ok = () => ({ ok: true, status: 200, text: async () => "{}" });
    const status = (s: number) => ({ ok: false, status: s, text: async () => '{"error":{"code":1}}' });
    /** A request that never settles on its own, like a hung connection. It honours the abort signal, as fetch does. */
    const hang = (_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason ?? new Error("aborted")));
      });
    const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).text.body);

    beforeEach(() => {
      sendText.mockRestore();
      process.env.META_WABA_PHONE_NUMBER_ID = "PNID";
      process.env.META_WABA_TOKEN = "tok";
      fetchMock = jest.fn();
      jest.spyOn(global, "fetch").mockImplementation(fetchMock as any);
      svc.retryDelayMs = 0;
    });

    afterEach(() => {
      delete process.env.META_WABA_PHONE_NUMBER_ID;
      delete process.env.META_WABA_TOKEN;
    });

    it("sends the note through postPart with an abort signal", async () => {
      fetchMock.mockResolvedValue(ok());

      await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

      expect(bodies()).toEqual([ANSWER, CAPTION_MEDIA_NOTICE]);
      for (const call of fetchMock.mock.calls) expect(call[1].signal).toBeInstanceOf(AbortSignal);
      expect(payload("w1")).toMatchObject({ status: "processed", partsSent: 1, captionNoteSent: true });
    });

    it("does not retry a note that gets a 500", async () => {
      fetchMock.mockResolvedValueOnce(ok()).mockResolvedValue(status(500));

      await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

      expect(bodies()).toEqual([ANSWER, CAPTION_MEDIA_NOTICE]);
      expect(payload("w1")).toMatchObject({ status: "processed", partsSent: 1, captionNoteFailed: true });
    });

    it("abandons a note that never settles, keeps the row processed and frees the contact's queue within the bound", async () => {
      fetchMock.mockImplementation(async (url: string, init: any) => {
        const t = JSON.parse(init.body).text.body;
        return t === CAPTION_MEDIA_NOTICE ? hang(url, init) : ok();
      });

      const done = run([
        captioned("w1", CONTACT_A, "image", "synthetic question"),
        text("w2", CONTACT_A, "next synthetic question"),
      ]);
      await jest.advanceTimersByTimeAsync(0);
      // The answer is recorded while the note is still in flight.
      expect(payload("w1")).toMatchObject({ status: "processed", partsSent: 1 });
      expect(chat.handle).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(CAPTION_NOTE_TIMEOUT_MS);
      await done;

      expect(chat.handle).toHaveBeenCalledTimes(2);
      expect(payload("w1")).toMatchObject({
        status: "processed",
        partsSent: 1,
        captionNoteSent: false,
        captionNoteFailed: true,
      });
      expect(payload("w2")).toMatchObject({ status: "processed", partsSent: 1 });
      // One note attempt only.
      expect(bodies().filter((b) => b === CAPTION_MEDIA_NOTICE)).toHaveLength(1);

      // The slot was freed.
      fetchMock.mockResolvedValue(ok());
      await run([captioned("w3", CONTACT_A, "image", "later synthetic question")]);
      expect(payload("w3")).toMatchObject({ captionNoteSent: true });
    });

    it("an answer whose request never settles ends in a recorded delivery failure and frees the queue", async () => {
      fetchMock.mockImplementation(async (url: string, init: any) => {
        const t = JSON.parse(init.body).text.body;
        return t === ANSWER ? hang(url, init) : ok();
      });
      chat.handle
        .mockResolvedValueOnce({ responseText: ANSWER, safety: NORMAL })
        .mockResolvedValueOnce({ responseText: "Second synthetic answer.", safety: NORMAL });

      const done = run([text("w1", CONTACT_A, "synthetic question"), text("w2", CONTACT_A, "next synthetic question")]);
      let settled = false;
      void done.then(() => (settled = true));
      // First attempt times out, then the single retry times out too.
      await jest.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1000);
      expect(settled).toBe(true);
      await done;

      expect(bodies().filter((b) => b === ANSWER)).toHaveLength(2);
      expect(payload("w1")).toMatchObject({ status: "failed", failedStage: "delivery", partsSent: 0 });
      expect(payload("w1").error).toMatch(/network/);
      // No fallback down the dead request, and the next message was processed.
      expect(bodies().some((b) => FALLBACK.test(b))).toBe(false);
      expect(payload("w2")).toMatchObject({ status: "processed" });
    });
  });
});
