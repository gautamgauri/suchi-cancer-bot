/**
 * Xiaomi MiMo as an optional LLM judge (issue #226).
 *
 * JUDGE ONLY — this provider never generates a patient-facing answer.
 *
 * The behaviours pinned here are the ones that silently degrade a run rather
 * than failing it: a provider that is selected but whose client was never
 * built (every check comes back unscored, and unscored checks are normalised
 * out of the score), and a dispatch that quietly lands on the wrong provider.
 */

const mockCreate = jest.fn();
const mockOpenAICtor = jest.fn();

jest.mock("openai", () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: mockCreate } };
    constructor(opts: unknown) {
      mockOpenAICtor(opts);
    }
  },
}));

import { LLMJudge } from "./llm-judge";
import type { EvaluationConfig, LLMCheck, LLMJudgeConfig } from "../types";

const judgeConfig: LLMJudgeConfig = {
  model: "mimo-v2.5",
  prompt_contract: { format: "json", require_evidence_quotes: true, max_quote_words_per_field: 20 },
  checks: [],
  output_schema: {},
};

const checks: LLMCheck[] = [
  { id: "rag_backed_content", description: "grounded in retrieved KB content", required: true, type: "boolean" },
];

function baseConfig(overrides: Partial<EvaluationConfig> = {}): EvaluationConfig {
  return {
    apiBaseUrl: "https://example.invalid",
    llmProvider: "xiaomi",
    fallbackLlmProvider: "vertex_ai",
    vertexAiConfig: { project: "", location: "us-central1", model: "gemini-2.5-flash" },
    xiaomiConfig: { model: "mimo-v2.5", apiKey: "unit-test-key", baseURL: "https://api.xiaomimimo.com/v1" },
    timeoutMs: 1000,
    retries: 0,
    judgeRetries: 0,
    parallel: false,
    ...overrides,
  };
}

function verdict(usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            pass: true,
            score: 1,
            checks: { rag_backed_content: { ok: true, evidence: "cited throughout" } },
            fail_reasons: [],
          }),
        },
      },
    ],
    usage,
  };
}

describe("LLMJudge — Xiaomi MiMo provider", () => {
  let logs: jest.SpyInstance;
  let warns: jest.SpyInstance;

  beforeEach(() => {
    mockCreate.mockReset();
    mockOpenAICtor.mockReset();
    logs = jest.spyOn(console, "log").mockImplementation(() => undefined);
    warns = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logs.mockRestore();
    warns.mockRestore();
  });

  it("builds a client against the configured base URL and reports itself available", () => {
    const judge = new LLMJudge(baseConfig());

    expect(judge.isAvailable()).toBe(true);
    expect(mockOpenAICtor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "unit-test-key", baseURL: "https://api.xiaomimimo.com/v1" })
    );
  });

  it("builds a client when xiaomi is only the fallback provider", () => {
    // Without this the fallback can never fire: isFallbackAvailable() tests the
    // client, so a fallback-only provider with no client is dead wiring.
    new LLMJudge(baseConfig({ llmProvider: "vertex_ai", fallbackLlmProvider: "xiaomi" }));

    expect(mockOpenAICtor).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://api.xiaomimimo.com/v1" })
    );
  });

  it("sends the judge prompt to the configured MiMo model and parses the verdict", async () => {
    mockCreate.mockResolvedValue(verdict());
    const judge = new LLMJudge(baseConfig());

    const results = await judge.judge("A cited answer.", judgeConfig, checks);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ model: "mimo-v2.5", temperature: 0.1 });
    expect(results).toEqual([
      expect.objectContaining({ checkId: "rag_backed_content", passed: true }),
    ]);
  });

  it("honours XIAOMI_MODEL-style overrides in the dispatched request", async () => {
    mockCreate.mockResolvedValue(verdict());
    const judge = new LLMJudge(
      baseConfig({
        xiaomiConfig: { model: "mimo-v2-flash", apiKey: "unit-test-key", baseURL: "https://tp.invalid/v1" },
      })
    );

    await judge.judge("A cited answer.", judgeConfig, checks);

    expect(mockCreate.mock.calls[0][0].model).toBe("mimo-v2-flash");
  });

  it("is unavailable — and scores nothing — when the key is missing", async () => {
    const judge = new LLMJudge(
      baseConfig({ xiaomiConfig: { model: "mimo-v2.5", apiKey: "   ", baseURL: "https://api.xiaomimimo.com/v1" } })
    );

    expect(judge.isAvailable()).toBe(false);
    expect(mockOpenAICtor).not.toHaveBeenCalled();

    const results = await judge.judge("A cited answer.", judgeConfig, checks);

    // Unscored, never a failed check: a missing credential is not evidence of
    // a bad answer (issue #110).
    expect(mockCreate).not.toHaveBeenCalled();
    expect(results[0].passed).toBe(false);
    expect(results[0].unscored).toBe(true);
  });

  it("falls back to Xiaomi when the primary provider fails", async () => {
    mockCreate
      .mockRejectedValueOnce(new Error("openai is down"))
      .mockResolvedValueOnce(verdict());

    const judge = new LLMJudge(
      baseConfig({
        llmProvider: "openai",
        fallbackLlmProvider: "xiaomi",
        openAiConfig: { model: "gpt-4o", apiKey: "openai-unit-test-key" },
      })
    );

    const results = await judge.judge("A cited answer.", judgeConfig, checks);

    expect(mockCreate.mock.calls[0][0].model).toBe("gpt-4o");
    expect(mockCreate.mock.calls[1][0].model).toBe("mimo-v2.5");
    expect(results[0].passed).toBe(true);
    expect(judge.getCostSummary().fallbackUsedCount).toBe(1);
  });

  it("tracks tokens and cost for a priced model", async () => {
    mockCreate.mockResolvedValue(verdict({ prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 }));
    const judge = new LLMJudge(baseConfig());

    await judge.judge("A cited answer.", judgeConfig, checks);

    const summary = judge.getCostSummary();
    expect(summary.callCount).toBe(1);
    expect(summary.totalTokens).toBe(1100);
    expect(summary.totalCost).toBeCloseTo(1000 * 0.000000119 + 100 * 0.000000238, 10);
  });

  it("reports an unpriced model as unknown cost rather than pricing it off a sibling model", async () => {
    mockCreate.mockResolvedValue(verdict({ prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 }));
    const judge = new LLMJudge(
      baseConfig({
        xiaomiConfig: { model: "mimo-v2.5-pro", apiKey: "unit-test-key", baseURL: "https://api.xiaomimimo.com/v1" },
      })
    );

    await judge.judge("A cited answer.", judgeConfig, checks);

    const summary = judge.getCostSummary();
    expect(summary.totalTokens).toBe(1100);
    expect(summary.totalCost).toBe(0);
    expect(Number.isNaN(summary.totalCost)).toBe(false);
    expect(logs.mock.calls.flat().join(" ")).toContain("cost unknown");
  });
});
