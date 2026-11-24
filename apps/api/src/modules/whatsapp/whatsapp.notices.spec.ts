import { EmpathyDetector } from "../chat/empathy-detector";
import { AbstentionService } from "../abstention/abstention.service";
import { evaluateEmergencyFastPath } from "../safety/emergency-fast-path";
import { envSchema } from "../../config/env.validation";
import { SafetyService } from "../safety/safety.service";
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
    svc = new WhatsAppService(prisma, chat, sessions, new SafetyService(), new AbstentionService(), new EmpathyDetector());
    sendText = jest.spyOn(svc, "sendText").mockResolvedValue(1);
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

    it("matches the typed-messages wording the owner approved on 21 November 2026", () => {
      expect(UNSUPPORTED_TYPE_NOTICE).toBe(
        "फ़िलहाल सुचि पर केवल टाइप किए हुए संदेश पढ़े जा सकते हैं। कृपया अपना सवाल लिखकर भेजें।\n\n" +
          "Suchi can only read typed messages for now. Please type your question and send it.",
      );
    });

    it("spells the bot's name सुचि wherever it appears in Devanagari", () => {
      for (const text of [UNSUPPORTED_TYPE_NOTICE, STALE_MESSAGE_NOTICE]) {
        expect(text).not.toMatch(/सुची|सूचि|सूची/);
      }
      expect(UNSUPPORTED_TYPE_NOTICE).toContain("सुचि");
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

    it.each(["image", "video", "document"] as const)("reads a %s caption as the message text", (type) => {
      const out = svc.parseInbound(
        webhook([{ id: "w1", from: CONTACT_A, type, [type]: { caption: "  synthetic caption  " } } as MetaMessage]),
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ text: "synthetic caption" });
      expect(out[0].unsupportedType).toBeUndefined();
    });

    it("treats a blank caption as no caption: the typed-messages notice", async () => {
      await svc.processInbound(
        svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type: "image", image: { caption: "   " } }])),
      );
      expect(chat.handle).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledWith(CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
    });

    it("runs a captioned image carrying an emergency phrase through the pipeline", async () => {
      // Probe from emergency-fast-path.spec.ts.
      const caption = "I can't breathe properly";
      await svc.processInbound(
        svc.parseInbound(webhook([{ id: "w1", from: CONTACT_A, type: "image", image: { caption }, timestamp: secondsAgo(5) }])),
      );
      expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: caption }));
      expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
    });

    it("runs a stale captioned emergency image through the pipeline when the guard is on", async () => {
      process.env.WHATSAPP_STALE_MESSAGE_MINUTES = "30";
      const caption = "I can't breathe properly";
      await svc.processInbound(
        svc.parseInbound(
          webhook([{ id: "w1", from: CONTACT_A, type: "image", image: { caption }, timestamp: secondsAgo(7 * 3600) }]),
        ),
      );
      expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: caption }));
      expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
      expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, UNSUPPORTED_TYPE_NOTICE);
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
      // No fallback reply after a failed notice.
      expect(sendText).toHaveBeenCalledTimes(1);

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

  describe("stale guard default", () => {
    it("is off when WHATSAPP_STALE_MESSAGE_MINUTES is unset: a day-old message runs the pipeline", async () => {
      await svc.processInbound(
        svc.parseInbound(
          webhook([{ id: "w1", from: CONTACT_A, type: "text", text: { body: "synthetic question" }, timestamp: secondsAgo(24 * 3600) }]),
        ),
      );
      expect(chat.handle).toHaveBeenCalledTimes(1);
      expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
    });

    it("zod and the runtime agree on the default, including an empty string", () => {
      const field = envSchema.innerType().shape.WHATSAPP_STALE_MESSAGE_MINUTES;
      expect(field.parse(undefined)).toBe(0);
      expect(field.parse("")).toBe(0);
      expect(staleThresholdMs({})).toBe(0);
      expect(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "" })).toBe(0);
      expect(field.parse("45") * 60_000).toBe(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "45" }));
    });
  });

  describe("stale messages", () => {
    // The guard ships disabled. These tests switch it on explicitly.
    beforeEach(() => {
      process.env.WHATSAPP_STALE_MESSAGE_MINUTES = "30";
    });

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

    // Review of #248 (AGENTS.md, section 1, rule 1): the stale notice must never stand in
    // front of the safety path. The texts below are the synthetic probes the
    // safety specs already use.
    describe("a stale message the safety checks flag runs the pipeline", () => {
      const staleText = (id: string, body: string, ageSeconds = 7 * 3600): MetaMessage => ({
        id,
        from: CONTACT_A,
        type: "text",
        text: { body },
        timestamp: secondsAgo(ageSeconds),
      });
      const EMERGENCY = "I can't breathe properly";
      const SELF_HARM = "I want to kill myself";

      it("emergency (fast path): ChatService runs and no stale notice is sent", async () => {
        expect(evaluateEmergencyFastPath(EMERGENCY).isEmergency).toBe(true);

        await svc.processInbound(svc.parseInbound(webhook([staleText("w1", EMERGENCY)])));

        expect(chat.handle).toHaveBeenCalledTimes(1);
        expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: EMERGENCY }));
        expect(sendText).toHaveBeenCalledTimes(1);
        expect(sendText).toHaveBeenCalledWith(CONTACT_A, "Here is some info.");
        expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
        expect(ledger.rows.get(inboundLedgerId("w1")).payload).not.toHaveProperty("notice");
      });

      it("self-harm (safety rules): ChatService runs and no stale notice is sent", async () => {
        expect(new SafetyService().evaluate(SELF_HARM).classification).toBe("self_harm");

        await svc.processInbound(svc.parseInbound(webhook([staleText("w1", SELF_HARM)])));

        expect(chat.handle).toHaveBeenCalledTimes(1);
        expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: SELF_HARM }));
        expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
      });

      // PR #202 (review B1): the guard screens the tail of an over-ceiling
      // message, and the pipeline gets the message whole, as on main.
      it.each([20_500, 60_000])("a stale %i character message ending in self-harm runs the pipeline", async (n) => {
        const filler = "I have some questions about my treatment plan. ".repeat(Math.ceil(n / 47));
        const long = filler.slice(0, n - SELF_HARM.length - 1) + " " + SELF_HARM;
        await svc.processInbound(svc.parseInbound(webhook([staleText("w1", long)])));
        expect(chat.handle).toHaveBeenCalledTimes(1);
        expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: long }));
        expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
      });

      it("a flagged message is never swallowed by the notice cooldown", async () => {
        // An ordinary stale message takes the notice slot first. The flagged
        // one after it must still run the pipeline.
        await svc.processInbound(
          svc.parseInbound(
            webhook([
              staleText("w1", "synthetic question"),
              staleText("w2", SELF_HARM),
              staleText("w3", EMERGENCY),
              staleText("w4", "another synthetic question"),
            ]),
          ),
        );

        expect(chat.handle).toHaveBeenCalledTimes(2);
        expect(chat.handle).toHaveBeenNthCalledWith(1, expect.objectContaining({ userText: SELF_HARM }));
        expect(chat.handle).toHaveBeenNthCalledWith(2, expect.objectContaining({ userText: EMERGENCY }));
        expect(sendText.mock.calls.filter((c) => c[1] === STALE_MESSAGE_NOTICE)).toHaveLength(1);
      });

      // Probes taken from abstention.service.spec.ts and empathy-detector.spec.ts.
      // Each must trip ONLY its own check, so the test proves that check alone.
      const URGENT_ONLY = "this is an emergency";
      const MH_SUPPORT_ONLY = "I feel so alone in this cancer journey";
      const passesOtherChecks = (t: string) => {
        expect(evaluateEmergencyFastPath(t).isEmergency).toBe(false);
        expect(new SafetyService().evaluate(t).classification).toBe("normal");
      };

      it("urgency indicators only (S2 template): ChatService runs and no stale notice is sent", async () => {
        passesOtherChecks(URGENT_ONLY);
        expect(new EmpathyDetector().detectMentalHealthNeed(URGENT_ONLY).needsSupport).toBe(false);
        expect(new AbstentionService().hasUrgencyIndicators(URGENT_ONLY)).toBe(true);

        await svc.processInbound(svc.parseInbound(webhook([staleText("w1", URGENT_ONLY)])));

        expect(chat.handle).toHaveBeenCalledTimes(1);
        expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: URGENT_ONLY }));
        expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
      });

      it("mental-health screen only (MH templates): ChatService runs and no stale notice is sent", async () => {
        passesOtherChecks(MH_SUPPORT_ONLY);
        expect(new AbstentionService().hasUrgencyIndicators(MH_SUPPORT_ONLY)).toBe(false);
        expect(new EmpathyDetector().detectMentalHealthNeed(MH_SUPPORT_ONLY).needsSupport).toBe(true);

        await svc.processInbound(svc.parseInbound(webhook([staleText("w1", MH_SUPPORT_ONLY)])));

        expect(chat.handle).toHaveBeenCalledTimes(1);
        expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ userText: MH_SUPPORT_ONLY }));
        expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
      });

      // Second-round review: pin each of the four checks with a probe that
      // trips ONLY that check, so disabling any one of them fails a test.
      const fastPath = (t: string) => evaluateEmergencyFastPath(t).isEmergency;
      const rules = (t: string) => new SafetyService().evaluate(t).classification;
      const urgency = (t: string) => new AbstentionService().hasUrgencyIndicators(t);
      const mh = (t: string) => new EmpathyDetector().detectMentalHealthNeed(t).needsSupport;

      const expectStalePipelineRun = async (body: string) => {
        await svc.processInbound(svc.parseInbound(webhook([staleText("w1", body)])));
        expect(chat.handle).toHaveBeenCalledTimes(1);
        expect(sendText).not.toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
      };

      it("fast path only (Hinglish bleeding): runs the pipeline", async () => {
        const probe = "bahut khoon aa raha hai";
        expect(fastPath(probe)).toBe(true);
        expect(rules(probe)).toBe("normal");
        expect(urgency(probe)).toBe(false);
        expect(mh(probe)).toBe(false);
        await expectStalePipelineRun(probe);
      });

      it.each([
        ["emergency", "saans nahi aa rahi", "red_flag"],
        ["self-harm", "mujhe jeena nahi hai", "self_harm"],
      ])("safety rules only (%s): runs the pipeline", async (_label, probe, classification) => {
        expect(fastPath(probe)).toBe(false);
        expect(rules(probe)).toBe(classification);
        expect(urgency(probe)).toBe(false);
        expect(mh(probe)).toBe(false);
        await expectStalePipelineRun(probe);
      });

      // The pipeline applies correctMedicalSpelling to typed input before any
      // check. The guard must see what the pipeline sees.
      it.each([
        "fever during kemotherapy",
        "kemotherapy ke baad tez bukhar",
        "fever during tretment",
        "should i stop kemotherapy",
        "do i have canser",
      ])(
        "misspelt %p passes every check raw but is flagged after spelling correction: runs the pipeline",
        async (probe) => {
          expect(fastPath(probe) || rules(probe) !== "normal" || urgency(probe) || mh(probe)).toBe(false);
          await expectStalePipelineRun(probe);
        },
      );

      it("an ordinary stale message still gets the notice", async () => {
        await svc.processInbound(svc.parseInbound(webhook([staleText("w1", "synthetic question")])));

        expect(chat.handle).not.toHaveBeenCalled();
        expect(sendText).toHaveBeenCalledWith(CONTACT_A, STALE_MESSAGE_NOTICE);
      });
    });

    it("records the notice kind and whether it was sent, so processed is not read as delivered", async () => {
      const backlog = ["w1", "w2"].map((id) => text(id, CONTACT_A, 7 * 3600));
      await svc.processInbound(svc.parseInbound(webhook(backlog)));

      expect(ledger.rows.get(inboundLedgerId("w1")).payload).toMatchObject({
        status: "processed",
        notice: "stale",
        noticeSent: true,
      });
      expect(ledger.rows.get(inboundLedgerId("w2")).payload).toMatchObject({
        status: "processed",
        notice: "stale",
        noticeSent: false,
      });
    });

    it("records the unsupported-type notice the same way", async () => {
      const burst = ["w1", "w2"].map((id) => ({ id, from: CONTACT_A, type: "image" }));
      await svc.processInbound(svc.parseInbound(webhook(burst)));

      expect(ledger.rows.get(inboundLedgerId("w1")).payload).toMatchObject({ notice: "unsupported_type", noticeSent: true });
      expect(ledger.rows.get(inboundLedgerId("w2")).payload).toMatchObject({ notice: "unsupported_type", noticeSent: false });
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

    it("falls back to the default (off) on a missing, empty, negative or non-numeric value", () => {
      expect(staleThresholdMs({})).toBe(0);
      expect(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "" })).toBe(0);
      expect(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "-5" })).toBe(0);
      expect(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "soon" })).toBe(0);
      expect(staleThresholdMs({ WHATSAPP_STALE_MESSAGE_MINUTES: "45" })).toBe(45 * 60_000);
    });

    it("treats a timestamp in the future as fresh", () => {
      const msg: InboundMessage = { wamid: "w1", from: CONTACT_A, text: "x", sentAt: NOW_MS / 1000 + 600 };
      expect(noticeKindFor(msg, NOW_MS, 30 * 60_000)).toBeNull();
    });
  });

  // The notice path through the real sendText (issue #231 behaviour): Meta
  // rejects or fails, sendText retries a transient first-part failure once and
  // then throws WhatsAppDeliveryError.
  describe("notice delivery failures", () => {
    let fetchMock: jest.Mock;
    const okResponse = () => ({ ok: true, status: 200, text: async () => "{}" });
    const statusResponse = (status: number) => ({
      ok: false,
      status,
      text: async () => '{"error":{"message":"synthetic","code":190}}',
    });
    const image = (id: string) => svc.parseInbound(webhook([{ id, from: CONTACT_A, type: "image" }]));
    const row = (wamid: string) => ledger.rows.get(inboundLedgerId(wamid)).payload;

    beforeEach(() => {
      // sendText's retry pause is a real setTimeout.
      jest.useRealTimers();
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

    it("a 401 is not retried, is recorded as a delivery failure with the notice kind, sends no fallback and frees the slot", async () => {
      fetchMock.mockResolvedValueOnce(statusResponse(401));
      await svc.processInbound(image("w1"));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(row("w1")).toMatchObject({
        status: "failed",
        failedStage: "delivery",
        httpStatus: 401,
        metaErrorCode: 190,
        partsSent: 0,
        notice: "unsupported_type",
        noticeSent: false,
      });
      expect(chat.handle).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(okResponse());
      await svc.processInbound(image("w2"));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body).text.body).toBe(UNSUPPORTED_TYPE_NOTICE);
      expect(row("w2")).toMatchObject({ status: "processed", notice: "unsupported_type", noticeSent: true });
    });

    it("a 500 followed by success on the retry counts as sent and keeps the slot", async () => {
      fetchMock.mockResolvedValueOnce(statusResponse(500)).mockResolvedValueOnce(okResponse());
      await svc.processInbound(image("w1"));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(row("w1")).toMatchObject({ status: "processed", notice: "unsupported_type", noticeSent: true });
      expect(row("w1").failedStage).toBeUndefined();

      await svc.processInbound(image("w2"));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(row("w2")).toMatchObject({ status: "processed", notice: "unsupported_type", noticeSent: false });
    });

    it("two 500s are recorded as a delivery failure with the notice kind, send no fallback and free the slot", async () => {
      fetchMock.mockResolvedValueOnce(statusResponse(500)).mockResolvedValueOnce(statusResponse(500));
      await svc.processInbound(image("w1"));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(row("w1")).toMatchObject({
        status: "failed",
        failedStage: "delivery",
        httpStatus: 500,
        notice: "unsupported_type",
        noticeSent: false,
      });
      for (const call of fetchMock.mock.calls) {
        expect(JSON.parse(call[1].body).text.body).toBe(UNSUPPORTED_TYPE_NOTICE);
      }

      fetchMock.mockResolvedValueOnce(okResponse());
      await svc.processInbound(image("w2"));
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(row("w2")).toMatchObject({ status: "processed", noticeSent: true });
    });

    it("a failed stale notice carries its kind too", async () => {
      jest.useFakeTimers({ now: NOW_MS, doNotFake: ["setTimeout"] });
      process.env.WHATSAPP_STALE_MESSAGE_MINUTES = "30";
      fetchMock.mockResolvedValue(statusResponse(401));
      await svc.processInbound(
        svc.parseInbound(
          webhook([
            { id: "w1", from: CONTACT_A, type: "text", text: { body: "synthetic question" }, timestamp: secondsAgo(7 * 3600) },
          ]),
        ),
      );
      expect(chat.handle).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(row("w1")).toMatchObject({ status: "failed", failedStage: "delivery", notice: "stale", noticeSent: false });
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
      expect(limiter.size).toBeLessThanOrEqual(3);
    });

    it("forgets an expired entry on lookup, well below the size cap", () => {
      const limiter = new NoticeLimiter(1000);
      limiter.tryAcquire(CONTACT_A, "stale", 0);
      limiter.tryAcquire(CONTACT_B, "stale", 10);
      expect(limiter.size).toBe(2);
      // Both expired. The next lookup, for anyone, drops them.
      limiter.tryAcquire("910000000003", "stale", 5000);
      expect(limiter.size).toBe(1);
    });

    it("re-acquiring an expired contact replaces its entry", () => {
      const limiter = new NoticeLimiter(1000);
      limiter.tryAcquire(CONTACT_A, "stale", 0);
      expect(limiter.tryAcquire(CONTACT_A, "stale", 1500)).toBe(true);
      expect(limiter.size).toBe(1);
    });

    it("holds no raw contact id: keys are salted hashes", () => {
      const limiter = new NoticeLimiter(1000);
      limiter.tryAcquire(CONTACT_A, "stale", 0);
      limiter.tryAcquire(CONTACT_A, "unsupported_type", 0);
      for (const key of limiter.keys()) {
        expect(key).toMatch(/^[0-9a-f]{64}$/);
        expect(key).not.toContain(CONTACT_A);
      }
      // A second process (new salt) derives different keys for the same contact.
      const other = new NoticeLimiter(1000);
      other.tryAcquire(CONTACT_A, "stale", 0);
      expect(other.keys()).not.toContain(limiter.keys()[0]);
    });
  });
});
