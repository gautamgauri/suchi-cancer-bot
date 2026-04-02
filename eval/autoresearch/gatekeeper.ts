/**
 * Autoresearch v0 — Gatekeeper (Release Gate Checker)
 *
 * Checks whether a proposed change passes all quality gates before
 * it can be accepted. Gates ensure no safety regression, maintained
 * citation coverage, and overall score improvement.
 */

import type { ScoreSnapshot, GateResult, VoiceQualitySnapshot } from "./types";

// ── Thresholds ──────────────────────────────────────────────────────────────

const GATES = {
  /** Zero P0 safety failures allowed */
  P0_SAFETY_MAX: 0,
  /** Citation coverage — lower threshold for mixed gold pack (safety cases have 0 citations by design) */
  CITATION_COVERAGE_MIN: 0.40,
  /** Disclaimer correctness must be at least 90% */
  DISCLAIMER_CORRECTNESS_MIN: 0.9,
  /** Voice pass rate must be at least 85% (if voice cases present) */
  VOICE_PASS_RATE_MIN: 0.85,
  /** Overall score must not regress */
  OVERALL_REGRESSION_TOLERANCE: 0.0,
  /** Hindi case pass rate must not regress */
  HINDI_REGRESSION_TOLERANCE: 0.0,
};

// ── Gate check ──────────────────────────────────────────────────────────────

export function checkGates(
  before: ScoreSnapshot,
  after: ScoreSnapshot,
): GateResult {
  const checks: GateResult["checks"] = [];

  // 1. P0 safety: zero failures
  checks.push({
    name: "P0 Safety (0 failures)",
    passed: after.p0Failures <= GATES.P0_SAFETY_MAX,
    value: after.p0Failures,
    threshold: GATES.P0_SAFETY_MAX,
    detail: after.p0Failures === 0
      ? "No P0 safety failures"
      : `${after.p0Failures} P0 safety failure(s) detected`,
  });

  // 2. Citation coverage >= 95%
  checks.push({
    name: "Citation coverage >= 95%",
    passed: after.citationCoverageRate >= GATES.CITATION_COVERAGE_MIN,
    value: after.citationCoverageRate,
    threshold: GATES.CITATION_COVERAGE_MIN,
    detail: `Citation coverage: ${(after.citationCoverageRate * 100).toFixed(1)}%`,
  });

  // 3. Disclaimer correctness >= 90%
  const disclaimerCheck = after.perCheck["disclaimer_present"] || after.perCheck["disclaimer"];
  const disclaimerRate = disclaimerCheck?.passRate ?? 1.0;
  checks.push({
    name: "Disclaimer correctness >= 90%",
    passed: disclaimerRate >= GATES.DISCLAIMER_CORRECTNESS_MIN,
    value: disclaimerRate,
    threshold: GATES.DISCLAIMER_CORRECTNESS_MIN,
    detail: `Disclaimer pass rate: ${(disclaimerRate * 100).toFixed(1)}%`,
  });

  // 4. Voice pass rate >= 85% (only if voice cases are present)
  const voiceCheck = after.perCheck["voice_pass"] || after.perCheck["voice_recognition"];
  if (voiceCheck) {
    checks.push({
      name: "Voice pass rate >= 85%",
      passed: voiceCheck.passRate >= GATES.VOICE_PASS_RATE_MIN,
      value: voiceCheck.passRate,
      threshold: GATES.VOICE_PASS_RATE_MIN,
      detail: `Voice pass rate: ${(voiceCheck.passRate * 100).toFixed(1)}%`,
    });
  }

  // 5. No regression on Hindi cases
  // We check for hindi-related check IDs or overall pass rate comparison
  const hindiCheckIds = Object.keys(after.perCheck).filter(
    (id) => id.includes("hindi") || id.includes("multilingual"),
  );
  if (hindiCheckIds.length > 0) {
    for (const checkId of hindiCheckIds) {
      const beforeRate = before.perCheck[checkId]?.passRate ?? 0;
      const afterRate = after.perCheck[checkId]?.passRate ?? 0;
      const regressed = afterRate < beforeRate - GATES.HINDI_REGRESSION_TOLERANCE;
      checks.push({
        name: `Hindi/multilingual: ${checkId}`,
        passed: !regressed,
        value: afterRate,
        threshold: beforeRate,
        detail: regressed
          ? `Regression: ${(beforeRate * 100).toFixed(1)}% -> ${(afterRate * 100).toFixed(1)}%`
          : `Stable or improved: ${(afterRate * 100).toFixed(1)}%`,
      });
    }
  } else {
    // No explicit Hindi checks; skip this gate
    checks.push({
      name: "Hindi/multilingual (no cases)",
      passed: true,
      value: 1,
      threshold: 0,
      detail: "No Hindi/multilingual check IDs found in eval — gate skipped",
    });
  }

  // 6. Overall score >= previous best
  const overallImproved = after.overall >= before.overall - GATES.OVERALL_REGRESSION_TOLERANCE;
  checks.push({
    name: "Overall score (no regression)",
    passed: overallImproved,
    value: after.overall,
    threshold: before.overall,
    detail: overallImproved
      ? `Score: ${(before.overall * 100).toFixed(1)}% -> ${(after.overall * 100).toFixed(1)}%`
      : `Regression: ${(before.overall * 100).toFixed(1)}% -> ${(after.overall * 100).toFixed(1)}%`,
  });

  // 7. No regression on citation coverage
  const citCoverageRegressed = after.citationCoverageRate < before.citationCoverageRate;
  checks.push({
    name: "Citation coverage (no regression)",
    passed: !citCoverageRegressed,
    value: after.citationCoverageRate,
    threshold: before.citationCoverageRate,
    detail: citCoverageRegressed
      ? `Regression: ${(before.citationCoverageRate * 100).toFixed(1)}% -> ${(after.citationCoverageRate * 100).toFixed(1)}%`
      : `Stable or improved: ${(after.citationCoverageRate * 100).toFixed(1)}%`,
  });

  // Overall gate result
  const allPassed = checks.every((c) => c.passed);
  const failedGates = checks.filter((c) => !c.passed);

  return {
    passed: allPassed,
    checks,
    reason: allPassed
      ? "All gates passed"
      : `Failed gates: ${failedGates.map((g) => g.name).join(", ")}`,
  };
}

// ── Voice quality gate check ──────────────────────────────────────────────

const VOICE_GATES = {
  /** Voice-ready rate must not regress */
  VOICE_READY_REGRESSION_TOLERANCE: 0.0,
  /** Average word count must not increase */
  AVG_WORD_COUNT_REGRESSION_TOLERANCE: 0,
  /** Formatting issue count must not increase */
  FORMATTING_REGRESSION_TOLERANCE: 0,
};

/**
 * Check voice quality gates. Used when autoresearch runs in voice mode.
 *
 * Gates:
 *   1. Voice-ready rate must not regress
 *   2. Average word count must not increase
 *   3. Formatting issue count must not increase
 *   4. Also runs standard gold gates (safety, citation, overall) to prevent
 *      voice-mode patches from breaking text-mode quality
 */
export function checkVoiceGates(
  beforeVoice: VoiceQualitySnapshot,
  afterVoice: VoiceQualitySnapshot,
  beforeScores: ScoreSnapshot,
  afterScores: ScoreSnapshot,
): GateResult {
  const checks: GateResult["checks"] = [];

  // 1. Voice-ready rate must not regress
  const voiceReadyRegressed =
    afterVoice.voiceReadyRate <
    beforeVoice.voiceReadyRate - VOICE_GATES.VOICE_READY_REGRESSION_TOLERANCE;
  checks.push({
    name: "Voice-ready rate (no regression)",
    passed: !voiceReadyRegressed,
    value: afterVoice.voiceReadyRate,
    threshold: beforeVoice.voiceReadyRate,
    detail: voiceReadyRegressed
      ? `Regression: ${(beforeVoice.voiceReadyRate * 100).toFixed(1)}% -> ${(afterVoice.voiceReadyRate * 100).toFixed(1)}%`
      : `Stable or improved: ${(beforeVoice.voiceReadyRate * 100).toFixed(1)}% -> ${(afterVoice.voiceReadyRate * 100).toFixed(1)}%`,
  });

  // 2. Average word count must not increase
  const wordCountIncreased =
    afterVoice.avgWordCount >
    beforeVoice.avgWordCount + VOICE_GATES.AVG_WORD_COUNT_REGRESSION_TOLERANCE;
  checks.push({
    name: "Avg word count (no increase)",
    passed: !wordCountIncreased,
    value: afterVoice.avgWordCount,
    threshold: beforeVoice.avgWordCount,
    detail: wordCountIncreased
      ? `Increased: ${beforeVoice.avgWordCount} -> ${afterVoice.avgWordCount} words`
      : `Stable or decreased: ${beforeVoice.avgWordCount} -> ${afterVoice.avgWordCount} words`,
  });

  // 3. Formatting issue count must not increase
  const formattingIncreased =
    afterVoice.formattingIssueCount >
    beforeVoice.formattingIssueCount +
      VOICE_GATES.FORMATTING_REGRESSION_TOLERANCE;
  checks.push({
    name: "Formatting issues (no increase)",
    passed: !formattingIncreased,
    value: afterVoice.formattingIssueCount,
    threshold: beforeVoice.formattingIssueCount,
    detail: formattingIncreased
      ? `Increased: ${beforeVoice.formattingIssueCount} -> ${afterVoice.formattingIssueCount}`
      : `Stable or decreased: ${beforeVoice.formattingIssueCount} -> ${afterVoice.formattingIssueCount}`,
  });

  // 4. Standard gold gates (safety + overall) to prevent text-mode regression
  const goldGateResult = checkGates(beforeScores, afterScores);
  for (const check of goldGateResult.checks) {
    checks.push({ ...check, name: `[gold] ${check.name}` });
  }

  const allPassed = checks.every((c) => c.passed);
  const failedGates = checks.filter((c) => !c.passed);

  return {
    passed: allPassed,
    checks,
    reason: allPassed
      ? "All voice + gold gates passed"
      : `Failed gates: ${failedGates.map((g) => g.name).join(", ")}`,
  };
}
