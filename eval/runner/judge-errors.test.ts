/**
 * Unit tests for LLM-judge error classification and bounded retry (issue #110).
 *
 * The motivating regression: RQ-PROSTATE-02 had all six judge checks come back
 * as Vertex `ClientError ... got status: 429` and was scored 36.4% — a quality
 * failure manufactured from quota noise.
 */

import {
  backoffDelayMs,
  callJudgeWithRetry,
  classifyJudgeError,
  extractStatusCode,
  isUnscored,
  summarizeUnscoredReasons,
  unscoredJudgeResult,
  parseOkVerdict,
  describeOkValue,
} from "./judge-errors";

/** Exact shape thrown by @google-cloud/vertexai on a 429 (no `status` property). */
function vertexClientError(code: number, statusText: string, grpcStatus: string): Error {
  const body = {
    error: { code, message: `${grpcStatus} for model`, status: grpcStatus },
  };
  const err: any = new Error(
    `[VertexAI.ClientError]: got status: ${code} ${statusText}. ${JSON.stringify(body)}`
  );
  err.name = "ClientError";
  err.cause = { code, status: grpcStatus, message: body.error.message };
  return err;
}

describe("extractStatusCode", () => {
  it("recovers the status from Vertex ClientError message + cause", () => {
    const err = vertexClientError(429, "Too Many Requests", "RESOURCE_EXHAUSTED");
    expect(extractStatusCode(err)).toBe(429);
  });
  it("reads OpenAI-style `status` and axios-style `response.status`", () => {
    expect(extractStatusCode({ status: 503 })).toBe(503);
    expect(extractStatusCode({ response: { status: 500 } })).toBe(500);
  });
  it("reads a bare HTTP code from the message", () => {
    expect(extractStatusCode(new Error("upstream returned HTTP 502"))).toBe(502);
  });
  it("ignores non-HTTP numeric codes", () => {
    expect(extractStatusCode({ code: "ECONNRESET" })).toBeUndefined();
    expect(extractStatusCode({ code: 7 })).toBeUndefined();
    expect(extractStatusCode(undefined)).toBeUndefined();
  });
});

describe("classifyJudgeError — transport failures are never verdicts", () => {
  it("REGRESSION #110: Vertex 429 ClientError is rate_limited, retryable, transport", () => {
    const c = classifyJudgeError(vertexClientError(429, "Too Many Requests", "RESOURCE_EXHAUSTED"));
    expect(c.kind).toBe("rate_limited");
    expect(c.statusCode).toBe(429);
    expect(c.retryable).toBe(true);
    expect(c.transport).toBe(true);
    expect(c.label).toBe("rate_limited (HTTP 429)");
  });

  it("classifies OpenAI-SDK 429 with Retry-After header", () => {
    const c = classifyJudgeError({ status: 429, message: "Rate limit reached", headers: { "retry-after": "7" } });
    expect(c.kind).toBe("rate_limited");
    expect(c.retryAfterMs).toBe(7000);
  });

  it("reads Vertex retryDelay hints from the error body", () => {
    const err: any = new Error(
      '[VertexAI.ClientError]: got status: 429 Too Many Requests. {"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"12s"}]}}'
    );
    expect(classifyJudgeError(err).retryAfterMs).toBe(12000);
  });

  it("classifies 5xx / UNAVAILABLE as provider_error (retryable)", () => {
    expect(classifyJudgeError(vertexClientError(503, "Service Unavailable", "UNAVAILABLE")).kind).toBe("provider_error");
    expect(classifyJudgeError({ status: 500, message: "Internal Server Error" }).kind).toBe("provider_error");
    expect(classifyJudgeError({ status: 500, message: "boom" }).retryable).toBe(true);
  });

  it("classifies timeouts (retryable) and network errors (retryable)", () => {
    expect(classifyJudgeError({ code: "ETIMEDOUT", message: "connect ETIMEDOUT" }).kind).toBe("timeout");
    expect(classifyJudgeError(new Error("Request timed out")).kind).toBe("timeout");
    expect(classifyJudgeError({ code: "ECONNRESET", message: "socket hang up" }).kind).toBe("network_error");
    expect(classifyJudgeError(new Error("fetch failed")).kind).toBe("network_error");
    expect(classifyJudgeError(new Error("fetch failed")).retryable).toBe(true);
  });

  it("classifies auth failures as transport but NOT retryable", () => {
    const authErr: any = new Error("[VertexAI.GoogleAuthError]: Unable to authenticate your request");
    authErr.name = "GoogleAuthError";
    const c = classifyJudgeError(authErr);
    expect(c.kind).toBe("auth_failed");
    expect(c.transport).toBe(true);
    expect(c.retryable).toBe(false);
    expect(classifyJudgeError({ status: 403, message: "Forbidden" }).kind).toBe("auth_failed");
    expect(classifyJudgeError(vertexClientError(401, "Unauthorized", "UNAUTHENTICATED")).kind).toBe("auth_failed");
  });

  it("classifies a missing SDK as sdk_missing (not retryable)", () => {
    const c = classifyJudgeError(new Error("Vertex AI SDK not installed. Run: npm install @google-cloud/vertexai"));
    expect(c.kind).toBe("sdk_missing");
    expect(c.retryable).toBe(false);
  });

  it("falls back to unknown (not transport, not retryable) and never throws", () => {
    const c = classifyJudgeError(new Error("something odd"));
    expect(c.kind).toBe("unknown");
    expect(c.transport).toBe(false);
    expect(c.retryable).toBe(false);
    expect(() => classifyJudgeError(null)).not.toThrow();
    expect(() => classifyJudgeError("a string")).not.toThrow();
    expect(classifyJudgeError(undefined).kind).toBe("unknown");
  });
});

describe("backoffDelayMs", () => {
  const rl = classifyJudgeError(vertexClientError(429, "Too Many Requests", "RESOURCE_EXHAUSTED"));
  it("grows exponentially with bounded jitter and a cap", () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 5000, random: () => 0 };
    expect(backoffDelayMs(1, rl, opts)).toBe(1000);
    expect(backoffDelayMs(2, rl, opts)).toBe(2000);
    expect(backoffDelayMs(3, rl, opts)).toBe(4000);
    expect(backoffDelayMs(4, rl, opts)).toBe(5000); // capped
    expect(backoffDelayMs(1, rl, { ...opts, random: () => 1 })).toBe(1500); // + jitter ≤ base/2
  });
  it("honours a server Retry-After hint, capped", () => {
    expect(backoffDelayMs(1, { ...rl, retryAfterMs: 7000 }, { maxDelayMs: 30000 })).toBe(7000);
    expect(backoffDelayMs(1, { ...rl, retryAfterMs: 90000 }, { maxDelayMs: 30000 })).toBe(30000);
  });
});

describe("callJudgeWithRetry", () => {
  const noSleep = async () => {};

  it("retries a 429 with backoff and returns the eventual verdict", async () => {
    const delays: number[] = [];
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 3) throw vertexClientError(429, "Too Many Requests", "RESOURCE_EXHAUSTED");
      return '{"checks":{}}';
    });
    const out = await callJudgeWithRetry(fn, {
      maxRetries: 3,
      sleep: noSleep,
      random: () => 0,
      baseDelayMs: 100,
      onRetry: ({ delayMs }) => delays.push(delayMs),
    });
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 200]);
  });

  it("gives up after maxRetries and reports the classification without throwing", async () => {
    const fn = jest.fn(async () => {
      throw vertexClientError(429, "Too Many Requests", "RESOURCE_EXHAUSTED");
    });
    const out = await callJudgeWithRetry(fn, { maxRetries: 2, sleep: noSleep });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.attempts).toBe(3); // 1 + 2 retries
    expect(out.classification.kind).toBe("rate_limited");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors (auth, unknown)", async () => {
    const auth = jest.fn(async () => {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    });
    const outAuth = await callJudgeWithRetry(auth, { maxRetries: 5, sleep: noSleep });
    expect(outAuth.ok).toBe(false);
    expect(outAuth.attempts).toBe(1);
    expect(auth).toHaveBeenCalledTimes(1);

    const odd = jest.fn(async () => {
      throw new Error("weird");
    });
    const outOdd = await callJudgeWithRetry(odd, { maxRetries: 5, sleep: noSleep });
    expect(outOdd.attempts).toBe(1);
  });

  it("maxRetries: 0 means a single attempt", async () => {
    const fn = jest.fn(async () => {
      throw { status: 503, message: "Service Unavailable" };
    });
    const out = await callJudgeWithRetry(fn, { maxRetries: 0, sleep: noSleep });
    expect(out.attempts).toBe(1);
  });
});

describe("unscored result helpers", () => {
  it("unscoredJudgeResult is passed=false, skipped (legacy) AND unscored with a reason", () => {
    const r = unscoredJudgeResult(
      "rag_backed_content",
      { kind: "rate_limited", label: "rate_limited (HTTP 429)" },
      "[VertexAI.ClientError]: got status: 429 Too Many Requests.",
      4
    );
    expect(r).toMatchObject({
      checkId: "rag_backed_content",
      passed: false,
      skipped: true,
      unscored: true,
      unscoredReason: "rate_limited",
      attempts: 4,
    });
    expect(r.error).toMatch(/^rate_limited \(HTTP 429\): \[VertexAI\.ClientError\]/);
  });

  it("truncates very long provider messages so reports stay readable", () => {
    const r = unscoredJudgeResult("x", { kind: "unknown", label: "unknown" }, "y".repeat(2000));
    expect(r.error!.length).toBeLessThan(500);
    expect(r.error!.endsWith("…")).toBe(true);
  });

  it("isUnscored recognises both the new flag and the legacy `skipped`", () => {
    expect(isUnscored({ unscored: true })).toBe(true);
    expect(isUnscored({ skipped: true })).toBe(true);
    expect(isUnscored({})).toBe(false);
    expect(isUnscored({ unscored: false, skipped: false })).toBe(false);
  });

  it("summarizeUnscoredReasons groups by label and ignores rendered verdicts", () => {
    const results = [
      unscoredJudgeResult("a", { kind: "rate_limited", label: "rate_limited (HTTP 429)" }, "m"),
      unscoredJudgeResult("b", { kind: "rate_limited", label: "rate_limited (HTTP 429)" }, "m"),
      unscoredJudgeResult("c", { kind: "timeout", label: "timeout" }, "m"),
      { checkId: "d", passed: false, evidence: "a genuine fail verdict" },
      { checkId: "e", passed: true },
    ];
    expect(summarizeUnscoredReasons(results)).toBe("rate_limited (HTTP 429) ×2, timeout ×1");
    expect(summarizeUnscoredReasons([{ checkId: "e", passed: true }])).toBeUndefined();
    expect(summarizeUnscoredReasons(undefined)).toBeUndefined();
  });
});

describe("parseOkVerdict — only a real verdict counts as a verdict (#110 review P1)", () => {
  it("accepts booleans", () => {
    expect(parseOkVerdict(true)).toBe(true);
    expect(parseOkVerdict(false)).toBe(false);
  });

  it('accepts the "true"/"false" strings Gemini intermittently returns', () => {
    expect(parseOkVerdict("true")).toBe(true);
    expect(parseOkVerdict("false")).toBe(false);
    expect(parseOkVerdict(" TRUE ")).toBe(true);
    expect(parseOkVerdict("False")).toBe(false);
  });

  it("rejects missing / null / numeric / free-text values", () => {
    for (const bad of [undefined, null, 1, 0, "maybe", "yes", "no", "", "1", {}, []]) {
      expect(parseOkVerdict(bad)).toBeUndefined();
    }
  });

  it("describeOkValue renders the offending value compactly", () => {
    expect(describeOkValue(undefined)).toBe("missing");
    expect(describeOkValue(null)).toBe("null");
    expect(describeOkValue(1)).toBe("number 1");
    expect(describeOkValue("maybe")).toBe('string "maybe"');
    expect(describeOkValue([])).toBe("array");
  });
});

