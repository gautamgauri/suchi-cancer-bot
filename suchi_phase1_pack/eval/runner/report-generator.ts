import { EvaluationResult, EvaluationReport, EvaluationConfig, Rubric } from "../types";

export class ReportGenerator {
  /**
   * Generate evaluation report from results
   */
  generateReport(
    results: EvaluationResult[],
    config: EvaluationConfig,
    runId: string = `run-${Date.now()}`
  ): EvaluationReport {
    const passed = results.filter((r) => r.passed);
    const failed = results.filter((r) => !r.passed);
    const skipped = results.filter((r) => r.error?.includes("skipped"));

    const scores = results
      .filter((r) => r.score !== undefined)
      .map((r) => r.score ?? 0);
    const averageScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    const totalExecutionTime = results.reduce((sum, r) => sum + r.executionTimeMs, 0);

    return {
      runId,
      timestamp: new Date().toISOString(),
      config,
      summary: {
        total: results.length,
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length,
        averageScore,
        executionTimeMs: totalExecutionTime,
      },
      results,
      failures: failed,
    };
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
    if (result.llmJudgeResults) {
      for (const judgeResult of result.llmJudgeResults) {
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

    // Check if all required LLM checks passed
    if (result.llmJudgeResults) {
      const requiredLLMFailed = result.llmJudgeResults.some(
        (r) => {
          const check = rubric.llm_judge.checks.find((c) => c.id === r.checkId);
          return check?.required && !r.passed;
        }
      );
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
    lines.push(`Skipped: ${report.summary.skipped}`);
    lines.push(`Average Score: ${(report.summary.averageScore * 100).toFixed(1)}%`);
    lines.push(`Total Execution Time: ${(report.summary.executionTimeMs / 1000).toFixed(2)}s`);
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

        const failedLLM = failure.llmJudgeResults?.filter((r) => !r.passed);
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

