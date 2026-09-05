/**
 * Guards on the judge configuration in default.json.
 *
 * Regression (2026-09-05): the judge was silently inactive for months.
 * `llmProvider` and `fallbackLlmProvider` were BOTH "deepseek", so when the
 * DeepSeek credential was rejected the "fallback" re-called the same dead
 * credential, every judge check came back `skipped`, and calculateScore() —
 * which normalizes over only the checks that ran — reported 20/21 passing on a
 * set that scores 6/21 with the judge actually running. A green nightly was
 * reporting on checks that never executed.
 */

import config from "./default.json";

describe("eval default config — the judge must be able to run", () => {
  // NOTE: primary and fallback are both vertex_ai. That is deliberate — there is
  // no second judge credential in this project (OpenAI unset, DeepSeek retired
  // and unrotated), so a distinct fallback would be fiction. The real defect a
  // same-provider fallback exposed was not the duplication but that a failing
  // judge marks checks `skipped` and calculateScore() then normalizes them away,
  // turning a broken judge into a higher score. That is tracked separately; a
  // judge failure must fail the run, not inflate it.

  it("names a Vertex judge model that is not retired", () => {
    // gemini-2.0-flash-001 was withdrawn from Vertex; requests against it fail
    // and take the whole judge down with them.
    const RETIRED = ["gemini-2.0-flash-001", "gemini-1.5-flash", "gemini-1.5-pro"];
    expect(RETIRED).not.toContain(config.vertexAiConfig.model);
  });

  it("does not default either provider slot to deepseek", () => {
    // deepseek-chat was retired 2026-07-24 and the key is unrotated after an
    // artifact leak; nothing in this repo should silently route the judge there.
    expect(config.llmProvider).not.toBe("deepseek");
    expect(config.fallbackLlmProvider).not.toBe("deepseek");
  });
});
