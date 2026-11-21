import { Logger } from "@nestjs/common";
import { WhatsAppService } from "./whatsapp.service";
import { detectLocale } from "./whatsapp-format";
import { ChatService } from "../chat/chat.service";
import { cleanResponseForDisplay } from "../chat/display-text-cleaner";
import { EmpathyDetector } from "../chat/empathy-detector";
import { GreetingFlowService } from "../chat/greeting-flow.service";
import { IntentClassifier } from "../chat/intent-classifier";
import { OutputVerifierService } from "../chat/output-verifier.service";
import { PatientStateService } from "../chat/patient-state.service";
import { StructuredExtractorService } from "../chat/structured-extractor.service";
import { TemplateSelector } from "../chat/template-selector";
import { AbstentionService } from "../abstention/abstention.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { CrossLingualService } from "../rag/cross-lingual.service";
import { appendDisclaimer } from "../safety/disclaimer-engine";
import { evaluateEmergencyFastPath } from "../safety/emergency-fast-path";
import { SafetyService } from "../safety/safety.service";

/**
 * A WhatsApp contact whose stored session no longer exists (PR #202).
 *
 * WhatsAppService self-heals that case when ChatService.handle throws
 * "Invalid sessionId": it mints a fresh session and retries once. PR #202 runs
 * the safety screen before the session lookup, so this pins that the reorder
 * cannot turn a deleted session into a different error on a safety turn. The
 * real ChatService runs here. Its session read finds nothing for the deleted
 * id and finds the fresh one. All text is synthetic.
 */

const EMERGENCY = "I am coughing up blood right now";
const ORDINARY = "what is chemotherapy?";
const PAST_GATES = "PAST_SAFETY_GATES";

function sessionRow(id: string) {
  return {
    id,
    createdAt: new Date(0),
    channel: "whatsapp",
    locale: "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
}

function buildChat(prisma: any): ChatService {
  const empathy = new EmpathyDetector();
  const abstention = new AbstentionService();
  const intent = new IntentClassifier(abstention);
  const greeting = new GreetingFlowService(prisma, empathy);
  // The first step of the ordinary pipeline. Reaching it proves the turn ran
  // past every safety gate with a valid session.
  jest.spyOn(greeting, "isGreetingFlowInProgress").mockRejectedValue(new Error(PAST_GATES));
  const unused = () => Promise.reject(new Error("not expected"));
  return new ChatService(
    prisma,
    new AnalyticsService(prisma),
    new SafetyService(),
    { retrieveWithMetadata: jest.fn(unused), retrieveWithExpansion: jest.fn(unused) } as any,
    { generateWithCitations: jest.fn(unused), generateRaw: jest.fn(unused), generate: jest.fn(unused) } as any,
    { validateEvidence: jest.fn() } as any,
    { extractCitations: jest.fn(), validateCitations: jest.fn(), enrichCitations: jest.fn() } as any,
    abstention,
    intent,
    new TemplateSelector(intent),
    { validate: jest.fn() } as any,
    greeting,
    empathy,
    new StructuredExtractorService(),
    new PatientStateService(),
    { enforce: (t: string) => t } as any,
    { multiRetrieve: jest.fn(unused) } as any,
    { needsDecomposition: () => false, decompose: jest.fn() } as any,
    new CrossLingualService(),
    { needsPlanning: () => false, plan: jest.fn() } as any,
    { execute: jest.fn() } as any,
    new OutputVerifierService(),
    { copilotMode: "off", review: jest.fn(), persistRecord: jest.fn(), buildBlockedFallback: jest.fn() } as any,
    { startTrace: () => ({}), startSpan: () => ({}), endSpan: () => undefined, finalizeTrace: () => undefined } as any,
  );
}

describe("WhatsApp contact whose stored session was deleted", () => {
  let chat: ChatService;
  let handle: jest.SpyInstance;
  let svc: WhatsAppService;
  let sendText: jest.SpyInstance;
  let ledgerRows: Map<string, any>;

  beforeEach(() => {
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    const rows = () => ({
      create: jest.fn(async (args: any) => ({ id: args?.data?.id ?? "row", ...(args?.data ?? {}) })),
      update: jest.fn(async () => ({})),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
    });
    const chatPrisma: any = {
      // The session read: the deleted id finds nothing, the fresh one is found.
      $queryRaw: jest.fn(async (_strings: any, id: string) => (id === "sess-new" ? [sessionRow(id)] : [])),
      session: rows(),
      message: rows(),
      safetyEvent: rows(),
      analyticsEvent: rows(),
    };
    chat = buildChat(chatPrisma);
    handle = jest.spyOn(chat, "handle");

    ledgerRows = new Map();
    const waPrisma: any = {
      whatsAppContact: {
        findUnique: jest.fn(async () => ({ waId: "9199", sessionId: "sess-gone", lastActiveAt: new Date() })),
        update: jest.fn(async () => ({})),
        upsert: jest.fn(async () => ({})),
      },
      analyticsEvent: {
        findUnique: jest.fn(async ({ where }: any) => ledgerRows.get(where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          ledgerRows.set(where.id, { id: where.id, ...data });
          return ledgerRows.get(where.id);
        }),
      },
    };
    const sessions: any = { create: jest.fn(async () => ({ id: "sess-new", createdAt: new Date() })) };
    svc = new WhatsAppService(waPrisma, chat, sessions, new SafetyService(), new AbstentionService(), new EmpathyDetector());
    sendText = jest.spyOn(svc, "sendText").mockResolvedValue(1);
  });

  afterEach(async () => {
    await chat.settleBackgroundWrites();
    jest.restoreAllMocks();
  });

  it("an ordinary message self-heals as before: Invalid sessionId, a fresh session, one retry", async () => {
    await svc.processClaimed([{ wamid: "ds1", from: "9199", text: ORDINARY }]);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle.mock.calls.map((c) => c[0].sessionId)).toEqual(["sess-gone", "sess-new"]);
    await expect(handle.mock.results[0].value).rejects.toThrow("Invalid sessionId");
    // The retry ran past every safety gate with the fresh session.
    await expect(handle.mock.results[1].value).rejects.toThrow(PAST_GATES);
  });

  it("an emergency message self-heals the same way and gets its template", async () => {
    await svc.processClaimed([{ wamid: "ds2", from: "9199", text: EMERGENCY }]);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle.mock.calls.map((c) => c[0].sessionId)).toEqual(["sess-gone", "sess-new"]);
    // The deleted session fails with the same error as on main, so the
    // self-heal still triggers on a safety turn.
    await expect(handle.mock.results[0].value).rejects.toThrow("Invalid sessionId");
    const locale = detectLocale(EMERGENCY);
    const expected = cleanResponseForDisplay(
      appendDisclaimer(evaluateEmergencyFastPath(EMERGENCY).responseText!, locale, true, EMERGENCY),
    );
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("9199", expected);
    expect(ledgerRows.get("wa-inbound:ds2").payload).toMatchObject({ status: "processed", partsSent: 1 });
  });
});
