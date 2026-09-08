import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";
import { MetaWebhookBody } from "./whatsapp.types";

/**
 * Back-to-back inbound messages (issue #94).
 *
 * On 2026-09-06 a user sent "Hii", "Hi", "Hey", "Hello" within seconds and one
 * reply was the S2 urgent-escalation template. The leading hypothesis was that
 * concurrent `processClaimed` calls crossed their wires and fed one claim's text
 * to another claim's pipeline. These tests check that directly (they pass on the
 * unfixed code — the texts never cross) and pin the concurrency behaviour that
 * *was* wrong: four full chat turns for one contact ran simultaneously, which
 * raced session minting and stretched a turn past ChatService's 30s pre-RAG
 * budget.
 */

/** Ledger stand-in: PK collision → Prisma P2002, as the real de-dup relies on. */
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
              messages: [{ id: wamid, from, type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  } as MetaWebhookBody;
}

const REQ = { rawBody: Buffer.from("{}") } as any;
const CONTACT = "919999900001";
const BURST = [
  { wamid: "wamid.A", text: "Hii" },
  { wamid: "wamid.B", text: "Hi" },
  { wamid: "wamid.C", text: "Hey" },
  { wamid: "wamid.D", text: "Hello" },
];

describe("WhatsApp rapid-sequential inbound (issue #94)", () => {
  let prisma: any;
  let chat: any;
  let sessions: any;
  let svc: WhatsAppService;
  let ctrl: WhatsAppController;
  let sent: Array<{ to: string; text: string }>;
  /** Chat turns currently executing, per contact. */
  let inFlight: Map<string, number>;
  let maxInFlight: Map<string, number>;
  let sessionSeq: number;

  beforeEach(() => {
    process.env.META_WABA_PHONE_NUMBER_ID = "PNID";
    process.env.META_WABA_TOKEN = "tok";
    process.env.META_APP_SECRET = "secret";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify";
    process.env.WHATSAPP_SESSION_TTL_HOURS = "24";

    sent = [];
    inFlight = new Map();
    maxInFlight = new Map();
    sessionSeq = 0;

    // A contact row that only becomes visible once it has been written, so a
    // racing `resolveSession` genuinely mints a second session.
    const contacts = new Map<string, any>();
    prisma = {
      whatsAppContact: {
        findUnique: jest.fn(async ({ where }: any) => contacts.get(where.waId) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          contacts.set(where.waId, { ...contacts.get(where.waId), ...data });
          return contacts.get(where.waId);
        }),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const row = contacts.has(where.waId)
            ? { ...contacts.get(where.waId), ...update }
            : { ...create };
          contacts.set(where.waId, row);
          return row;
        }),
      },
      analyticsEvent: makeLedgerMock(),
    };

    chat = {
      handle: jest.fn(async ({ userText, sessionId }: any) => {
        const waId = CONTACT;
        const now = (inFlight.get(waId) ?? 0) + 1;
        inFlight.set(waId, now);
        maxInFlight.set(waId, Math.max(maxInFlight.get(waId) ?? 0, now));
        // Yield a few times so any real overlap is observable.
        for (let i = 0; i < 3; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 5));
        inFlight.set(waId, (inFlight.get(waId) ?? 1) - 1);
        // Echo the text back so a crossed wire is visible in the reply.
        return { responseText: `answer to: ${userText} (session ${sessionId})` };
      }),
    };

    sessions = {
      create: jest.fn(async () => ({ id: `sess-${++sessionSeq}`, createdAt: new Date() })),
    };

    svc = new WhatsAppService(prisma, chat, sessions);
    jest.spyOn(svc, "sendText").mockImplementation(async (to: string, text: string) => {
      sent.push({ to, text });
    });
    jest.spyOn(svc, "verifySignature").mockReturnValue(true);
    ctrl = new WhatsAppController(svc);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Fire the burst at the controller the way Meta does: 4 POSTs, no waiting. */
  async function fireBurst() {
    const acks = await Promise.all(
      BURST.map((m) => ctrl.receive(REQ, "sha256=ok", textWebhook(m.wamid, CONTACT, m.text))),
    );
    // Let every fire-and-forget pipeline settle.
    for (let i = 0; i < 200; i++) await new Promise((r) => setTimeout(r, 1));
    return acks;
  }

  it("answers each message with its own text — no claim/text crossing", async () => {
    const acks = await fireBurst();

    expect(acks).toEqual(BURST.map(() => ({ received: 1, accepted: 1 })));
    expect(chat.handle).toHaveBeenCalledTimes(4);

    // Every distinct inbound text reached the pipeline exactly once.
    const seen = (chat.handle as jest.Mock).mock.calls.map((c) => c[0].userText).sort();
    expect(seen).toEqual(["Hello", "Hey", "Hi", "Hii"]);

    // And every reply answers the text it was generated from.
    expect(sent).toHaveLength(4);
    for (const { text } of sent) {
      const answered = /^answer to: (.+?) \(session /.exec(text)?.[1];
      expect(BURST.map((m) => m.text)).toContain(answered);
    }
    const answeredTexts = sent
      .map((s) => /^answer to: (.+?) \(session /.exec(s.text)?.[1])
      .sort();
    expect(answeredTexts).toEqual(["Hello", "Hey", "Hi", "Hii"]);
  });

  it("processes one contact's burst sequentially instead of four turns at once", async () => {
    await fireBurst();
    // Before the fix this was 4: every webhook POST started its own pipeline,
    // so four full chat turns shared one session and one Prisma pool.
    expect(maxInFlight.get(CONTACT)).toBe(1);
  });

  it("mints exactly one session for a burst from a new contact", async () => {
    await fireBurst();
    expect(sessions.create).toHaveBeenCalledTimes(1);
    const usedSessions = new Set(
      (chat.handle as jest.Mock).mock.calls.map((c) => c[0].sessionId),
    );
    expect(usedSessions.size).toBe(1);
  });

  it("keeps the batch order for one contact", async () => {
    await fireBurst();
    expect((chat.handle as jest.Mock).mock.calls.map((c) => c[0].userText)).toEqual([
      "Hii",
      "Hi",
      "Hey",
      "Hello",
    ]);
  });

  it("still processes different contacts in parallel", async () => {
    const other = "919999900002";
    let concurrent = 0;
    let peak = 0;
    (chat.handle as jest.Mock).mockImplementation(async ({ userText }: any) => {
      peak = Math.max(peak, ++concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return { responseText: `answer to: ${userText}` };
    });

    await Promise.all([
      ctrl.receive(REQ, "sha256=ok", textWebhook("wamid.X", CONTACT, "Hii")),
      ctrl.receive(REQ, "sha256=ok", textWebhook("wamid.Y", other, "Hello")),
    ]);
    for (let i = 0; i < 100; i++) await new Promise((r) => setTimeout(r, 1));

    expect(chat.handle).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);
  });

  it("a failure on one message does not block the rest of the contact's queue", async () => {
    (chat.handle as jest.Mock).mockImplementationOnce(async () => {
      throw new Error("pipeline exploded");
    });

    await fireBurst();

    expect(chat.handle).toHaveBeenCalledTimes(4);
    expect(sent).toHaveLength(4);
    expect(sent[0].text).toMatch(/something went wrong/i);
    expect(sent.slice(1).map((s) => s.text)).toEqual(
      expect.arrayContaining([expect.stringContaining("answer to: Hi ")]),
    );
  });
});
