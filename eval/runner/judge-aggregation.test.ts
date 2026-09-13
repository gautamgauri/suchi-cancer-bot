/**
 * Aggregation tests for the unscored / judge_unavailable outcome (issue #110).
 *
 * Classification lives in judge-errors.test.ts. This file covers what the
 * pipeline DOES with a transport failure once classified:
 *   - scoring: unscored checks leave numerator and denominator alone
 *   - pass/fail: an unscored case is neither passed nor failed
 *   - precedence: rendered evidence of failure outranks a missing verdict
 *   - report buckets + judge-availability summary
 *   - per-case records and the failure-cluster report
 */

import { ReportGenerator } from "./report-generator";
import { LLMJudge } from "./llm-judge";
import { buildCaseRecord } from "./case-record";
import { generateClusterReport } from "./failure-cluster-report";
import { resolveCaseUnscored, unscoredJudgeResult } from "./judge-errors";
import { EMPTY_APPROVED_SOURCES } from "./citation-verifier";
import type {
  EvaluationConfig,
  EvaluationResult,
  LLMJudgeResult,
  Rubric,
  TestCase,
} from "../types";

const RATE_LIMITED = { kind: "rate_limited" as const, label: "rate_limited (HTTP 429)" };

const rubric: Rubric = {
  rubric_id: "tier1",
  intent: "GENERAL_INFO",
  pass_threshold: 0.8,
  weights: {
    citations_present: 0.4,
    rag_backed_content: 0.4,
    tone_supportive: 0.2,
  },
  deterministic_checks: [
    { id: "citations_present", required: true, type: "citations", params: {} },
  ],
  llm_judge: {
    model: "gemini-2.5-flash",
    prompt_contract: { format: "json", require_evidence_quotes: true, max_quote_words_per_field: 20 },
    checks: [
      { id: "rag_backed_content", description: "grounded", required: true, type: "boolean" },
      { id: "tone_supportive", description: "tone", required: false, type: "boolean" },
    ],
    output_schema: {},
  },
};

const config: EvaluationConfig = {
  apiBaseUrl: "http://localhost:3001",
  llmProvider: "vertex_ai",
  timeoutMs: 60000,
  retries: 2,
  parallel: false,
} as EvaluationConfig;

function makeResult(
  testCaseId: string,
  overrides: Partial<EvaluationResult> = {}
): EvaluationResult {
  return {
    testCaseId,
    passed: false,
    score: 0,
    deterministicResults: [{ checkId: "citations_present", passed: true, required: true, details: {} }],
    responseText: "Screening for prostate cancer can involve a PSA blood test.",
    responseMetadata: {
      sessionId: "s1",
      messageId: "m1",
      citations: [{ docId: "kb_doc_a", title: "NCI", position: 10 } as any],
      citationConfidence: "GREEN",
      retrievedChunks: [{ docId: "kb_doc_a" } as any],
    },
    executionTimeMs: 100,
    ...overrides,
  };
}

/** The motivating regression: all six judge checks came back Vertex 429. */
function allChecksRateLimited(): LLMJudgeResult[] {
  return ["rag_backed_content", "tone_supportive"].map((id) =>
    unscoredJudgeResult(id, RATE_LIMITED, "[VertexAI.ClientError]: got status: 429", 4)
  );
}

describe("calculateScore — unscored checks leave the score alone", () => {
  const rg = new ReportGenerator();

  it("excludes unscored checks from numerator AND denominator", () => {
    const scored = makeResult("RQ-PROSTATE-02", {
      llmJudgeResults: [
        { checkId: "rag_backed_content", passed: true },
        { checkId: "tone_supportive", passed: true },
      ],
    });
    expect(rg.calculateScore(scored, rubric)).toBeCloseTo(1.0, 5);

    // REGRESSION #110: the same answer with a rate-limited judge used to be
    // scored as if every judge check had FAILED (0.4/1.0 = 36.4%-style).
    const rateLimited = makeResult("RQ-PROSTATE-02", { llmJudgeResults: allChecksRateLimited() });
    expect(rg.calculateScore(rateLimited, rubric)).toBeCloseTo(1.0, 5);
  });

  it("still scores a genuine fail verdict as a failure", () => {
    const failed = makeResult("RQ-PROSTATE-02", {
      llmJudgeResults: [
        { checkId: "rag_backed_content", passed: false, evidence: "no KB support" },
        { checkId: "tone_supportive", passed: true },
      ],
    });
    expect(rg.calculateScore(failed, rubric)).toBeCloseTo(0.6, 5);
  });
});

describe("determinePass / determineUnscored", () => {
  const rg = new ReportGenerator();

  it("an unscored judge check makes the case neither passed nor failed", () => {
    const r = makeResult("RQ-PROSTATE-02", { llmJudgeResults: allChecksRateLimited() });
    expect(rg.determinePass(r, rubric)).toBe(false);
    expect(rg.determineUnscored(r, rubric)).toBe(true);
  });

  it("a fully scored, passing case is passed and not unscored", () => {
    const r = makeResult("RQ-PROSTATE-01", {
      llmJudgeResults: [
        { checkId: "rag_backed_content", passed: true },
        { checkId: "tone_supportive", passed: true },
      ],
    });
    expect(rg.determinePass(r, rubric)).toBe(true);
    expect(rg.determineUnscored(r, rubric)).toBe(false);
  });

  it("PRECEDENCE: a required check that rendered `fail` stays a failure even with an unscored sibling", () => {
    const r = makeResult("RQ-LUNG-02", {
      llmJudgeResults: [
        { checkId: "rag_backed_content", passed: false, evidence: "ungrounded claim" },
        unscoredJudgeResult("tone_supportive", RATE_LIMITED, "429"),
      ],
    });
    expect(rg.determinePass(r, rubric)).toBe(false);
    expect(rg.determineUnscored(r, rubric)).toBe(false);
  });

  it("PRECEDENCE: a required deterministic miss stays a failure even with unscored judge checks", () => {
    const r = makeResult("RQ-LUNG-03", {
      deterministicResults: [
        { checkId: "citations_present", passed: false, required: true, details: {} },
      ],
      llmJudgeResults: allChecksRateLimited(),
    });
    expect(rg.determinePass(r, rubric)).toBe(false);
    expect(rg.determineUnscored(r, rubric)).toBe(false);
  });

  it("PRECEDENCE: an execution error is never laundered into `unscored`", () => {
    const r = makeResult("RQ-LUNG-04", {
      error: "Failed to create session",
      errorStep: "session_create",
      llmJudgeResults: allChecksRateLimited(),
    });
    expect(rg.determineUnscored(r, rubric)).toBe(false);
  });

  it("honours the evaluator's explicit decision over the heuristic", () => {
    const r = makeResult("RQ-X", { unscored: false, llmJudgeResults: allChecksRateLimited() });
    expect(rg.determineUnscored(r)).toBe(false);
    expect(rg.determineUnscored({ ...r, unscored: true })).toBe(true);
  });

  it("resolveCaseUnscored without a rubric keeps rendered fails out of the bucket only for required ids it knows", () => {
    const withFail = {
      llmJudgeResults: [
        { checkId: "rag_backed_content", passed: false },
        unscoredJudgeResult("tone_supportive", RATE_LIMITED, "429"),
      ],
    };
    expect(resolveCaseUnscored(withFail)).toBe(true); // no rubric: cannot tell required
    expect(resolveCaseUnscored(withFail, new Set(["rag_backed_content"]))).toBe(false);
  });
});

describe("generateReport — three buckets, plus a judge-availability axis", () => {
  const rg = new ReportGenerator();

  const results: EvaluationResult[] = [
    makeResult("CASE-PASS", {
      passed: true,
      score: 1,
      unscored: false,
      llmJudgeResults: [
        { checkId: "rag_backed_content", passed: true },
        { checkId: "tone_supportive", passed: true },
      ],
    }),
    makeResult("CASE-FAIL", {
      passed: false,
      score: 0.6,
      unscored: false,
      llmJudgeResults: [
        { checkId: "rag_backed_content", passed: false, evidence: "ungrounded" },
        { checkId: "tone_supportive", passed: true },
      ],
    }),
    makeResult("CASE-429", {
      passed: false,
      score: 1,
      unscored: true,
      unscoredReason: "rate_limited (HTTP 429) ×2",
      llmJudgeResults: allChecksRateLimited(),
    }),
  ];

  const report = rg.generateReport(results, config, "run-1");

  it("counts unscored separately from passed and failed", () => {
    expect(report.summary.total).toBe(3);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.unscored).toBe(1);
  });

  it("keeps unscored cases out of `failures`", () => {
    expect(report.failures.map((f) => f.testCaseId)).toEqual(["CASE-FAIL"]);
  });

  it("summarises judge availability with reasons and affected case ids", () => {
    const judge = report.summary.judge!;
    expect(judge.status).toBe("degraded");
    expect(judge.scoredChecks).toBe(4);
    expect(judge.unscoredChecks).toBe(2);
    expect(judge.unscoredCases).toBe(1);
    expect(judge.unscoredCaseIds).toEqual(["CASE-429"]);
    expect(judge.reasons).toEqual({ "rate_limited (HTTP 429)": 2 });
  });

  it("reports `unavailable` when no check anywhere rendered a verdict", () => {
    const allDown = rg.generateReport(
      [
        makeResult("A", { unscored: true, llmJudgeResults: allChecksRateLimited() }),
        makeResult("B", { unscored: true, llmJudgeResults: allChecksRateLimited() }),
      ],
      config,
      "run-2"
    );
    expect(allDown.summary.judge!.status).toBe("unavailable");
    expect(allDown.summary.failed).toBe(0);
    expect(allDown.summary.unscored).toBe(2);
  });

  it("reports `active` and 0 unscored when the judge is healthy", () => {
    const healthy = rg.generateReport([results[0]], config, "run-3");
    expect(healthy.summary.judge!.status).toBe("active");
    expect(healthy.summary.unscored).toBe(0);
  });

  it("counts judge availability on a case that also failed on scored checks", () => {
    const mixed = rg.generateReport(
      [
        makeResult("CASE-MIXED", {
          passed: false,
          unscored: false,
          llmJudgeResults: [
            { checkId: "rag_backed_content", passed: false },
            unscoredJudgeResult("tone_supportive", RATE_LIMITED, "429"),
          ],
        }),
      ],
      config,
      "run-4"
    );
    expect(mixed.summary.failed).toBe(1);
    expect(mixed.summary.unscored).toBe(0);
    // Availability axis still sees the case: the judge did leave a hole in it.
    expect(mixed.summary.judge!.unscoredCases).toBe(1);
    expect(mixed.summary.judge!.unscoredCaseIds).toEqual(["CASE-MIXED"]);
  });

  it("summary text calls unscored cases out as not-failures", () => {
    const text = rg.generateSummaryText(report);
    expect(text).toContain("Unscored (judge unavailable): 1");
    expect(text).toContain("not counted as failures");
    expect(text).toContain("Status: DEGRADED");
    expect(text).toContain("UNSCORED CASES");
    expect(text).toContain("CASE-429");
  });
});

describe("per-case records and cluster report", () => {
  const testCase: TestCase = {
    id: "CASE-429",
    tier: 1,
    cancer: "prostate",
    intent: "GENERAL_INFO",
    user_messages: ["What is a PSA test?"],
    expectations: {},
  } as TestCase;

  const unscoredResult = makeResult("CASE-429", {
    passed: false,
    score: 1,
    unscored: true,
    unscoredReason: "rate_limited (HTTP 429) ×2",
    llmJudgeResults: allChecksRateLimited(),
  });

  const record = buildCaseRecord(unscoredResult, testCase, {
    runId: "run-1",
    suiteFile: "cases/tier1/retrieval_quality.yaml",
    approvedSources: EMPTY_APPROVED_SOURCES,
  });

  it("marks the case unscored with a reason and lists the unscored checks", () => {
    expect(record.outcome.unscored).toBe(true);
    expect(record.outcome.unscoredReason).toContain("rate_limited (HTTP 429)");
    expect(record.outcome.unscoredLlmChecks).toEqual(["rag_backed_content", "tone_supportive"]);
    expect(record.outcome.failedLlmChecks).toEqual([]);
  });

  it("files it under the judge-unavailable cluster, never quality", () => {
    expect(record.failureClusters).toContain("judge-unavailable");
    expect(record.failureClusters).not.toContain("quality");
  });

  it("a genuine failure with one unscored sibling is NOT filed as judge-unavailable", () => {
    const mixed = buildCaseRecord(
      makeResult("CASE-MIXED", {
        passed: false,
        unscored: false,
        llmJudgeResults: [
          { checkId: "rag_backed_content", passed: false },
          unscoredJudgeResult("tone_supportive", RATE_LIMITED, "429"),
        ],
      }),
      { ...testCase, id: "CASE-MIXED" },
      { runId: "run-1", approvedSources: EMPTY_APPROVED_SOURCES }
    );
    expect(mixed.outcome.unscored).toBe(false);
    expect(mixed.failureClusters).not.toContain("judge-unavailable");
    expect(mixed.outcome.failedLlmChecks).toEqual(["rag_backed_content"]);
    expect(mixed.outcome.unscoredLlmChecks).toEqual(["tone_supportive"]);
  });

  it("cluster report counts unscored cases apart from failures", () => {
    const cluster = generateClusterReport([record]);
    expect(cluster.totalCases).toBe(1);
    expect(cluster.failedCases).toBe(0);
    expect(cluster.unscoredCases).toBe(1);
    expect(cluster.clusters.map((c) => c.cluster)).toContain("judge-unavailable");
  });
});

describe("LLMJudge.judge — a transport failure never becomes a fail verdict", () => {
  const checks = [
    { id: "rag_backed_content", description: "grounded", required: true, type: "boolean" },
    { id: "tone_supportive", description: "tone", required: false, type: "boolean" },
  ];
  const judgeConfig = rubric.llm_judge;

  function vertexJudge(extra: Partial<EvaluationConfig> = {}) {
    return new LLMJudge(
      {
        ...config,
        llmProvider: "vertex_ai",
        fallbackLlmProvider: "vertex_ai", // same provider: not a real fallback
        vertexAiConfig: { project: "p", location: "us-central1", model: "gemini-2.5-flash" },
        judgeRetries: 2,
        ...extra,
      } as EvaluationConfig,
      { sleep: async () => undefined, random: () => 0, baseDelayMs: 1 }
    );
  }

  it("REGRESSION #110: a persistent Vertex 429 yields unscored checks, not failed checks", async () => {
    const judge = vertexJudge();
    const err: any = new Error("[VertexAI.ClientError]: got status: 429 Too Many Requests.");
    err.name = "ClientError";
    const call = jest.fn(async () => {
      throw err;
    });
    (judge as any).callLLM = call;

    const results = await judge.judge("some answer", judgeConfig, checks as any);

    expect(call).toHaveBeenCalledTimes(3); // 1 attempt + judgeRetries(2)
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.unscored).toBe(true);
      expect(r.skipped).toBe(true); // legacy alias for consumers that predate #110
      expect(r.unscoredReason).toBe("rate_limited");
      expect(r.error).toContain("rate_limited (HTTP 429)");
      expect(r.attempts).toBe(3);
    }
  });

  it("recovers when a retried call succeeds — real verdicts, no unscored flag", async () => {
    const judge = vertexJudge();
    let n = 0;
    (judge as any).callLLM = jest.fn(async () => {
      n += 1;
      if (n === 1) {
        const e: any = new Error("[VertexAI.ClientError]: got status: 429 Too Many Requests.");
        e.name = "ClientError";
        throw e;
      }
      return JSON.stringify({
        checks: {
          rag_backed_content: { ok: true, evidence: "cited" },
          tone_supportive: { ok: false, evidence: "curt" },
        },
      });
    });

    const results = await judge.judge("some answer", judgeConfig, checks as any);
    expect(n).toBe(2);
    expect(results.map((r) => r.passed)).toEqual([true, false]);
    expect(results.some((r) => r.unscored)).toBe(false);
  });

  it("an unconfigured judge returns unscored (not_configured), never failed checks", async () => {
    const judge = new LLMJudge({ ...config, llmProvider: "openai" } as EvaluationConfig);
    const results = await judge.judge("answer", judgeConfig, checks as any);
    expect(results.every((r) => r.unscored === true)).toBe(true);
    expect(results.every((r) => r.unscoredReason === "not_configured")).toBe(true);
  });

  it("an unparseable judge reply is a malformed verdict, not a fail verdict", async () => {
    const judge = vertexJudge();
    (judge as any).callLLM = jest.fn(async () => "I cannot comply with that request.");
    const results = await judge.judge("answer", judgeConfig, checks as any);
    expect(results.every((r) => r.unscored === true)).toBe(true);
    expect(results.every((r) => r.unscoredReason === "malformed_verdict")).toBe(true);
  });

  it("still records a genuine fail verdict as a failure", async () => {
    const judge = vertexJudge();
    (judge as any).callLLM = jest.fn(async () =>
      JSON.stringify({
        checks: {
          rag_backed_content: { ok: false, evidence: "ungrounded claim" },
          tone_supportive: { ok: true },
        },
      })
    );
    const results = await judge.judge("answer", judgeConfig, checks as any);
    expect(results[0]).toMatchObject({ checkId: "rag_backed_content", passed: false });
    expect(results[0].unscored).toBeUndefined();
  });
});

describe("LLMJudge.parseResponse — an incomplete verdict is unscored, not a fail (#110 review P1)", () => {
  const checks = [
    { id: "rag_backed_content", description: "grounded", required: true, type: "boolean" },
  ];
  const judgeConfig = rubric.llm_judge;

  /** A judge whose transport always succeeds, returning `body` verbatim. */
  function judgeReturning(body: string): LLMJudge {
    const judge = new LLMJudge(
      {
        ...config,
        llmProvider: "vertex_ai",
        fallbackLlmProvider: "vertex_ai",
        vertexAiConfig: { project: "p", location: "us-central1", model: "gemini-2.5-flash" },
        judgeRetries: 0,
      } as EvaluationConfig,
      { sleep: async () => undefined, random: () => 0, baseDelayMs: 1 }
    );
    (judge as any).callLLM = jest.fn(async () => body);
    return judge;
  }

  async function verdictFor(ok: string): Promise<LLMJudgeResult> {
    const body = `{"checks":{"rag_backed_content":{${ok}"evidence":"the answer cites the KB"}}}`;
    const [result] = await judgeReturning(body).judge("some answer", judgeConfig, checks as any);
    return result;
  }

  it.each([
    ["missing", ""],
    ["null", '"ok":null,'],
    ['"maybe"', '"ok":"maybe",'],
    ["numeric 1", '"ok":1,'],
    ["numeric 0", '"ok":0,'],
    ["an object", '"ok":{"value":true},'],
  ])("REGRESSION: ok %s is malformed_verdict → unscored, not passed:false", async (_label, ok) => {
    const result = await verdictFor(ok);
    expect(result.unscored).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.unscoredReason).toBe("malformed_verdict");
    expect(result.passed).toBe(false); // carries no verdict; excluded from scoring
    expect(resolveCaseUnscored({ llmJudgeResults: [result] })).toBe(true);
  });

  it.each([
    ['boolean true', '"ok":true,', true],
    ['boolean false', '"ok":false,', false],
    ['string "true"', '"ok":"true",', true],
    ['string "false"', '"ok":"false",', false],
  ])("renders a real verdict for ok %s", async (_label, ok, expected) => {
    const result = await verdictFor(ok as string);
    expect(result.unscored).toBeUndefined();
    expect(result.skipped).toBeUndefined();
    expect(result.passed).toBe(expected);
    expect(result.evidence).toBe("the answer cites the KB");
  });

  it("a rendered ok:false stays a genuine failure — the case is NOT laundered into unscored", async () => {
    const result = await verdictFor('"ok":false,');
    expect(
      resolveCaseUnscored({ llmJudgeResults: [result] }, new Set(["rag_backed_content"]))
    ).toBe(false);
  });
});
