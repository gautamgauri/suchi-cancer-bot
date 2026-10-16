import { GatewayTimeoutException } from "@nestjs/common";
import { ChatController, timeoutSafety } from "./chat.controller";
import { ChatService, TurnProgress } from "./chat.service";
import { ChatDto } from "./dto";

/**
 * Issue #221: the 504 body that ChatController sends when a turn passes its
 * 55s timeout hardcoded `safety: { classification: "normal", actions: [] }`.
 * On 2026-10-12 an urgent-framed probe was cut off mid-pipeline and reported
 * as assessed-normal. The body must carry only what the pipeline concluded.
 *
 * The patient-facing reply on this path is SCCF copy (RELIABILITY_BACKLOG
 * P1-11). This change must not alter it, so the text is pinned here too.
 */

const TIMEOUT_COPY =
  "I'm sorry — my response is taking longer than expected. " +
  "In the meantime, here are some general steps you can take:\n\n" +
  "1. **Talk to a doctor**: If you have symptoms or concerns about cancer, the most important step is seeing a healthcare professional.\n" +
  "2. **Indian Cancer Society Helpline**: Call 1800-22-1951 (toll-free) for guidance.\n" +
  "3. **Emergency**: If you're experiencing severe symptoms (coughing blood, sudden severe pain, difficulty breathing), call 112 or 108 for an ambulance.\n\n" +
  "Please try asking your question again — I should be able to give you a more detailed, referenced answer.";

const dto: ChatDto = {
  sessionId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
  channel: "web",
  userText: "What is chemotherapy?",
};

/** A ChatService whose turn records `concluded` (if any) and then never finishes. */
function hangingChat(concluded?: TurnProgress["safety"]) {
  return {
    handle: jest.fn().mockImplementation((_dto: ChatDto, _signal: AbortSignal, progress: TurnProgress) => {
      if (concluded) progress.safety = concluded;
      return new Promise(() => undefined);
    }),
  } as unknown as ChatService;
}

async function timeoutBody(chat: ChatService): Promise<any> {
  const controller = new ChatController(chat);
  (controller as any).REQUEST_TIMEOUT_MS = 10;
  try {
    await controller.send(dto);
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayTimeoutException);
    return (err as GatewayTimeoutException).getResponse();
  }
  throw new Error("expected a 504");
}

describe("ChatController — 504 timeout body (issue #221)", () => {
  it("does not claim a safety assessment when the turn was cut off before one was made", async () => {
    const body = await timeoutBody(hangingChat());

    expect(body.safety).toBeUndefined();
    expect(body.safetyAssessed).toBe(false);
    expect(body.error).toBe("timeout");
  });

  it("reports the urgent classification the pipeline had reached, not 'normal'", async () => {
    const body = await timeoutBody(hangingChat({ classification: "red_flag", source: "urgency_indicators" }));

    expect(body.safetyAssessed).toBe(true);
    expect(body.safety.classification).toBe("red_flag");
    expect(body.safety.source).toBe("urgency_indicators");
  });

  it("reports 'normal' only when the safety stage actually concluded normal", async () => {
    const body = await timeoutBody(hangingChat({ classification: "normal", source: "safety_module" }));

    expect(body.safety).toEqual({ classification: "normal", actions: [], source: "safety_module" });
  });

  it("does not attach escalation actions or change the patient-facing copy (SCCF-owned, P1-11)", async () => {
    const body = await timeoutBody(hangingChat({ classification: "red_flag", source: "urgency_indicators" }));

    expect(body.safety.actions).toEqual([]);
    expect(body.responseText).toBe(TIMEOUT_COPY);
    expect(body.sessionId).toBe(dto.sessionId);
  });

  it("maps a pool-exhaustion error (Prisma P2024 text contains 'timeout') the same way", async () => {
    const chat = {
      handle: jest.fn().mockImplementation((_d: ChatDto, _s: AbortSignal, progress: TurnProgress) => {
        progress.safety = { classification: "red_flag", source: "emergency_fast_path" };
        return Promise.reject(
          new Error(
            "Timed out fetching a new connection from the connection pool. (Current connection pool timeout: 10, connection limit: 5)",
          ),
        );
      }),
    } as unknown as ChatService;

    const body = await timeoutBody(chat);

    expect(body.safety.classification).toBe("red_flag");
    expect(body.responseText).toBe(TIMEOUT_COPY);
  });

  it("timeoutSafety never invents a classification", () => {
    expect(timeoutSafety({})).toEqual({ safetyAssessed: false });
  });
});
