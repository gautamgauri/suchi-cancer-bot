/**
 * Guard on judge-retry configuration (issue #110, review finding P2).
 *
 * `parseInt("always", 10)` is NaN. `callJudgeWithRetry` terminates on
 * `attempt > maxRetries`, which is permanently false for NaN — so a single
 * mis-typed EVAL_JUDGE_RETRIES turned a retryable 429 into an infinite retry
 * loop that ran until the workflow timeout, instead of an unscored case.
 */

import { loadConfig } from "./loader";
import { DEFAULT_JUDGE_RETRIES, MAX_JUDGE_RETRIES } from "../runner/judge-errors";

const ENV_KEYS = ["EVAL_JUDGE_RETRIES", "GOOGLE_CLOUD_PROJECT", "DEEPSEEK_API_KEY"];

describe("loadConfig — judgeRetries is always a finite, bounded integer", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    // Keep Secret Manager out of a unit test: it is skipped without a project.
    delete process.env.GOOGLE_CLOUD_PROJECT;
    process.env.DEEPSEEK_API_KEY = "unit-test";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  async function judgeRetriesFor(value?: string): Promise<number> {
    if (value === undefined) delete process.env.EVAL_JUDGE_RETRIES;
    else process.env.EVAL_JUDGE_RETRIES = value;
    const cfg = await loadConfig();
    return cfg.judgeRetries as number;
  }

  it("REGRESSION: a non-numeric EVAL_JUDGE_RETRIES falls back to the default, never NaN", async () => {
    for (const junk of ["always", "", "   ", "3.5.1", "null", "NaN"]) {
      const n = await judgeRetriesFor(junk);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBe(DEFAULT_JUDGE_RETRIES);
    }
  });

  it("accepts a sane numeric string", async () => {
    expect(await judgeRetriesFor("0")).toBe(0);
    expect(await judgeRetriesFor("5")).toBe(5);
  });

  it("clamps negative and absurd values into range", async () => {
    expect(await judgeRetriesFor("-4")).toBe(0);
    expect(await judgeRetriesFor("100000")).toBe(MAX_JUDGE_RETRIES);
  });

  it("defaults when the variable is unset", async () => {
    expect(await judgeRetriesFor(undefined)).toBe(DEFAULT_JUDGE_RETRIES);
  });
});
