/**
 * LlmService.generateStructuredJson — the JSON-mode seam used by the shadow
 * AI safety classifier. The Gemini SDK is mocked; no real API calls.
 */
import { LlmService } from "./llm.service";

const generateContent = jest.fn();
const getGenerativeModel = jest.fn((..._args: unknown[]) => ({ generateContent }));

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({ getGenerativeModel })),
}));

const observability = { startGenerationById: jest.fn(), endGeneration: jest.fn() };

function makeService(overrides: Record<string, string> = {}) {
  const map: Record<string, string> = { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-2.5-flash", ...overrides };
  return new LlmService({ get: (k: string) => map[k] } as never, observability as never);
}

const SCHEMA = { type: "object", properties: { severity: { type: "string", enum: ["none"] } }, required: ["severity"] };

const result = (text: string) => ({ response: { text: () => text, candidates: [{ finishReason: "STOP" }] } });

const opts = (extra: Record<string, unknown> = {}) => ({
  systemInstruction: "SYS",
  userPrompt: "USER",
  responseSchema: SCHEMA,
  temperature: 0,
  maxOutputTokens: 128,
  timeoutMs: 200,
  ...extra,
});

describe("LlmService.generateStructuredJson", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requests JSON mode with the schema, caller temperature and thinking off on Flash", async () => {
    generateContent.mockResolvedValue(result('{"severity":"none"}'));
    const out = await makeService().generateStructuredJson(opts());

    expect(out).toEqual({ text: '{"severity":"none"}', model: "gemini-2.5-flash", finishReason: "STOP" });
    const [modelParams, requestOptions] = getGenerativeModel.mock.calls[0] as any[];
    expect(modelParams.model).toBe("gemini-2.5-flash");
    expect(modelParams.systemInstruction).toBe("SYS");
    expect(modelParams.generationConfig).toMatchObject({
      temperature: 0,
      maxOutputTokens: 128,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    });
    expect(requestOptions).toEqual({ timeout: 200 });
    const [request, single] = generateContent.mock.calls[0] as any[];
    expect(request.contents[0].parts[0].text).toBe("USER");
    expect(single.signal).toBeDefined();
  });

  it("honours a model override", async () => {
    generateContent.mockResolvedValue(result("{}"));
    const out = await makeService().generateStructuredJson(opts({ model: "gemini-2.0-flash-001" }));
    expect(out.model).toBe("gemini-2.0-flash-001");
    const cfg = (getGenerativeModel.mock.calls[0] as any[])[0].generationConfig;
    expect(cfg.thinkingConfig).toBeUndefined(); // non-thinking model: no thinkingConfig (it would 400)
  });

  it("does not send anything to observability (no prompt text leaves via Langfuse)", async () => {
    generateContent.mockResolvedValue(result("{}"));
    await makeService().generateStructuredJson(opts());
    expect(observability.startGenerationById).not.toHaveBeenCalled();
  });

  it("rejects on timeout and aborts the request", async () => {
    let signal: AbortSignal | undefined;
    generateContent.mockImplementation((_req: unknown, single: any) => {
      signal = single.signal;
      return new Promise(() => undefined);
    });
    await expect(makeService().generateStructuredJson(opts({ timeoutMs: 20 }))).rejects.toThrow(/TIMEOUT/);
    expect(signal?.aborted).toBe(true);
  });

  it("rejects on empty output and on API errors", async () => {
    generateContent.mockResolvedValueOnce(result(""));
    await expect(makeService().generateStructuredJson(opts())).rejects.toThrow(/no output/);
    generateContent.mockRejectedValueOnce(new Error("429"));
    await expect(makeService().generateStructuredJson(opts())).rejects.toThrow("429");
  });
});
