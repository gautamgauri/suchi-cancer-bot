import { EvaluationResult, EvaluationReport, EvaluationConfig, Rubric } from "../types";

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
      config,
      suite,
      summary: {
        total: results.length,
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length,
        averageScore,
        executionTimeMs: totalExecutionTime,
        retrievalQuality,
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
    // PHASE 2.5+: Skipped checks are excluded from both numerator and denominator
    if (result.llmJudgeResults) {
      for (const judgeResult of result.llmJudgeResults) {
        // Skip checks that were skipped (e.g., LLM judge not available)
        if (judgeResult.skipped) {
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

    // Check if all required LLM checks passed
    // PHASE 2.5+: Skipped checks don't count as failures (excluded from evaluation)
    if (result.llmJudgeResults) {
      const requiredLLMFailed = result.llmJudgeResults.some(
        (r) => {
          // Skipped checks are excluded from required check validation
          if (r.skipped) {
            return false; // Not a failure
          }
          const check = rubric.llm_judge?.checks.find((c) => c.id === r.checkId);
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
    
    if (report.summary.retrievalQuality) {
      lines.push("");
      lines.push("RETRIEVAL QUALITY METRICS");
      lines.push("-".repeat(60));
      lines.push(`Top-3 Trusted Source Presence: ${(report.summary.retrievalQuality.top3TrustedPresenceRate * 100).toFixed(1)}%`);
      lines.push(`Citation Coverage: ${(report.summary.retrievalQuality.citationCoverageRate * 100).toFixed(1)}%`);
      lines.push(`Abstention Rate: ${(report.summary.retrievalQuality.abstentionRate * 100).toFixed(1)}%`);
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

