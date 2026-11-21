import { inboundLedgerId, WhatsAppService } from "./whatsapp.service";
import {
  NOTICE_COOLDOWN_MS,
  NoticeLimiter,
  STALE_MESSAGE_NOTICE,
  UNSUPPORTED_TYPE_NOTICE,
  noticeKindFor,
  parseSentAt,
  staleThresholdMs,
} from "./whatsapp-notices";
import { InboundMessage, MetaMessage, MetaWebhookBody } from "./whatsapp.types";

// Synthetic contact ids only. No real number appears in this file.
const CONTACT_A = "910000000001";
const CONTACT_B = "910000000002";

const NOW_MS = Date.UTC(2026, 0, 15, 10, 0, 0);
const secondsAgo = (s: number) => String(Math.floor(NOW_MS / 1000) - s);

function webhook(messages: MetaMessage[]): MetaWebhookBody {
  return { entry: [{ changes: [{ value: { messages } }] }] };
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

describe("WhatsApp fixed notices", () => {
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
    chat = { handle: jest.fn().mockResolvedValue({ responseText: "Here is some info." }) };
    const sessions: any = { create: jest.fn().mockResolvedValue({ id: "sess-new", createdAt: new Date() }) };
    svc = new WhatsAppService(prisma, chat, sessions);
    sendText = jest.spyOn(svc, "sendText").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete process.env.WHATSAPP_STALE_MESSAGE_MINUTES;
  });

  const ledgerStatus = (wamid: string) => ledger.rows.get(inboundLedgerId(wamid))?.payload?.status;

  describe("wording", () => {
    it("is bilingual, Hindi in Devanagari first and English second", () => {
      for (const text of [UNSUPPORTED_TYPE_NOTICE, STALE_MESSAGE_NOTICE]) {
        const [hindi, english] = text.split("\n\n");
        expect(hindi).toMatch(/[ऀ-ॿ]/);
        expect(english).toMatch(/^[\x20-\x7E]+$/);
      }
    });
  });

  describe("messages with no readable text", () => {
    it.each(["audio", "image", "video", "document", "location", "contacts"])(
      "parses a %s message as unsupported, with empty text",
      (type) => {
        const out = svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type, timestamp: secondsAgo(5) }]));
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ wamid: "w1", from: CONTACT_A, text: "", unsupportedType: type });
      },
    );

    it.each(["reaction", "sticker", "system", "unsupported"])("still drops a %s message", (type) => {
      expect(svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type }]))).toEqual([]);
    });

    it("still drops a text message whose body is blank", () => {
      expect(svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type: "text", text: { body: "   " } }]))).toEqual([]);
    });

    it("replies once with the fixed notice, closes the ledger row and never calls ChatService", async () => {
      const messages = svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type: "audio", timestamp: secondsAgo(5) }]));
      await svc.processInbound(messages);

      expect(chat.handle).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
      expect(ledgerStatus("w1")).toBe("processed");
    });

    it("records the message type in the ledger row, with no phone number", async () => {
      await svc.processInbound(svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type: "image" }])));
      const row = ledger.rows.get(inboundLedgerId("w1"));
      expect(row.payload).toMatchObject({ messageType: "image", textLength: 0 });
      expect(JSON.stringify(row)).not.toContain(CONTACT_A);
    });

    it("sends one notice for a burst of photos from the same contact", async () => {
      const burst = ["w1", "w2", "w3", "w4"].map((id) => ({ id, from: CONTACT_A, type: "image" }));
      await svc.processInbound(svc.parseInbound(webhook(burst)));

      expect(sendText).toHaveBeenCalledTimes(1);
      expect(chat.handle).not.toHaveBeenCalled();
      for (const id of ["w1", "w2", "w3", "w4"]) expect(ledgerStatus(id)).toBe("processed");
    });

    it("limits per contact: a second contact still gets a notice", async () => {
      await svc.processInbound(
        svc.parseInbound(
          webhook([
            { id: "w1", from: CONTACT_A, type: "image" },
            { id: "w2", from: CONTACT_B, type: "document" },
          ]),
        ),
      );
      expect(sendText).toHaveBeenCalledTimes(2);
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
      expect(sendText).toHaveBeenCalledWith(CONTACT_B, UNSUPPORTED_TYPE_NOTICE);
    });

    it("sends the notice again once the cooldown has passed", async () => {
      await svc.processInbound(svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type: "image" }])));
      jest.setSystemTime(NOW_MS + NOTICE_COOLDOWN_MS + 1000);
      await svc.processInbound(svc.parseInbound(webhook([{ id: "w2", from: CONTACT_A, type: "image" }])));
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    it("does not hold the slot when the send throws, so the next message can be answered", async () => {
      sendText.mockRejectedValueOnce(new Error("graph down"));
      await svc.processInbound(svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type: "image" }])));
      expect(ledgerStatus("w1")).toBe("failed");

      sendText.mockClear();
      await svc.processInbound(svc.parseInbound(webhook([{ id: "w2", from: CONTACT_A, type: "image" }])));
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
      expect(chat.handle).not.toHaveBeenCalled();
    });

    it("a typed message after a photo still runs the pipeline", async () => {
      await svc.processInbound(
        svc.parseInbound(
          webhook([
            { id: "w1", from: CONTACT_A, type: "image", timestamp: secondsAgo(20) },
            { id: "w2", from: CONTACT_A, type: "text", text: { body: "synthetic question" }, timestamp: secondsAgo(5) },
          ]),
        ),
      );
      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: "synthetic question" }));
      expect(sendText).toHaveBeenCalledTimes(2);
    });
  });

  describe("stale messages", () => {
    const text = (id: string, from: string, ageSeconds?: number): MetaMessage => ({
      id,
      from,
      type: "text",
      text: { body: "synthetic question" },
      ...(ageSeconds === undefined ? {} : { timestamp: secondsAgo(ageSeconds) }),
    });

    it("reads the inbound timestamp as epoch seconds", () => {
      const [msg] = svc.parseInbound(webhook([text("w1", CONTACT_A, 60)]));
      expect(msg.sentAt).toBe(Math.floor(NOW_MS / 1000) - 60);
      expect(parseSentAt(undefined)).toBeUndefined();
      expect(parseSentAt("not-a-number")).toBeUndefined();
      expect(parseSentAt("0")).toBeUndefined();
    });

    it("runs the pipeline for a fresh message", async () => {
      await svc.processInbound(svc.parseInbound(webhook([text("w1", CONTACT_A, 29 * 60)])));
      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, "Here is some info.");
    });

    it("runs the pipeline when the timestamp is missing", async () => {
      await svc.processInbound(svc.parseInbound(webhook([text("w1", CONTACT_A)])));
      expect(chat.handle).toHaveBeenCalledTimes(1);
    });

    it("does not run the pipeline for a message older than 30 minutes, and sends the fixed note", async () => {
      await svc.processInbound(svc.parseInbound(webhook([text("w1", CONTACT_A, 31 * 60)])));

      expect(chat.handle).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
      expect(ledgerStatus("w1")).toBe("processed");
    });

    it("sends one note for a redelivered backlog from the same contact and runs none of it", async () => {
      const backlog = ["w1", "w2", "w3"].map((id, i) => text(id, CONTACT_A, 7 * 3600 - i * 60));
      await svc.processInbound(svc.parseInbound(webhook(backlog)));

      expect(chat.handle).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledTimes(1);
      for (const id of ["w1", "w2", "w3"]) expect(ledgerStatus(id)).toBe("processed");
    });

    it("answers a fresh message that follows a stale one", async () => {
      await svc.processInbound(svc.parseInbound(webhook([text("w1", CONTACT_A, 3 * 3600), text("w2", CONTACT_A, 10)])));
      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenNthCalledWith(1, CONTACT_A, STALE_MESSAGE_NOTICE);
      expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, "Here is some info.");
    });

    it("keeps separate cooldowns for the two notices", async () => {
      await svc.processInbound(
        svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type: "image" }, text("w2", CONTACT_A, 3 * 3600)])),
      );
      expect(sendText).toHaveBeenNthCalledWith(1, CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
      expect(sendText).toHaveBeenNthCalledWith(2, CONTACT_A, STALE_MESSAGE_NOTICE);
    });

    it("an old voice note gets the typed-messages notice", async () => {
      await svc.processInbound(
        svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type: "audio", timestamp: secondsAgo(5 * 3600) }])),
      );
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
    });

    it("honours WHATSAPP_STALE_MESSAGE_MINUTES", async () => {
      process.env.WHATSAPP_STALE_MESSAGE_MINUTES = "5";
      await svc.processInbound(svc.parseInbound(webhook([text("w1", CONTACT_A, 6 * 60)])));
      expect(chat.handle).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
    });

    it("0 switches the guard off", async () => {
      process.env.WHATSAPP_STALE_MESSAGE_MINUTES = "0";
      await svc.processInbound(svc.parseInbound(webhook([text("w1", CONTACT_A, 24 * 3600)])));
      expect(chat.handle).toHaveBeenCalledTimes(1);
    });

    it("falls back to 30 minutes on a missing, negative or non-numeric value", () => {
      expect(staleThresholdMs({})).toBe(30 * 60_000);
      expect(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "" })).toBe(30 * 60_000);
      expect(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "-5" })).toBe(30 * 60_000);
      expect(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "soon" })).toBe(30 * 60_000);
      expect(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "45" })).toBe(45 * 60_000);
    });

    it("treats a timestamp in the future as fresh", () => {
      const msg: InboundMessage = { wamid: "w1", from: CONTACT_A, text: "x", sentAt: NOW_MS / 1000 + 600 };
      expect(noticeKindFor(msg, NOW_MS, 30 * 60_000)).toBeNull();
    });
  });

  describe("NoticeLimiter", () => {
    it("allows one notice per contact and kind inside the window", () => {
      const limiter = new NoticeLimiter(1000);
      expect(limiter.tryAcquire(CONTACT_A, "stale", 0)).toBe(true);
      expect(limiter.tryAcquire(CONTACT_A, "stale", 999)).toBe(false);
      expect(limiter.tryAcquire(CONTACT_A, "unsupported_type", 999)).toBe(true);
      expect(limiter.tryAcquire(CONTACT_B, "stale", 999)).toBe(true);
      expect(limiter.tryAcquire(CONTACT_A, "stale", 1000)).toBe(true);
    });

    it("stays bounded when many contacts write in", () => {
      const limiter = new NoticeLimiter(1000, 3);
      for (let i = 0; i < 10; i++) expect(limiter.tryAcquire(`c${i}`, "stale", i)).toBe(true);
      expect((limiter as any).lastSent.size).toBeLessThanOrEqual(3);
    });
  });
});
