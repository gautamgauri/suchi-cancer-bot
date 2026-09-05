import { ForbiddenException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { inboundLedgerId, INBOUND_LEDGER_EVENT, WhatsAppService } from "./whatsapp.service";
import { MetaWebhookBody } from "./whatsapp.types";

/**
 * Stand-in for the `AnalyticsEvent` table backing the inbound ledger. The store
 * is keyed by primary key and `create` rejects with Prisma's P2002 on a repeat
 * insert — that is exactly the atomic uniqueness guarantee the cross-instance
 * de-dup relies on, so the mock has to model it rather than always succeed.
 */
function makeLedgerMock() {
  const rows = new Map<string, any>();
  return {
    rows,
    create: jest.fn(async ({ data }: any) => {
      if (rows.has(data.id)) {
        const err: any = new Error("Unique constraint failed on the fields: (`id`)");
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

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(Buffer.from(body)).digest("hex");
}

function textWebhook(wamid: string, from: string, body: string): MetaWebhookBody {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PNID" },
              contacts: [{ wa_id: from, profile: { name: "Asha" } }],
              messages: [{ id: wamid, from, type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

describe("WhatsAppService", () => {
  const APP_SECRET = "test-app-secret";
  let prisma: any;
  let chat: any;
  let sessions: any;
  let ledger: ReturnType<typeof makeLedgerMock>;
  let svc: WhatsAppService;

  beforeEach(() => {
    process.env.META_WABA_PHONE_NUMBER_ID = "PNID";
    process.env.META_WABA_TOKEN = "tok";
    process.env.META_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-123";
    process.env.WHATSAPP_SESSION_TTL_HOURS = "24";

    ledger = makeLedgerMock();
    prisma = {
      whatsAppContact: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
      analyticsEvent: ledger,
    };
    chat = { handle: jest.fn().mockResolvedValue({ responseText: "Here is some info." }) };
    sessions = { create: jest.fn().mockResolvedValue({ id: "sess-new", createdAt: new Date() }) };

    svc = new WhatsAppService(prisma, chat, sessions);
    // Avoid real network in sendText
    jest.spyOn(svc, "sendText").mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe("isConfigured", () => {
    it("is true when all creds present", () => {
      expect(svc.isConfigured()).toBe(true);
    });
    it("is false when a cred is missing", () => {
      delete process.env.META_APP_SECRET;
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("verifyHandshake", () => {
    it("echoes challenge on matching token", () => {
      expect(svc.verifyHandshake("subscribe", "verify-123", "CH")).toBe("CH");
    });
    it("rejects wrong token", () => {
      expect(() => svc.verifyHandshake("subscribe", "wrong", "CH")).toThrow(ForbiddenException);
    });
    it("rejects wrong mode", () => {
      expect(() => svc.verifyHandshake("unsubscribe", "verify-123", "CH")).toThrow(ForbiddenException);
    });
  });

  describe("verifySignature", () => {
    it("accepts a correct signature", () => {
      const raw = Buffer.from('{"a":1}');
      expect(svc.verifySignature(raw, sign('{"a":1}', APP_SECRET))).toBe(true);
    });
    it("rejects a tampered body", () => {
      expect(svc.verifySignature(Buffer.from('{"a":2}'), sign('{"a":1}', APP_SECRET))).toBe(false);
    });
    it("fails closed when header missing", () => {
      expect(svc.verifySignature(Buffer.from("x"), undefined)).toBe(false);
    });
    it("fails closed when secret missing", () => {
      delete process.env.META_APP_SECRET;
      expect(svc.verifySignature(Buffer.from("x"), sign("x", APP_SECRET))).toBe(false);
    });
  });

  describe("parseInbound", () => {
    it("extracts a text message with profile name", () => {
      const msgs = svc.parseInbound(textWebhook("wamid.1", "919876543210", "hello"));
      expect(msgs).toEqual([
        { wamid: "wamid.1", from: "919876543210", text: "hello", profileName: "Asha" },
      ]);
    });

    it("ignores statuses-only events", () => {
      const body: MetaWebhookBody = {
        entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "x" }] } }] }],
      };
      expect(svc.parseInbound(body)).toEqual([]);
    });

    it("extracts interactive button replies", () => {
      const body: MetaWebhookBody = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: "w2",
                      from: "91999",
                      type: "interactive",
                      interactive: { type: "button_reply", button_reply: { id: "b1", title: "Yes" } },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      expect(svc.parseInbound(body)).toEqual([{ wamid: "w2", from: "91999", text: "Yes", profileName: undefined }]);
    });

    it("skips unsupported message types (e.g. image)", () => {
      const body: MetaWebhookBody = {
        entry: [{ changes: [{ value: { messages: [{ id: "w3", from: "91", type: "image" }] } }] }],
      };
      expect(svc.parseInbound(body)).toEqual([]);
    });
  });

  describe("processInbound", () => {
    it("routes through ChatService and replies", async () => {
      await svc.processInbound([{ wamid: "w1", from: "9199", text: "what is chemo?" }]);
      expect(chat.handle).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "sess-new", channel: "whatsapp", userText: "what is chemo?" }),
      );
      expect(svc.sendText).toHaveBeenCalledWith("9199", "Here is some info.");
    });

    it("de-duplicates repeated wamids (webhook retries)", async () => {
      const m = { wamid: "dup", from: "9199", text: "hi" };
      await svc.processInbound([m]);
      await svc.processInbound([m]);
      expect(chat.handle).toHaveBeenCalledTimes(1);
    });

    it("de-duplicates a retry that lands on a different instance (FR-WA-007)", async () => {
      // Two service instances sharing one database, as on Cloud Run.
      const other = new WhatsAppService(prisma, chat, sessions);
      jest.spyOn(other, "sendText").mockResolvedValue(undefined);
      const m = { wamid: "cross-instance", from: "9199", text: "hi" };

      await svc.processInbound([m]);
      await other.processInbound([m]);

      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(svc.sendText).toHaveBeenCalledTimes(1);
      expect(other.sendText).not.toHaveBeenCalled();
    });

    it("sends a fallback reply when the pipeline throws", async () => {
      chat.handle.mockRejectedValueOnce(new Error("boom"));
      await svc.processInbound([{ wamid: "w9", from: "9199", text: "hi" }]);
      expect(svc.sendText).toHaveBeenCalledWith("9199", expect.stringContaining("something went wrong"));
    });

    it("self-heals a deleted session: re-mints and retries once", async () => {
      // Active contact pointing at a session row that no longer exists.
      prisma.whatsAppContact.findUnique.mockResolvedValueOnce({
        waId: "9199",
        sessionId: "sess-gone",
        lastActiveAt: new Date(),
      });
      chat.handle
        .mockRejectedValueOnce(new Error("Invalid sessionId"))
        .mockResolvedValueOnce({ responseText: "Recovered." });

      await svc.processInbound([{ wamid: "heal1", from: "9199", text: "hi" }]);

      expect(chat.handle).toHaveBeenCalledTimes(2);
      expect(chat.handle).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "sess-new" }));
      expect(sessions.create).toHaveBeenCalled();
      expect(svc.sendText).toHaveBeenCalledWith("9199", "Recovered.");
    });

    it("does not retry on a non-session error (single fallback)", async () => {
      chat.handle.mockRejectedValue(new Error("boom"));
      await svc.processInbound([{ wamid: "noretry", from: "9199", text: "hi" }]);
      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(svc.sendText).toHaveBeenCalledWith("9199", expect.stringContaining("something went wrong"));
    });
  });

  describe("claimInbound", () => {
    it("records the message durably before any pipeline work happens", async () => {
      const claimedNow = await svc.claimInbound([{ wamid: "w1", from: "9199", text: "hello" }]);

      expect(claimedNow.failure).toBeUndefined();
      expect(claimedNow.claimed).toHaveLength(1);
      expect(chat.handle).not.toHaveBeenCalled(); // claim is independent of processing
      expect(ledger.rows.get(inboundLedgerId("w1"))).toEqual(
        expect.objectContaining({
          eventName: INBOUND_LEDGER_EVENT,
          payload: expect.objectContaining({ wamid: "w1", status: "received" }),
        }),
      );
    });

    it("stores no message text or phone number in the ledger row", async () => {
      await svc.claimInbound([{ wamid: "w1", from: "919876543210", text: "secret question" }]);
      const serialised = JSON.stringify(ledger.rows.get(inboundLedgerId("w1")));
      expect(serialised).not.toContain("secret question");
      expect(serialised).not.toContain("919876543210");
    });

    it("skips a wamid another instance already claimed", async () => {
      const m = { wamid: "dup", from: "9199", text: "hi" };
      await svc.claimInbound([m]);
      const second = await svc.claimInbound([m]);
      expect(second.claimed).toEqual([]);
      expect(second.failure).toBeUndefined();
    });

    it("reports a ledger write failure so the webhook can refuse to ack", async () => {
      ledger.create.mockRejectedValueOnce(new Error("connection terminated"));
      const res = await svc.claimInbound([{ wamid: "w-fail", from: "9199", text: "hi" }]);
      expect(res.claimed).toEqual([]);
      expect(res.failure?.message).toContain("connection terminated");
    });

    it("keeps earlier claims when a later message in the batch fails to record", async () => {
      ledger.create.mockImplementationOnce(async ({ data }: any) => {
        ledger.rows.set(data.id, { ...data });
        return data;
      });
      ledger.create.mockRejectedValueOnce(new Error("db down"));

      const res = await svc.claimInbound([
        { wamid: "ok", from: "9199", text: "a" },
        { wamid: "bad", from: "9199", text: "b" },
      ]);

      expect(res.claimed.map(m => m.wamid)).toEqual(["ok"]);
      expect(res.failure).toBeDefined();
    });

    it("marks the ledger row processed once the reply is sent", async () => {
      await svc.processInbound([{ wamid: "done", from: "9199", text: "hi" }]);
      expect(ledger.rows.get(inboundLedgerId("done")).payload).toEqual(
        expect.objectContaining({ status: "processed" }),
      );
    });

    it("marks the ledger row failed when the pipeline throws", async () => {
      chat.handle.mockRejectedValue(new Error("boom"));
      await svc.processInbound([{ wamid: "bust", from: "9199", text: "hi" }]);
      expect(ledger.rows.get(inboundLedgerId("bust")).payload).toEqual(
        expect.objectContaining({ status: "failed", error: "boom" }),
      );
    });

    it("still replies when the ledger bookkeeping update fails", async () => {
      ledger.update.mockRejectedValue(new Error("update failed"));
      await svc.processInbound([{ wamid: "w1", from: "9199", text: "hi" }]);
      expect(svc.sendText).toHaveBeenCalledWith("9199", "Here is some info.");
    });
  });

  describe("resolveSession", () => {
    it("reuses an active session within the TTL window", async () => {
      prisma.whatsAppContact.findUnique.mockResolvedValueOnce({
        waId: "9199",
        sessionId: "sess-existing",
        lastActiveAt: new Date(),
      });
      const id = await svc.resolveSession("9199", "en");
      expect(id).toBe("sess-existing");
      expect(sessions.create).not.toHaveBeenCalled();
      expect(prisma.whatsAppContact.update).toHaveBeenCalled();
    });

    it("mints a fresh session past the TTL window", async () => {
      const stale = new Date(Date.now() - 25 * 3_600_000);
      prisma.whatsAppContact.findUnique.mockResolvedValueOnce({
        waId: "9199",
        sessionId: "sess-old",
        lastActiveAt: stale,
      });
      const id = await svc.resolveSession("9199", "hi");
      expect(id).toBe("sess-new");
      expect(sessions.create).toHaveBeenCalledWith({ channel: "whatsapp", locale: "hi" });
      expect(prisma.whatsAppContact.upsert).toHaveBeenCalled();
    });

    it("creates a session for a brand-new contact", async () => {
      const id = await svc.resolveSession("new-person", "en");
      expect(id).toBe("sess-new");
      expect(sessions.create).toHaveBeenCalled();
    });
  });
});
