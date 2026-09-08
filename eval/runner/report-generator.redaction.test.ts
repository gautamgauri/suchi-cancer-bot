/**
 * Reports generated here are uploaded as CI artifacts by eval-tier1.yml and
 * some are committed to the repo, so a live credential reaching a report is a
 * disclosure, not just untidiness.
 *
 * This suite exists because the leak was real: nightly artifacts carried a
 * usable DEEPSEEK_API_KEY while the committed report showed "REDACTED", so the
 * committed copy actively hid the problem. Every assertion below is therefore
 * about the *generated* report object, never a fixture.
 */
import { ReportGenerator } from "./report-generator";
import { EvaluationConfig, EvaluationResult } from "../types";

/**
 * Every secret-bearing path in EvaluationConfig (eval/types/index.ts).
 * vertexAiConfig is intentionally absent: it authenticates via ADC and holds
 * project/location/model only.
 *
 * If you add a credential field to EvaluationConfig, add it here — the
 * completeness test below is what stops the next silent leak.
 */
const SECRET_PATHS: ReadonlyArray<readonly string[]> = [
  ["authBearer"],
  ["openAiConfig", "apiKey"],
  ["deepseekConfig", "apiKey"],
];

const SENTINELS = {
  authBearer: "sentinel-bearer-2f9c1a",
  openAi: "sk-sentinel-openai-7b41d0",
  deepseek: "sk-sentinel-deepseek-3e88fa",
} as const;

function makeConfig(): EvaluationConfig {
  return {
    apiBaseUrl: "https://example.invalid",
    authBearer: SENTINELS.authBearer,
    llmProvider: "vertex_ai",
    fallbackLlmProvider: "vertex_ai",
    vertexAiConfig: { project: "proj", location: "us-central1", model: "gemini-2.5-flash" },
    openAiConfig: { model: "gpt-x", apiKey: SENTINELS.openAi },
    deepseekConfig: { model: "deepseek-chat", apiKey: SENTINELS.deepseek, baseURL: "https://ds.invalid" },
    timeoutMs: 1000,
    retries: 0,
    parallel: false,
  };
}

function makeResults(): EvaluationResult[] {
  return [
    { caseId: "C1", passed: true, score: 1, executionTimeMs: 5 } as unknown as EvaluationResult,
  ];
}

function read(obj: unknown, path: readonly string[]): unknown {
  return path.reduce<any>((acc, k) => (acc == null ? acc : acc[k]), obj);
}

describe("ReportGenerator — config secret redaction", () => {
  it("redacts the DeepSeek API key", () => {
    const report = new ReportGenerator().generateReport(makeResults(), makeConfig());
    expect(report.config.deepseekConfig?.apiKey).toBe("REDACTED");
    expect(report.config.deepseekConfig?.apiKey).not.toBe(SENTINELS.deepseek);
  });

  it("redacts the OpenAI API key", () => {
    const report = new ReportGenerator().generateReport(makeResults(), makeConfig());
    expect(report.config.openAiConfig?.apiKey).toBe("REDACTED");
  });

  it("redacts authBearer", () => {
    const report = new ReportGenerator().generateReport(makeResults(), makeConfig());
    expect((report.config as any).authBearer).toBe("REDACTED");
  });

  it("redacts every secret-bearing path in EvaluationConfig", () => {
    const report = new ReportGenerator().generateReport(makeResults(), makeConfig());
    for (const path of SECRET_PATHS) {
      expect(read(report.config, path)).toBe("REDACTED");
    }
  });

  it("leaks no sentinel anywhere in the serialised report", () => {
    // The real defect was a key reaching a serialised artifact, so assert on
    // the serialised form rather than only on the fields we remembered.
    const report = new ReportGenerator().generateReport(makeResults(), makeConfig());
    const serialised = JSON.stringify(report);
    for (const sentinel of Object.values(SENTINELS)) {
      expect(serialised).not.toContain(sentinel);
    }
  });

  it("preserves the caller's config object — redaction must not mutate live state", () => {
    // The runner reuses this config for subsequent calls; redacting in place
    // would silently break the judge and any retry after the first report.
    const config = makeConfig();
    new ReportGenerator().generateReport(makeResults(), config);
    expect(config.deepseekConfig?.apiKey).toBe(SENTINELS.deepseek);
    expect(config.openAiConfig?.apiKey).toBe(SENTINELS.openAi);
    expect(config.authBearer).toBe(SENTINELS.authBearer);
  });

  it("preserves non-secret configuration in the report", () => {
    const report = new ReportGenerator().generateReport(makeResults(), makeConfig());
    expect(report.config.apiBaseUrl).toBe("https://example.invalid");
    expect(report.config.llmProvider).toBe("vertex_ai");
    expect(report.config.vertexAiConfig).toEqual({
      project: "proj",
      location: "us-central1",
      model: "gemini-2.5-flash",
    });
    expect(report.config.deepseekConfig?.model).toBe("deepseek-chat");
    expect(report.config.openAiConfig?.model).toBe("gpt-x");
    expect(report.config.timeoutMs).toBe(1000);
  });

  it("does not invent secret fields when the config omits them", () => {
    const bare: EvaluationConfig = {
      apiBaseUrl: "https://example.invalid",
      llmProvider: "vertex_ai",
      timeoutMs: 1000,
      retries: 0,
      parallel: false,
    };
    const report = new ReportGenerator().generateReport(makeResults(), bare);
    expect(report.config.deepseekConfig).toBeUndefined();
    expect(report.config.openAiConfig).toBeUndefined();
    expect((report.config as any).authBearer).toBeUndefined();
  });
});
