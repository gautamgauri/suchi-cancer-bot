/**
 * Config wiring for the optional Xiaomi MiMo judge (issue #226).
 *
 * Xiaomi is a JUDGE-ONLY provider. Nothing here may be reused for
 * patient-facing generation: that needs a separate decision covering data
 * handling, Hindi/Hinglish quality and SCCF clinical review.
 *
 * The risk this guards is the one that bit the DeepSeek judge (see
 * default-config.test.ts): a judge whose credential or endpoint is wrong does
 * not fail loudly, it returns unscored checks, and a run with unscored checks
 * can read as healthier than it is.
 */

import { loadConfig } from "./loader";

const ENV_KEYS = [
  "EVAL_LLM_PROVIDER",
  "EVAL_FALLBACK_LLM_PROVIDER",
  "GOOGLE_CLOUD_PROJECT",
  "XIAOMI_API_KEY",
  "XIAOMI_MODEL",
  "XIAOMI_BASE_URL",
];

describe("loadConfig — Xiaomi MiMo judge provider", () => {
  const saved: Record<string, string | undefined> = {};
  let warn: jest.SpyInstance;

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    // Keep Secret Manager out of a unit test: it is skipped without a project.
    delete process.env.GOOGLE_CLOUD_PROJECT;
    for (const k of ENV_KEYS) delete process.env[k];
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  it("loads xiaomiConfig when xiaomi is the primary provider", async () => {
    process.env.EVAL_LLM_PROVIDER = "xiaomi";
    process.env.XIAOMI_API_KEY = "unit-test-key";

    const cfg = await loadConfig();

    expect(cfg.llmProvider).toBe("xiaomi");
    expect(cfg.xiaomiConfig?.apiKey).toBe("unit-test-key");
  });

  it("loads xiaomiConfig when xiaomi is only the fallback provider", async () => {
    process.env.EVAL_LLM_PROVIDER = "vertex_ai";
    process.env.EVAL_FALLBACK_LLM_PROVIDER = "xiaomi";
    process.env.XIAOMI_API_KEY = "unit-test-key";

    const cfg = await loadConfig();

    expect(cfg.fallbackLlmProvider).toBe("xiaomi");
    expect(cfg.xiaomiConfig?.apiKey).toBe("unit-test-key");
  });

  it("does not load xiaomiConfig from the environment when no slot selects xiaomi", async () => {
    // A stray XIAOMI_API_KEY in the environment must not quietly attach a
    // provider the run did not ask for.
    process.env.EVAL_LLM_PROVIDER = "vertex_ai";
    process.env.EVAL_FALLBACK_LLM_PROVIDER = "vertex_ai";
    process.env.XIAOMI_API_KEY = "unit-test-key";

    const cfg = await loadConfig();

    expect(cfg.xiaomiConfig).toBeUndefined();
  });

  it("warns — and still returns a config — when the key is missing", async () => {
    process.env.EVAL_LLM_PROVIDER = "xiaomi";

    const cfg = await loadConfig();

    expect(cfg.xiaomiConfig?.apiKey).toBe("");
    expect(warn.mock.calls.flat().join(" ")).toContain("XIAOMI_API_KEY is not set");
  });

  it("defaults to the pay-as-you-go endpoint and lets the environment override it", async () => {
    // Token Plan accounts use a regional host (tp- keys); the default is the
    // pay-as-you-go host and is unconfirmed against our plan (#226 step 2).
    process.env.EVAL_LLM_PROVIDER = "xiaomi";
    process.env.XIAOMI_API_KEY = "unit-test-key";

    const def = await loadConfig();
    expect(def.xiaomiConfig?.baseURL).toBe("https://api.xiaomimimo.com/v1");
    expect(def.xiaomiConfig?.model).toBe("mimo-v2.5");

    process.env.XIAOMI_BASE_URL = "https://token-plan-sgp.xiaomimimo.com/v1";
    process.env.XIAOMI_MODEL = "mimo-v2-flash";

    const overridden = await loadConfig();
    expect(overridden.xiaomiConfig?.baseURL).toBe("https://token-plan-sgp.xiaomimimo.com/v1");
    expect(overridden.xiaomiConfig?.model).toBe("mimo-v2-flash");
  });
});
