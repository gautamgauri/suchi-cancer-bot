import { EmpathyDetector } from "../chat/empathy-detector";
import { AbstentionService } from "../abstention/abstention.service";
import { SafetyService } from "../safety/safety.service";
import { ForbiddenException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { inboundLedgerId, INBOUND_LEDGER_EVENT, WhatsAppDeliveryError, WhatsAppService } from "./whatsapp.service";
import { MetaWebhookBody } from "./whatsapp.types";
import { MAX_USER_TEXT_HARD_LIMIT, MAX_USER_TEXT_LENGTH } from "../chat/dto";
import { cleanResponseForDisplay } from "../chat/display-text-cleaner";
import { appendDisclaimer } from "../safety/disclaimer-engine";
import { evaluateEmergencyFastPath } from "../safety/emergency-fast-path";
import { detectLocale } from "./whatsapp-format";

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
    chat = {
      handle: jest.fn().mockResolvedValue({ responseText: "Here is some info." }),
      recordSessionFreeSafetyTurn: jest.fn(),
    };
    sessions = { create: jest.fn().mockResolvedValue({ id: "sess-new", createdAt: new Date() }) };

    svc = new WhatsAppService(prisma, chat, sessions, new SafetyService(), new AbstentionService(), new EmpathyDetector());
    // Avoid real network in sendText
    jest.spyOn(svc, "sendText").mockResolvedValue(1);
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

    // Issue #231: with no global exception filter, a rejection here 403s the
    // batch with nothing in the logs naming the WhatsApp webhook — a rotated
    // app secret looks identical to a channel that just went quiet.
    it("logs why a rejection happened at warn, without leaking the secret or the body", () => {
      // A bad signature on a public endpoint can come from anyone, so it is a
      // warning. Only a missing secret (our own fault) is logged at error.
      const warnLog = jest.spyOn(svc["logger"], "warn").mockImplementation(() => undefined);
      const errorLog = jest.spyOn(svc["logger"], "error").mockImplementation(() => undefined);

      expect(svc.verifySignature(Buffer.from('{"a":2}'), sign('{"a":1}', APP_SECRET))).toBe(false);

      expect(errorLog).not.toHaveBeenCalled();
      expect(warnLog).toHaveBeenCalledTimes(1);
      const logged = String(warnLog.mock.calls[0][0]);
      expect(logged).toMatch(/does not match META_APP_SECRET/);
      expect(logged).not.toContain(APP_SECRET);
      expect(logged).not.toContain('{"a":2}');
    });

    it("names a missing app secret as the reason", () => {
      const errorLog = jest.spyOn(svc["logger"], "error").mockImplementation(() => undefined);
      delete process.env.META_APP_SECRET;

      expect(svc.verifySignature(Buffer.from("x"), "sha256=whatever")).toBe(false);

      expect(String(errorLog.mock.calls[0][0])).toMatch(/META_APP_SECRET not configured/);
    });
  });

  describe("parseInbound", () => {
    it("extracts a text message with profile name", () => {
      const msgs = svc.parseInbound(textWebhook("wamid.1", "919876543210", "hello"));
      expect(msgs).toEqual([
        { wamid: "wamid.1", from: "919876543210", text: "hello", profileName: "Asha" },
      ]);
    });

    // PR #202: the whole message reaches the safety screen. ChatService cuts it
    // to MAX_USER_TEXT_LENGTH only after screening. Only the abuse ceiling applies here.
    it("keeps inbound text above MAX_USER_TEXT_LENGTH, so the safety screen sees all of it", () => {
      const msgs = svc.parseInbound(textWebhook("wamid.long", "919876543210", "x".repeat(MAX_USER_TEXT_LENGTH + 500)));
      expect(msgs[0].text).toHaveLength(MAX_USER_TEXT_LENGTH + 500);
    });

    it("cuts inbound text at the abuse ceiling (this path skips ChatDto)", () => {
      const msgs = svc.parseInbound(textWebhook("wamid.huge", "919876543210", "x".repeat(MAX_USER_TEXT_HARD_LIMIT + 500)));
      expect(msgs[0].text).toHaveLength(MAX_USER_TEXT_HARD_LIMIT);
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

    it("keeps a message with no readable text (e.g. image) so it can get the fixed notice", () => {
      const body: MetaWebhookBody = {
        entry: [{ changes: [{ value: { messages: [{ id: "w3", from: "91", type: "image" }] } }] }],
      };
      expect(svc.parseInbound(body)).toEqual([{ wamid: "w3", from: "91", text: "", unsupportedType: "image" }]);
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
      const other = new WhatsAppService(prisma, chat, sessions, new SafetyService(), new AbstentionService(), new EmpathyDetector());
      jest.spyOn(other, "sendText").mockResolvedValue(1);
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

    // Issue #116: raw `[citation:docId:chunkId]` markers and the "**Sources:**"
    // section reached a patient. The HTTP controller strips them; this channel
    // bypasses the controller and must strip them itself.
    it("strips citation markers and the raw Sources section before replying", async () => {
      chat.handle.mockResolvedValueOnce({
        responseText:
          "Chemo can cause fatigue [citation:kb_en_a_v1:kb_en_a_v1::chunk::0].\n\n" +
          "**Sources:** [citation:kb_en_a_v1:kb_en_a_v1::chunk::0] [citation:kb_en_b_v1:kb_en_b_v1::chunk::2]",
      });
      await svc.processInbound([{ wamid: "w-cite", from: "9199", text: "chemo side effects?" }]);
      const sent = (svc.sendText as jest.Mock).mock.calls[0][1] as string;
      expect(sent).not.toContain("[citation:");
      expect(sent).not.toContain("Sources:");
      expect(sent).toBe("Chemo can cause fatigue.");
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

  // PR #202: resolveSession reads and writes WhatsAppContact before the chat
  // pipeline runs. With the database down it threw first, and an emergency
  // message got the generic "something went wrong" reply. Synthetic text only.
  describe("session cannot be resolved", () => {
    const EMERGENCY = "I am coughing up blood right now";
    const SELF_HARM = "I want to kill myself";
    const dbDown = () => Promise.reject(Object.assign(new Error("Can't reach database server"), { code: "P1001" }));

    const expectedEmergency = () =>
      cleanResponseForDisplay(
        appendDisclaimer(evaluateEmergencyFastPath(EMERGENCY).responseText!, detectLocale(EMERGENCY), true, EMERGENCY),
      );
    const expectedSelfHarm = () => {
      const r = new SafetyService().evaluate(SELF_HARM);
      expect(r.classification).toBe("self_harm");
      return cleanResponseForDisplay(appendDisclaimer(r.responseText!, detectLocale(SELF_HARM), false, SELF_HARM));
    };

    beforeEach(() => {
      jest.spyOn((svc as any).logger, "error").mockImplementation(() => undefined);
    });

    it("sends the emergency template when the contact lookup rejects", async () => {
      prisma.whatsAppContact.findUnique.mockImplementation(dbDown);
      await svc.processClaimed([{ wamid: "sf1", from: "9199", text: EMERGENCY }]);
      expect(chat.handle).not.toHaveBeenCalled();
      expect(svc.sendText).toHaveBeenCalledTimes(1);
      expect(svc.sendText).toHaveBeenCalledWith("9199", expectedEmergency());
      // The failure log carries the wamid and error code, never the text.
      const logged = ((svc as any).logger.error as jest.Mock).mock.calls.flat().join(" ");
      expect(logged).toContain("[safety-fallback]");
      expect(logged).not.toContain(EMERGENCY);
    });

    it("sends the self-harm template when a new session cannot be minted", async () => {
      sessions.create.mockImplementation(dbDown);
      await svc.processClaimed([{ wamid: "sf2", from: "9199", text: SELF_HARM }]);
      expect(chat.handle).not.toHaveBeenCalled();
      expect(svc.sendText).toHaveBeenCalledWith("9199", expectedSelfHarm());
    });

    it("sends the emergency template when the contact lookup hangs past the bound", async () => {
      prisma.whatsAppContact.findUnique.mockImplementation(() => new Promise(() => undefined));
      const started = Date.now();
      await svc.processClaimed([{ wamid: "sf3", from: "9199", text: EMERGENCY }]);
      expect(Date.now() - started).toBeLessThan(4_500);
      expect(svc.sendText).toHaveBeenCalledWith("9199", expectedEmergency());
    }, 10_000);

    it("an ordinary message still gets the generic failure reply (unchanged)", async () => {
      prisma.whatsAppContact.findUnique.mockImplementation(dbDown);
      await svc.processClaimed([{ wamid: "sf4", from: "9199", text: "what is chemotherapy?" }]);
      expect(chat.handle).not.toHaveBeenCalled();
      expect(svc.sendText).toHaveBeenCalledWith("9199", expect.stringContaining("something went wrong"));
    });

    it("records a truthful ledger row for the session-free template", async () => {
      prisma.whatsAppContact.findUnique.mockImplementation(dbDown);
      await svc.processClaimed([{ wamid: "sf6", from: "9199", text: EMERGENCY }]);
      expect(ledger.rows.get(inboundLedgerId("sf6")).payload).toMatchObject({
        status: "processed",
        partsSent: 1,
        notice: "safety_fallback",
        noticeSent: true,
      });
    });

    it("never follows a failed safety template with the generic failure reply", async () => {
      prisma.whatsAppContact.findUnique.mockImplementation(dbDown);
      (svc.sendText as jest.Mock).mockRejectedValue(
        new WhatsAppDeliveryError("Graph API 500", 0, "http", 500),
      );
      await svc.processClaimed([{ wamid: "sf7", from: "9199", text: EMERGENCY }]);
      expect(svc.sendText).toHaveBeenCalledTimes(1);
      expect(svc.sendText).not.toHaveBeenCalledWith("9199", expect.stringContaining("something went wrong"));
      expect(ledger.rows.get(inboundLedgerId("sf7")).payload).toMatchObject({
        status: "failed",
        failedStage: "delivery",
        notice: "safety_fallback",
        noticeSent: false,
      });
    });

    it("sends the template when the stored session is gone and a new one cannot be minted", async () => {
      prisma.whatsAppContact.findUnique.mockResolvedValue({ waId: "9199", sessionId: "sess-gone", lastActiveAt: new Date() });
      chat.handle.mockRejectedValue(new Error("Invalid sessionId"));
      sessions.create.mockImplementation(dbDown);
      await svc.processClaimed([{ wamid: "sf8", from: "9199", text: EMERGENCY }]);
      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(svc.sendText).toHaveBeenCalledTimes(1);
      expect(svc.sendText).toHaveBeenCalledWith("9199", expectedEmergency());
    });

    it("records the gate and classification in the ledger row, never the text", async () => {
      prisma.whatsAppContact.findUnique.mockImplementation(dbDown);
      await svc.processClaimed([{ wamid: "sf9", from: "9199", text: SELF_HARM }]);
      const payload = ledger.rows.get(inboundLedgerId("sf9")).payload;
      expect(payload).toMatchObject({
        status: "processed",
        notice: "safety_fallback",
        noticeSent: true,
        safetyGate: "safetyTemplate",
        safetyClassification: "self_harm",
      });
      expect(JSON.stringify(payload)).not.toContain(SELF_HARM);
    });

    it("stores the turn once a slow session lookup does resolve", async () => {
      let finish!: (v: any) => void;
      prisma.whatsAppContact.findUnique.mockImplementation(
        () => new Promise((r) => (finish = r)),
      );
      await svc.processClaimed([{ wamid: "sf10", from: "9199", text: SELF_HARM }]);
      // The template went out without a session.
      expect(svc.sendText).toHaveBeenCalledWith("9199", expectedSelfHarm());
      expect(chat.recordSessionFreeSafetyTurn).not.toHaveBeenCalled();
      // The lookup finishes late with a live contact.
      const finishedAt = Date.now();
      finish({ waId: "9199", sessionId: "sess-late", lastActiveAt: new Date() });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(chat.recordSessionFreeSafetyTurn).toHaveBeenCalledTimes(1);
      const [sessionId, input, reply, times] = chat.recordSessionFreeSafetyTurn.mock.calls[0];
      expect(sessionId).toBe("sess-late");
      expect(input).toEqual({ userText: SELF_HARM, channel: "whatsapp" });
      expect(reply.safety.classification).toBe("self_harm");
      // The rows carry the receive and reply times, taken before the late
      // session arrived, so the transcript order holds (review N4).
      expect(times.receivedAt).toBeInstanceOf(Date);
      expect(times.repliedAt.getTime()).toBeGreaterThanOrEqual(times.receivedAt.getTime());
      expect(times.repliedAt.getTime()).toBeLessThanOrEqual(finishedAt);
    }, 10_000);

    it("logs, without the text, when the session never arrives", async () => {
      prisma.whatsAppContact.findUnique.mockImplementation(dbDown);
      await svc.processClaimed([{ wamid: "sf11", from: "9199", text: SELF_HARM }]);
      await new Promise((r) => setImmediate(r));
      expect(chat.recordSessionFreeSafetyTurn).not.toHaveBeenCalled();
      const logged = ((svc as any).logger.error as jest.Mock).mock.calls.flat().join(" ");
      expect(logged).toContain("sf11 has no stored record");
      expect(logged).not.toContain(SELF_HARM);
    });

    // Review B1: a safety phrase beyond 4096 characters reaches the fallback.
    it("screens the whole of a long message for the no-session template", async () => {
      prisma.whatsAppContact.findUnique.mockImplementation(dbDown);
      const long = "I have some questions about my treatment plan. ".repeat(200) + " " + SELF_HARM;
      expect(long.length).toBeGreaterThan(MAX_USER_TEXT_LENGTH);
      const [parsed] = svc.parseInbound(textWebhook("sf12", "9199", long));
      await svc.processClaimed([parsed]);
      const r = new SafetyService().evaluate(long);
      expect(r.classification).toBe("self_harm");
      expect(svc.sendText).toHaveBeenCalledWith(
        "9199",
        cleanResponseForDisplay(appendDisclaimer(r.responseText!, detectLocale(long), false, long)),
      );
    });

    // #254 with PR #202: a caption note must never follow a no-session safety reply.
    it("captioned media with an emergency caption and no session: one send, the template, no caption note", async () => {
      prisma.whatsAppContact.findUnique.mockImplementation(dbDown);
      await svc.processClaimed([{ wamid: "sf13", from: "9199", text: EMERGENCY, captionMediaType: "image" } as any]);
      expect(svc.sendText).toHaveBeenCalledTimes(1);
      expect(svc.sendText).toHaveBeenCalledWith("9199", expectedEmergency());
      const payload = ledger.rows.get(inboundLedgerId("sf13")).payload;
      expect(payload).toMatchObject({ status: "processed", notice: "safety_fallback" });
      for (const field of ["captionNote", "captionNoteSent", "captionNoteSkipped", "captionNoteFailed"]) {
        expect(payload).not.toHaveProperty(field);
      }
    });

    it("a healthy session lookup goes through the full pipeline as before", async () => {
      await svc.processClaimed([{ wamid: "sf5", from: "9199", text: EMERGENCY }]);
      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(svc.sendText).toHaveBeenCalledWith("9199", "Here is some info.");
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

  /**
   * Issue #231: the 27 Oct QA run got zero pipeline replies on the live number
   * for four messages plus a burst, and nothing in the ledger said so — a turn
   * whose reply never left the box was recorded exactly like a delivered one,
   * because `sendText` logged and returned instead of throwing. These tests
   * pin the outbound failure down as an observable, non-silent event.
   */
  describe("outbound delivery failures", () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
      // The suite-wide stub makes sendText a no-op; these tests need the real one.
      (svc.sendText as jest.Mock).mockRestore();
      fetchMock = jest.fn();
      jest.spyOn(global, "fetch").mockImplementation(fetchMock as any);
      svc.retryDelayMs = 0;
    });

    const okResponse = () => ({ ok: true, status: 200, text: async () => "{}" });
    const rejectedResponse = () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid OAuth access token"}}',
    });

    it("throws instead of reporting success when outbound credentials are missing", async () => {
      delete process.env.META_WABA_TOKEN;
      // Asserted by name rather than by class so this fails on the old
      // log-and-return behaviour instead of failing to compile.
      await expect(svc.sendText("9199", "hello")).rejects.toThrow(/not configured/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws when the Graph API rejects the send", async () => {
      fetchMock.mockResolvedValue(rejectedResponse());
      await expect(svc.sendText("9199", "hello")).rejects.toThrow(/WhatsApp send failed \(401\)/);
    });

    it("reports how many parts were delivered before a mid-reply failure", async () => {
      // Long enough that formatForWhatsApp splits it across two messages.
      const long = "A sentence about chemotherapy side effects.\n".repeat(120);
      fetchMock.mockResolvedValueOnce(okResponse()).mockResolvedValueOnce(rejectedResponse());

      const err = await svc.sendText("9199", long).catch((e) => e);

      expect(err?.name).toBe("WhatsAppDeliveryError");
      expect(err.partsSent).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("marks the ledger failed at the delivery stage when the reply never left the box", async () => {
      fetchMock.mockResolvedValue(rejectedResponse());

      await svc.processInbound([{ wamid: "wa-231", from: "9199", text: "hi" }]);

      expect(chat.handle).toHaveBeenCalledTimes(1); // the pipeline itself ran fine
      expect(ledger.rows.get(inboundLedgerId("wa-231")).payload).toEqual(
        expect.objectContaining({ status: "failed", failedStage: "delivery" }),
      );
    });

    it("does not push the fallback reply down an outbound channel that just failed", async () => {
      fetchMock.mockResolvedValue(rejectedResponse());

      await svc.processInbound([{ wamid: "wa-231-fb", from: "9199", text: "hi" }]);

      // One attempt for the real reply; no second attempt for FALLBACK_REPLY.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("classifies a transport failure (fetch rejects) as a delivery failure", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      const err = await svc.sendText("9199", "hello").catch((e) => e);

      expect(err?.name).toBe("WhatsAppDeliveryError");
      expect(err.partsSent).toBe(0);
      expect(err.message).toMatch(/WhatsApp send failed \(network\): fetch failed/);
      expect(fetchMock).toHaveBeenCalledTimes(2); // the first attempt and one retry
    });

    it("keeps the count of delivered parts when the transport fails mid-reply", async () => {
      const long = "A sentence about chemotherapy side effects.\n".repeat(120);
      fetchMock.mockResolvedValueOnce(okResponse()).mockRejectedValueOnce(new TypeError("fetch failed"));

      const err = await svc.sendText("9199", long).catch((e) => e);

      expect(err?.name).toBe("WhatsAppDeliveryError");
      expect(err.partsSent).toBe(1);
    });

    it("records a transport failure at the delivery stage and sends no fallback", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      await svc.processInbound([{ wamid: "wa-231-net", from: "9199", text: "hi" }]);

      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(ledger.rows.get(inboundLedgerId("wa-231-net")).payload).toEqual(
        expect.objectContaining({ status: "failed", failedStage: "delivery" }),
      );
      // The real reply plus its one retry. No attempt for the fallback.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Review of #232: one transient failure used to leave the patient with
    // silence, emergency turns included. The first part gets one retry.
    const statusResponse = (status: number, body = "{}") => ({ ok: false, status, text: async () => body });

    it.each([429, 500, 503])("retries the first part once after HTTP %i and delivers the reply", async (status) => {
      fetchMock.mockResolvedValueOnce(statusResponse(status)).mockResolvedValueOnce(okResponse());

      await svc.processInbound([{ wamid: `wa-retry-${status}`, from: "9199", text: "hi" }]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(ledger.rows.get(inboundLedgerId(`wa-retry-${status}`)).payload).toEqual(
        expect.objectContaining({ status: "processed", partsSent: 1 }),
      );
    });

    it("retries the first part once after a network error and delivers the reply", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(okResponse());

      await svc.processInbound([{ wamid: "wa-retry-net", from: "9199", text: "hi" }]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(ledger.rows.get(inboundLedgerId("wa-retry-net")).payload).toEqual(
        expect.objectContaining({ status: "processed", partsSent: 1 }),
      );
    });

    it("retries at most once, then records the failure with no fallback", async () => {
      fetchMock.mockResolvedValue(statusResponse(503));

      await svc.processInbound([{ wamid: "wa-retry-twice", from: "9199", text: "hi" }]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(ledger.rows.get(inboundLedgerId("wa-retry-twice")).payload).toEqual(
        expect.objectContaining({ status: "failed", failedStage: "delivery", partsSent: 0, httpStatus: 503 }),
      );
    });

    it.each([401, 403, 400])("does not retry HTTP %i", async (status) => {
      fetchMock.mockResolvedValue(statusResponse(status));

      const err = await svc.sendText("9199", "hello").catch((e) => e);

      expect(err?.name).toBe("WhatsAppDeliveryError");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry a later part, so no accepted part is sent twice", async () => {
      const long = "A sentence about chemotherapy side effects.\n".repeat(120);
      fetchMock.mockResolvedValueOnce(okResponse()).mockResolvedValue(statusResponse(503));

      const err = await svc.sendText("9199", long).catch((e) => e);

      expect(err.partsSent).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2); // part 1 once, part 2 once
      const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).text.body);
      expect(bodies[0]).not.toEqual(bodies[1]);
    });

    it("returns the number of parts Meta accepted", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const long = "A sentence about chemotherapy side effects.\n".repeat(120);

      const sent = await svc.sendText("9199", long);

      expect(sent).toBeGreaterThan(1);
      expect(sent).toBe(fetchMock.mock.calls.length);
    });

    it("stores the HTTP status and Meta's numeric code in the ledger, never Meta's body text", async () => {
      jest.spyOn(svc["logger"], "warn").mockImplementation(() => undefined);
      jest.spyOn(svc["logger"], "error").mockImplementation(() => undefined);
      fetchMock.mockResolvedValue(
        statusResponse(400, '{"error":{"message":"BODY-TEXT-MARKER","type":"OAuthException","code":131030}}'),
      );

      await svc.processInbound([{ wamid: "wa-body", from: "9199", text: "hi" }]);

      const payload = ledger.rows.get(inboundLedgerId("wa-body")).payload;
      expect(payload).toEqual(
        expect.objectContaining({ status: "failed", httpStatus: 400, metaErrorCode: 131030, partsSent: 0 }),
      );
      expect(JSON.stringify(payload)).not.toContain("BODY-TEXT-MARKER");
      expect(JSON.stringify(payload)).not.toContain("OAuthException");
    });

    it("still marks the ledger processed when delivery succeeds", async () => {
      fetchMock.mockResolvedValue(okResponse());

      await svc.processInbound([{ wamid: "wa-231-ok", from: "9199", text: "hi" }]);

      expect(ledger.rows.get(inboundLedgerId("wa-231-ok")).payload).toEqual(
        expect.objectContaining({ status: "processed" }),
      );
      expect(ledger.rows.get(inboundLedgerId("wa-231-ok")).payload).not.toHaveProperty("failedStage");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("a pipeline failure is still attributed to the pipeline, not to delivery", async () => {
      chat.handle.mockRejectedValue(new Error("boom"));
      fetchMock.mockResolvedValue(okResponse());

      await svc.processInbound([{ wamid: "wa-231-pipe", from: "9199", text: "hi" }]);

      expect(ledger.rows.get(inboundLedgerId("wa-231-pipe")).payload).toEqual(
        expect.objectContaining({ status: "failed", failedStage: "pipeline" }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1); // the fallback still goes out
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
