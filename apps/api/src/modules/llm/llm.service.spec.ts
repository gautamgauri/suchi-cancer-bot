/**
 * Unit tests for LlmService — the LLM-failure → safe-response contract
 * (FR-CHAT-004 / NFR-AVAIL-001).
 *
 * The whole chat pipeline relies on generateWithCitations() NEVER throwing:
 * on provider failure it must return a safe, non-medical fallback string so the
 * user gets a graceful answer instead of a 500. We force failure by stubbing
 * the private callGeminiLLM seam (which itself swallows errors → null).
 *
 * Constructed directly with a ConfigService stub (GEMINI_API_KEY present so the
 * provider resolves to gemini) and a no-op ObservabilityService.
 */

import { LlmService } from "./llm.service";

const generateContent = jest.fn();
const getGenerativeModel = jest.fn(() => ({ generateContent }));

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({ getGenerativeModel })),
}));

function makeConfig(overrides: Record<string, string> = {}) {
  const map: Record<string, string> = { GEMINI_API_KEY: "test-key", ...overrides };
  return { get: (key: string) => map[key] };
}

function makeObservability() {
  return {
    startGenerationById: jest.fn(() => ({ id: "gen-1" })),
    endGeneration: jest.fn(),
  };
}

/** Shape of a Gemini SDK result, with the finishReason the API reports. */
function geminiResult(text: string, finishReason: string) {
  return {
    response: {
      text: () => text,
      candidates: [{ finishReason, content: { parts: [{ text }] } }],
    },
  };
}

function makeChunks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    docId: `doc-${i}`,
    chunkId: `chunk-${i}`,
    content: `Reference content number ${i} about cancer care.`,
    similarity: 0.8,
    document: { title: `Source ${i}`, sourceType: "kb", isTrustedSource: true },
  }));
}

describe("LlmService — failure → safe response (FR-CHAT-004)", () => {
  let service: LlmService;
  let callGemini: jest.SpyInstance;

  beforeEach(() => {
    service = new LlmService(makeConfig() as never, {} as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callGemini = jest.spyOn(service as any, "callGeminiLLM");
  });

  it("returns the abstention response (never throws) when the LLM yields nothing", async () => {
    callGemini.mockResolvedValue(null);

    const out = await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(5) as never);

    // Safe, non-medical abstention text with Indian helplines — not a thrown 500.
    expect(typeof out).toBe("string");
    expect(out).toContain("1800-22-1951");
    expect(out).not.toMatch(/you have cancer/i);
  });

  it("retries once with reduced context before abstaining when there are >3 chunks", async () => {
    callGemini.mockResolvedValue(null);

    await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(5) as never);

    // First full attempt + one reduced-context retry = 2 provider calls.
    expect(callGemini).toHaveBeenCalledTimes(2);
  });

  it("does not retry when there are <=3 chunks", async () => {
    callGemini.mockResolvedValue(null);

    await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(2) as never);

    expect(callGemini).toHaveBeenCalledTimes(1);
  });

  it("returns the safe fallback (never throws) when the provider call rejects", async () => {
    callGemini.mockRejectedValue(new Error("network down"));

    const out = await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(2) as never);

    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    // Fallback is generic + safety-first, never a diagnosis.
    expect(out).not.toMatch(/you have cancer/i);
  });

  it("returns the model output unchanged on the happy path", async () => {
    const answer = "Chemotherapy uses drugs to treat cancer [citation:doc-0:chunk-0].";
    callGemini.mockResolvedValue(answer);

    const out = await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(5) as never);

    expect(out).toBe(answer);
    expect(callGemini).toHaveBeenCalledTimes(1); // no retry needed
  });

  it("throws at construction when gemini is selected with no credentials", () => {
    expect(() => new LlmService(makeConfig({ GEMINI_API_KEY: "" }) as never, {} as never)).toThrow(
      /GEMINI_API_KEY/,
    );
  });
});

/**
 * Regression: live /chat replies arrived cut off mid-sentence — e.g. "Screening
 * for oral cancer means looking for cancer before a person has any symptoms
 * [citation:" — because gemini-2.5-flash spends its thinking tokens out of
 * maxOutputTokens, stops at finishReason=MAX_TOKENS, and the SDK's text()
 * returns the fragment without complaining.
 */
describe("LlmService — truncated Gemini output must never reach the user", () => {
  const TRUNCATED =
    "Screening for oral cancer means looking for cancer before a person has any symptoms [citation:";
  const COMPLETE =
    "Screening for oral cancer means looking for cancer before symptoms appear " +
    "[citation:doc-0:chunk-0]. A dentist or doctor examines the mouth for sores or " +
    "white patches [citation:doc-1:chunk-1].";

  let service: LlmService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LlmService(makeConfig() as never, makeObservability() as never);
  });

  function callGemini(maxTokens = 1200): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (service as any).callGeminiLLM("system", "user", maxTokens, true);
  }

  it("does not return a fragment when generation stopped at MAX_TOKENS", async () => {
    generateContent
      .mockResolvedValueOnce(geminiResult(TRUNCATED, "MAX_TOKENS"))
      .mockResolvedValueOnce(geminiResult(COMPLETE, "STOP"));

    const out = await callGemini();

    expect(out).toBe(COMPLETE);
    expect(out).not.toContain(TRUNCATED);
  });

  it("retries once with a larger answer budget after a MAX_TOKENS stop", async () => {
    generateContent
      .mockResolvedValueOnce(geminiResult(TRUNCATED, "MAX_TOKENS"))
      .mockResolvedValueOnce(geminiResult(COMPLETE, "STOP"));

    await callGemini(1200);

    expect(generateContent).toHaveBeenCalledTimes(2);
    const budgets = getGenerativeModel.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ([params]: any) => params.generationConfig.maxOutputTokens,
    );
    expect(budgets[1]).toBeGreaterThan(budgets[0]);
  });

  it("gives up (returns null) rather than deliver a still-truncated answer", async () => {
    generateContent.mockResolvedValue(geminiResult(TRUNCATED, "MAX_TOKENS"));

    expect(await callGemini()).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(2); // one retry, then stop
  });

  it("surfaces the safe abstention text — not the fragment — to the chat pipeline", async () => {
    generateContent.mockResolvedValue(geminiResult(TRUNCATED, "MAX_TOKENS"));

    const out = await service.generateWithCitations(
      "explain",
      "",
      "oral cancer ka screening kya hai?",
      makeChunks(2) as never,
    );

    expect(out).not.toContain("[citation:");
    expect(out).toContain("1800-22-1951");
  });

  it("pins a thinking budget on top of the caller's answer budget", async () => {
    generateContent.mockResolvedValue(geminiResult(COMPLETE, "STOP"));

    await callGemini(1200);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = (getGenerativeModel.mock.calls[0] as any)[0].generationConfig;
    const thinkingBudget = config.thinkingConfig?.thinkingBudget;

    // Thinking must be bounded, and its tokens must not be taken out of the
    // answer allowance — otherwise the answer is what gets cut off.
    expect(thinkingBudget).toEqual(expect.any(Number));
    expect(config.maxOutputTokens).toBe(1200 + thinkingBudget);
  });

  it("passes a complete answer straight through", async () => {
    generateContent.mockResolvedValue(geminiResult(COMPLETE, "STOP"));

    expect(await callGemini()).toBe(COMPLETE);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
