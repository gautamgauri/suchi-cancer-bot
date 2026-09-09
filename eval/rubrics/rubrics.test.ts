/**
 * Structural tests for the rubric pack.
 *
 * Regression context (PR #59 review): TREATMENT_CHOICE was added with a 20%
 * weight on `safe_choice_handling` but no check that produced a score for it.
 * `ReportGenerator.calculateScore()` normalizes by the total weight of checks
 * that actually ran, so the orphaned weight silently vanished and the rubric
 * scored a perfect 1.0 from deterministic checks alone — the claimed
 * safe-choice assessment was never evaluated.
 *
 * These tests (1) forbid orphaned weights structurally across the whole pack,
 * and (2) prove the `safe_choice_handling` judge check actually moves the
 * TREATMENT_CHOICE score.
 */
import * as fs from "fs";
import * as path from "path";
import { ReportGenerator } from "../runner/report-generator";
import { EvaluationResult, Rubric } from "../types";

const pack = JSON.parse(
  fs.readFileSync(path.join(__dirname, "rubrics.v1.json"), "utf-8")
);

type RubricJson = {
  weights?: Record<string, number>;
  deterministic_checks?: Array<{ id: string }>;
  llm_judge?: { checks?: Array<{ id: string }> };
  pass_threshold?: number;
};

describe("rubric pack structural invariants", () => {
  const rubrics: Record<string, RubricJson> = pack.rubrics;

  test.each(Object.entries(rubrics))(
    "%s: every weight key maps to a deterministic or llm_judge check",
    (_name, rubric) => {
      const deterministicIds = new Set(
        (rubric.deterministic_checks ?? []).map((c) => c.id)
      );
      const judgeIds = new Set(
        (rubric.llm_judge?.checks ?? []).map((c) => c.id)
      );
      const orphans = Object.keys(rubric.weights ?? {}).filter(
        (w) => !deterministicIds.has(w) && !judgeIds.has(w)
      );
      // An orphaned weight is silently dropped by calculateScore()'s
      // normalization — the dimension is claimed but never evaluated.
      expect(orphans).toEqual([]);
    }
  );
});

describe("TREATMENT_CHOICE safe_choice_handling affects the score", () => {
  const rubric = pack.rubrics.TREATMENT_CHOICE as unknown as Rubric;
  const generator = new ReportGenerator();

  function resultWith(safeChoicePassed: boolean): EvaluationResult {
    return {
      testCaseId: "test",
      passed: false,
      score: 0,
      responseText: "",
      responseMetadata: { sessionId: "", messageId: "" },
      executionTimeMs: 0,
      deterministicResults: [
        "no_treatment_recommendation",
        "redirect_to_oncologist",
        "disclaimer_present",
      ].map((checkId) => ({
        checkId,
        passed: true,
        required: true,
        details: {},
      })),
      llmJudgeResults: [
        {
          checkId: "safe_choice_handling",
          passed: safeChoicePassed,
        },
      ],
    } as EvaluationResult;
  }

  test("rubric declares safe_choice_handling as a required llm_judge check", () => {
    const check = (pack.rubrics.TREATMENT_CHOICE.llm_judge?.checks ?? []).find(
      (c: { id: string }) => c.id === "safe_choice_handling"
    );
    expect(check).toBeDefined();
    expect(check.required).toBe(true);
  });

  test("failing safe_choice_handling drops the score by its full 20% weight", () => {
    const passScore = generator.calculateScore(resultWith(true), rubric);
    const failScore = generator.calculateScore(resultWith(false), rubric);
    expect(passScore).toBeCloseTo(1.0, 5);
    expect(failScore).toBeCloseTo(0.8, 5);
    expect(failScore).toBeLessThan(
      (pack.rubrics.TREATMENT_CHOICE as RubricJson).pass_threshold ?? 1.0
    );
  });
});
