import { EvaluationResult, EvaluationReport, EvaluationConfig, Rubric, LLMJudgeResult } from "../types";
import { isUnscored, resolveCaseUnscored, summarizeUnscoredReasons } from "./judge-errors";

/**
 * Reports are uploaded as CI artifacts (eval-tier1.yml) and committed to the
 * repo — never embed live credentials in them.
 */
function redactConfigSecrets(config: EvaluationConfig): EvaluationConfig {
  const redacted: EvaluationConfig = JSON.parse(JSON.stringify(config));
  if (redacted.deepseekConfig?.apiKey) redacted.deepseekConfig.apiKey = "REDACTED";
  if (redacted.openAiConfig?.apiKey) redacted.openAiConfig.apiKey = "REDACTED";
  if ((redacted as any).authBearer) (redacted as any).authBearer = "REDACTED";
  return redacted;
}

export class ReportGenerator {
  /**
   * Generate evaluation report from results
   * 
   * ✅ NEW: Includes suite metadata to prevent "empty but successful" reports
   */
  generateReport(
    results: EvaluationResult[],
    config: EvaluationConfig,
    runId: string = `run-${Date.now()}`,
    suiteMetadata?: {
      loadedCount: number;
      selectedCount: number;
    }
  ): EvaluationReport {
    // Three mutually exclusive buckets (issue #110): passed / failed / unscored.
    // An unscored case had at least one judge check with no verdict; it is a
    // statement about the judge, not about the answer, so it never counts as
    // a failure — and never counts as a pass either.
    const passed = results.filter((r) => r.passed);
    const unscored = results.filter((r) => !r.passed && this.determineUnscored(r));
    const failed = results.filter((r) => !r.passed && !this.determineUnscored(r));
    const skipped = results.filter((r) => r.error?.includes("skipped"));
    const judge = this.summarizeJudge(results);

    const scores = results
      .filter((r) => r.score !== undefined)
      .map((r) => r.score ?? 0);
    const averageScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    const totalExecutionTime = results.reduce((sum, r) => sum + r.executionTimeMs, 0);

    // Calculate retrieval quality metrics
    const resultsWithQuality = results.filter(r => r.retrievalQuality);
    const top3TrustedCount = resultsWithQuality.filter(r => r.retrievalQuality?.top3TrustedPresence).length;
    const citationCoverageCount = resultsWithQuality.filter(r => (r.retrievalQuality?.citationCoverage || 0) > 0).length;
    const abstentionCount = resultsWithQuality.filter(r => r.retrievalQuality?.hasAbstention).length;
    
    const retrievalQuality = resultsWithQuality.length > 0 ? {
      top3TrustedPresenceRate: top3TrustedCount / resultsWithQuality.length,
      citationCoverageRate: citationCoverageCount / resultsWithQuality.length,
      abstentionRate: abstentionCount / resultsWithQuality.length,
    } : undefined;

    // Citation integrity — separate axis from safety/style/quality (issue #48)
    const withIntegrity = results.filter((r) => r.citationIntegrity?.applicable);
    const clusterCounts: Record<string, number> = {};
    for (const r of results) {
      for (const cluster of r.failureClusters || []) {
        clusterCounts[cluster] = (clusterCounts[cluster] || 0) + 1;
      }
    }
    const citationIntegrity = withIntegrity.length > 0 ? {
      applicableCases: withIntegrity.length,
      evidenceRequiredCases: withIntegrity.filter((r) => r.citationIntegrity!.evidenceRequired).length,
      averageIntegrityScore:
        withIntegrity.reduce((s, r) => s + r.citationIntegrity!.score, 0) / withIntegrity.length,
      fabricatedCitationCases: withIntegrity.filter(
        (r) => r.citationIntegrity!.unresolvedCitationCount > 0
      ).length,
      zeroSupportEvidenceCases: withIntegrity.filter(
        (r) =>
          r.citationIntegrity!.evidenceRequired &&
          r.citationIntegrity!.supportingCitationCount === 0
      ).length,
      retrievalMissCases: withIntegrity.filter(
        (r) => r.citationIntegrity!.evidenceRequired && r.citationIntegrity!.retrievedCount === 0
      ).length,
      clusterCounts,
    } : undefined;

    // ✅ NEW: Suite metadata with status validation
    const executedCount = results.length;
    const suite = suiteMetadata ? {
      loadedCount: suiteMetadata.loadedCount,
      selectedCount: suiteMetadata.selectedCount,
      executedCount,
      status: executedCount === 0 ? 'INVALID' as const : 'VALID' as const,
    } : undefined;

    return {
      runId,
      timestamp: new Date().toISOString(),
      config: redactConfigSecrets(config),
      suite,
      summary: {
        total: results.length,
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length,
        unscored: unscored.length,
        averageScore,
        executionTimeMs: totalExecutionTime,
        retrievalQuality,
        citationIntegrity,
        judge,
      },
      results,
      failures: failed,
    };
  }

  /**
   * A case is unscored when its failure rests entirely on judge checks that
   * rendered no verdict (issue #110). Rendered evidence outranks a missing
   * verdict — see resolveCaseUnscored() — so a case that failed a required
   * deterministic check, or a required judge check that really did answer
   * "ok: false", stays a genuine failure even if another check went unscored.
   *
   * The evaluator has the rubric and records its decision on `result.unscored`;
   * that decision is authoritative here. `rubric` is only needed when
   * classifying results that did not come from this process (a report read
   * back from disk, a merged run).
   */
  determineUnscored(result: EvaluationResult, rubric?: Rubric): boolean {
    return resolveCaseUnscored(result, requiredLlmCheckIds(rubric));
  }

  /**
   * Judge-availability summary for the run — an infrastructure axis, not a
   * quality one. NOTE `unscoredCases` here counts every case the judge left
   * with >=1 verdict missing, which is a superset of `summary.unscored` (the
   * outcome bucket): a case can carry an unscored check and still be a real
   * failure on the checks that did render. CI thresholds the availability
   * number; the outcome bucket is what never counts as a failure.
   */
  summarizeJudge(results: EvaluationResult[]): EvaluationReport["summary"]["judge"] {
    const all: LLMJudgeResult[] = results.flatMap((r) => r.llmJudgeResults ?? []);
    const unscoredChecks = all.filter(isUnscored);
    const unscoredCaseIds = results
      .filter((r) => (r.llmJudgeResults ?? []).some(isUnscored))
      .map((r) => r.testCaseId);
    const reasons: Record<string, number> = {};
    for (const r of unscoredChecks) {
      const label = r.error?.split(":")[0]?.trim() || r.unscoredReason || "unavailable";
      reasons[label] = (reasons[label] ?? 0) + 1;
    }
    const status: NonNullable<EvaluationReport["summary"]["judge"]>["status"] =
      all.length === 0
        ? "not_run"
        : unscoredChecks.length === 0
          ? "active"
          : unscoredChecks.length === all.length
            ? "unavailable"
            : "degraded";
    return {
      status,
      scoredChecks: all.length - unscoredChecks.length,
      unscoredChecks: unscoredChecks.length,
      unscoredCases: unscoredCaseIds.length,
      unscoredCaseIds,
      reasons,
    };
  }

  /** Human-readable reason for an unscored case, e.g. "rate_limited (HTTP 429) ×6". */
  unscoredReasonFor(result: EvaluationResult): string | undefined {
    return summarizeUnscoredReasons(result.llmJudgeResults);
  }

  /**
   * Calculate score for a result based on rubric weights
   */
  calculateScore(result: EvaluationResult, rubric: Rubric): number {
    const weights = rubric.weights;
    let totalWeight = 0;
    let weightedScore = 0;

    // Process deterministic checks
    for (const checkResult of result.deterministicResults) {
      const weight = weights[checkResult.checkId] || 0;
      if (weight > 0) {
        totalWeight += weight;
        weightedScore += weight * (checkResult.passed ? 1.0 : 0.0);
      }
    }

    // Process LLM judge results
    // Unscored checks (no verdict) are excluded from numerator AND denominator:
    // the score is "over the checks that rendered a verdict". On its own that
    // would inflate a broken judge into a higher score (#74) — which is why
    // determinePass() refuses to pass a case with any unscored check and the
    // report counts such cases separately (issue #110).
    if (result.llmJudgeResults) {
      for (const judgeResult of result.llmJudgeResults) {
        if (isUnscored(judgeResult)) {
          continue; // Excluded from scoring entirely
        }
        const weight = weights[judgeResult.checkId] || 0;
        if (weight > 0) {
          totalWeight += weight;
          const score = judgeResult.score !== undefined
            ? judgeResult.score
            : judgeResult.passed
            ? 1.0
            : 0.0;
          weightedScore += weight * score;
        }
      }
    }

    return totalWeight > 0 ? weightedScore / totalWeight : 0.0;
  }

  /**
   * Determine if result passes based on rubric threshold
   */
  determinePass(result: EvaluationResult, rubric: Rubric): boolean {
    // Check if all required deterministic checks passed
    const requiredDeterministicFailed = result.deterministicResults.some(
      (r) => r.required && !r.passed
    );
    if (requiredDeterministicFailed) {
      return false;
    }

    // Issue #110: a case whose judge rendered no verdict cannot be declared a
    // pass — the rubric was not fully evaluated. It is not a failure either;
    // generateReport() files it under `unscored`. (Pre-#110 this returned
    // "not a failure" for skipped checks and let the case pass on the
    // remaining checks — the fail-open inflation #74 measured.)
    if (result.llmJudgeResults?.some(isUnscored)) {
      return false;
    }

    // Check if all required LLM checks passed
    if (result.llmJudgeResults) {
      const requiredLLMFailed = result.llmJudgeResults.some((r) => {
        const check = rubric.llm_judge?.checks.find((c) => c.id === r.checkId);
        return check?.required && !r.passed;
      });
      if (requiredLLMFailed) {
        return false;
      }
    }

    // Check score threshold
    const score = this.calculateScore(result, rubric);
    return score >= rubric.pass_threshold;
  }

  /**
   * Generate summary text report
   */
  generateSummaryText(report: EvaluationReport): string {
    const lines: string[] = [];
    
    lines.push("=".repeat(60));
    lines.push("EVALUATION REPORT");
    lines.push("=".repeat(60));
    lines.push(`Run ID: ${report.runId}`);
    lines.push(`Timestamp: ${report.timestamp}`);
    lines.push("");
    lines.push("SUMMARY");
    lines.push("-".repeat(60));
    lines.push(`Total Tests: ${report.summary.total}`);
    lines.push(`Passed: ${report.summary.passed} (${((report.summary.passed / report.summary.total) * 100).toFixed(1)}%)`);
    lines.push(`Failed: ${report.summary.failed} (${((report.summary.failed / report.summary.total) * 100).toFixed(1)}%)`);
    const unscoredCount = report.summary.unscored ?? 0;
    if (unscoredCount > 0) {
      lines.push(`Unscored (judge unavailable): ${unscoredCount} (${((unscoredCount / report.summary.total) * 100).toFixed(1)}%) — not counted as failures`);
    }
    lines.push(`Skipped: ${report.summary.skipped}`);
    lines.push(`Average Score: ${(report.summary.averageScore * 100).toFixed(1)}%`);
    lines.push(`Total Execution Time: ${(report.summary.executionTimeMs / 1000).toFixed(2)}s`);
    
    if (report.summary.retrievalQuality) {
      lines.push("");
      lines.push("RETRIEVAL QUALITY METRICS");
      lines.push("-".repeat(60));
      lines.push(`Top-3 Trusted Source Presence: ${(report.summary.retrievalQuality.top3TrustedPresenceRate * 100).toFixed(1)}%`);
      lines.push(`Citation Coverage: ${(report.summary.retrievalQuality.citationCoverageRate * 100).toFixed(1)}%`);
      lines.push(`Abstention Rate: ${(report.summary.retrievalQuality.abstentionRate * 100).toFixed(1)}%`);
    }

    // Citation integrity — reported separately from safety/style/quality
    if (report.summary.citationIntegrity) {
      const ci = report.summary.citationIntegrity;
      lines.push("");
      lines.push("CITATION INTEGRITY (separate axis)");
      lines.push("-".repeat(60));
      lines.push(`Average Integrity Score: ${(ci.averageIntegrityScore * 100).toFixed(1)}%`);
      lines.push(`Evidence-Required Cases: ${ci.evidenceRequiredCases}/${ci.applicableCases}`);
      lines.push(`Fabricated/Unresolvable Citation Cases: ${ci.fabricatedCitationCases}`);
      lines.push(`Zero-Support Evidence Cases: ${ci.zeroSupportEvidenceCases}`);
      lines.push(`Retrieval-Miss Cases: ${ci.retrievalMissCases}`);
      const clusters = Object.entries(ci.clusterCounts);
      if (clusters.length > 0) {
        lines.push(`Failure Clusters: ${clusters.map(([k, v]) => `${k}=${v}`).join(", ")}`);
      }
    }

    // LLM Judge status summary (infrastructure axis — issue #110)
    const allLlmResults = report.results.flatMap(r => r.llmJudgeResults || []);
    if (allLlmResults.length > 0) {
      const unscoredResults = allLlmResults.filter(isUnscored);
      const passedResults = allLlmResults.filter(r => r.passed && !isUnscored(r));
      const failedResults = allLlmResults.filter(r => !r.passed && !isUnscored(r));
      const judge = report.summary.judge ?? this.summarizeJudge(report.results);

      lines.push("");
      lines.push("LLM JUDGE STATUS");
      lines.push("-".repeat(60));

      if (unscoredResults.length === allLlmResults.length) {
        lines.push(`Status: UNAVAILABLE — no check received a verdict`);
        lines.push(`Checks unscored: ${unscoredResults.length}`);
      } else if (unscoredResults.length > 0) {
        lines.push(`Status: DEGRADED`);
        lines.push(`Passed: ${passedResults.length}, Failed: ${failedResults.length}, Unscored: ${unscoredResults.length}`);
      } else {
        lines.push(`Status: ACTIVE`);
        lines.push(`Passed: ${passedResults.length}, Failed: ${failedResults.length}`);
      }
      if (judge && judge.unscoredChecks > 0) {
        const reasons = Object.entries(judge.reasons).map(([k, v]) => `${k}=${v}`).join(", ");
        lines.push(`Unscored reasons: ${reasons}`);
        lines.push(`Unscored cases (${judge.unscoredCases}): ${judge.unscoredCaseIds.join(", ")}`);
      }
    }

    // Unscored cases are listed on their own — they are NOT failures
    const unscoredCases = report.results.filter((r) => this.determineUnscored(r));
    if (unscoredCases.length > 0) {
      lines.push("");
      lines.push("UNSCORED CASES (judge unavailable — not quality failures)");
      lines.push("-".repeat(60));
      for (const c of unscoredCases) {
        lines.push(`  ${c.testCaseId}: ${c.unscoredReason ?? this.unscoredReasonFor(c) ?? "judge rendered no verdict"}`);
      }
    }

    lines.push("");

    if (report.failures.length > 0) {
      lines.push("FAILURES");
      lines.push("-".repeat(60));
      for (const failure of report.failures) {
        lines.push(`\n${failure.testCaseId}:`);
        lines.push(`  Score: ${((failure.score || 0) * 100).toFixed(1)}%`);
        
        const failedDeterministic = failure.deterministicResults.filter((r) => !r.passed && r.required);
        if (failedDeterministic.length > 0) {
          lines.push(`  Failed Deterministic Checks:`);
          for (const check of failedDeterministic) {
            lines.push(`    - ${check.checkId}: ${check.error || "Failed"}`);
          }
        }

        const failedLLM = failure.llmJudgeResults?.filter((r) => !r.passed && !isUnscored(r));
        if (failedLLM && failedLLM.length > 0) {
          lines.push(`  Failed LLM Checks:`);
          for (const check of failedLLM) {
            lines.push(`    - ${check.checkId}: ${check.error || "Failed"}`);
          }
        }

        if (failure.error) {
          lines.push(`  Error: ${failure.error}`);
        }
      }
      lines.push("");
    }

    lines.push("=".repeat(60));
    
    return lines.join("\n");
  }

  /**
   * Export report to JSON file
   */
  async exportToFile(report: EvaluationReport, filePath: string): Promise<void> {
    const fs = await import("fs/promises");
    await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");
  }
}

/** Ids of the rubric's *required* LLM-judge checks, for outcome precedence. */
function requiredLlmCheckIds(rubric?: Rubric): ReadonlySet<string> | undefined {
  if (!rubric?.llm_judge?.checks) return undefined;
  return new Set(rubric.llm_judge.checks.filter((c) => c.required).map((c) => c.id));
}
