import { EmpathyDetector } from "../chat/empathy-detector";
import { cleanResponseForDisplay } from "../chat/display-text-cleaner";
import { AbstentionService } from "../abstention/abstention.service";
import { evaluateEmergencyFastPath } from "../safety/emergency-fast-path";
import { SafetyService } from "../safety/safety.service";
import { inboundLedgerId, WhatsAppDeliveryError, WhatsAppService } from "./whatsapp.service";
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

const NOW_MS = Date.UTC(2026, 0, 15, 10, 0, 0);
const secondsAgo = (s: number) => String(Math.floor(NOW_MS / 1000) - s);

function webhook(messages: MetaMessage[]): MetaWebhookBody {
  return { entry: [{ changes: [{ value: { messages } }] }] };
}

function captioned(id: string, from: string, type: "image" | "video" | "document", caption: string, age = 5): MetaMessage {
  return { id, from, type, [type]: { caption }, timestamp: secondsAgo(age) } as MetaMessage;
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
    chat = { handle: jest.fn().mockResolvedValue({ responseText: ANSWER }) };
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
      expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, CAPTION_MEDIA_NOTICE);
      expect(payload("w1")).toMatchObject({
        status: "processed",
        partsSent: 1,
        messageType: type,
        captionNote: true,
        captionNoteSent: true,
      });
    },
  );

  it("sends the note only after the answer's send has finished", async () => {
    const order: string[] = [];
    let finishAnswer!: () => void;
    sendText.mockImplementation(async (_to: string, text: string) => {
      if (text === ANSWER) {
        order.push("answer started");
        await new Promise<void>((resolve) => (finishAnswer = resolve));
        order.push("answer accepted");
      } else {
        order.push("note");
      }
      return 1;
    });

    const done = run([captioned("w1", CONTACT_A, "image", "synthetic question")]);
    await jest.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["answer started"]);
    finishAnswer();
    await done;
    expect(order).toEqual(["answer started", "answer accepted", "note"]);
  });

  it("does not send the note for media without a caption, which gets the typed-messages notice only", async () => {
    await run([{ id: "w1", from: CONTACT_A, type: "image", timestamp: secondsAgo(5) }]);

    expect(chat.handle).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
    expect(payload("w1")).not.toHaveProperty("captionNote");
  });

  it("does not send the note for a plain text message", async () => {
    await run([{ id: "w1", from: CONTACT_A, type: "text", text: { body: "synthetic question" }, timestamp: secondsAgo(5) }]);

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

    // Every message is answered. Contact A gets one note, contact B gets its own.
    expect(chat.handle).toHaveBeenCalledTimes(3);
    expect(sendText.mock.calls.filter((c) => c[0] === CONTACT_A && c[1] === CAPTION_MEDIA_NOTICE)).toHaveLength(1);
    expect(sendText.mock.calls.filter((c) => c[0] === CONTACT_B && c[1] === CAPTION_MEDIA_NOTICE)).toHaveLength(1);
    expect(payload("w2")).toMatchObject({ status: "processed", captionNote: true, captionNoteSent: false });

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
    expect(sendText).toHaveBeenNthCalledWith(3, CONTACT_A, CAPTION_MEDIA_NOTICE);
  });

  it("sends an emergency caption's safety reply first and unchanged, then the note", async () => {
    // Probe from emergency-fast-path.spec.ts, as in whatsapp.notices.spec.ts.
    const caption = "I can't breathe properly";
    const fastPath = evaluateEmergencyFastPath(caption);
    expect(fastPath.isEmergency).toBe(true);
    chat.handle.mockResolvedValue({
      responseText: fastPath.responseText,
      safety: { classification: "red_flag", actions: ["show_emergency_banner"] },
    });

    await run([captioned("w1", CONTACT_A, "image", caption)]);

    expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: caption }));
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText.mock.calls[0][1]).toBe(cleanResponseForDisplay(fastPath.responseText!));
    expect(sendText.mock.calls[0][1]).not.toContain(CAPTION_MEDIA_NOTICE);
    expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, CAPTION_MEDIA_NOTICE);
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
    expect(sendText.mock.calls[0][1]).toMatch(/something went wrong/);
    expect(notesSent()).toBe(0);
  });

  it("sends no note after a degraded template reply from the pipeline", async () => {
    chat.handle.mockResolvedValue({ responseText: "Synthetic try-again template.", error: "budget_exhausted_before_llm" });

    await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(notesSent()).toBe(0);
    expect(payload("w1")).toMatchObject({ status: "processed", partsSent: 1 });
  });

  it("when the note fails, the turn stays processed, the slot is freed and no fallback is sent", async () => {
    sendText.mockImplementation(async (_to: string, text: string) => {
      if (text === CAPTION_MEDIA_NOTICE) throw new WhatsAppDeliveryError("WhatsApp send failed (500)", 0, "http", 500);
      return 1;
    });
    const warn = jest.spyOn((svc as any).logger, "warn");

    await run([captioned("w1", CONTACT_A, "image", "synthetic question")]);

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText.mock.calls.some((c) => /something went wrong/.test(c[1]))).toBe(false);
    expect(payload("w1")).toMatchObject({ status: "processed", partsSent: 1, captionNote: true, captionNoteSent: false });
    expect(payload("w1")).not.toHaveProperty("failedStage");
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("caption note");
    expect(logged).not.toContain(CONTACT_A);
    expect(logged).not.toContain("synthetic question");

    // The slot was freed: the next captioned attachment gets the note.
    sendText.mockResolvedValue(1);
    sendText.mockClear();
    await run([captioned("w2", CONTACT_A, "image", "another synthetic question")]);
    expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, CAPTION_MEDIA_NOTICE);
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

    it("a stale captioned emergency runs the pipeline, then gets the note", async () => {
      await run([captioned("w1", CONTACT_A, "image", "I can't breathe properly", 7 * 3600)]);

      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenNthCalledWith(1, CONTACT_A, ANSWER);
      expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, CAPTION_MEDIA_NOTICE);
      expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
    });
  });
});
