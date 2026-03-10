import * as fs from 'fs/promises';
import { VoiceEvaluationResult, VoiceEvalReport, VoiceEvalConfig } from '../types/voice';

/**
 * Generates JSON and text reports for voice E2E evaluation results.
 */
export class VoiceReportGenerator {
  /**
   * Generate a voice evaluation report.
   */
  generateReport(
    results: VoiceEvaluationResult[],
    config: VoiceEvalConfig,
    runId = `voice-run-${Date.now()}`,
  ): VoiceEvalReport {
    const passed = results.filter((r) => r.passed);
    const failed = results.filter((r) => !r.passed);

    const avgScores = {
      sttAccuracy: this.avg(results.map((r) => r.scores.sttAccuracy)),
      entityExtraction: this.avg(results.map((r) => r.scores.entityExtraction)),
      responseSafety: this.avg(results.map((r) => r.scores.responseSafety)),
      ttsQuality: this.avg(results.map((r) => r.scores.ttsQuality)),
      latency: this.avg(results.map((r) => r.scores.latency)),
    };

    const totalExecutionMs = results.reduce(
      (sum, r) => sum + r.executionTimeMs,
      0,
    );

    return {
      runId,
      timestamp: new Date().toISOString(),
      config: {
        transport: config.transport,
        synthetic: config.synthetic,
        apiBaseUrl: config.apiBaseUrl,
      },
      summary: {
        total: results.length,
        passed: passed.length,
        failed: failed.length,
        passRate: results.length > 0 ? passed.length / results.length : 0,
        averageScores: avgScores,
        executionTimeMs: totalExecutionMs,
      },
      results,
      failures: failed,
    };
  }

  /**
   * Generate a human-readable summary.
   */
  generateSummaryText(report: VoiceEvalReport): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('VOICE E2E EVALUATION REPORT');
    lines.push('='.repeat(60));
    lines.push(`Run ID: ${report.runId}`);
    lines.push(`Timestamp: ${report.timestamp}`);
    lines.push(`Transport: ${report.config.transport}`);
    lines.push(`Synthetic Audio: ${report.config.synthetic}`);
    lines.push('');
    lines.push('SUMMARY');
    lines.push('-'.repeat(60));
    lines.push(`Total: ${report.summary.total}`);
    lines.push(
      `Passed: ${report.summary.passed} (${(report.summary.passRate * 100).toFixed(1)}%)`,
    );
    lines.push(`Failed: ${report.summary.failed}`);
    lines.push(
      `Execution Time: ${(report.summary.executionTimeMs / 1000).toFixed(2)}s`,
    );
    lines.push('');
    lines.push('AVERAGE SCORES');
    lines.push('-'.repeat(60));
    lines.push(
      `STT Accuracy:       ${(report.summary.averageScores.sttAccuracy * 100).toFixed(1)}%`,
    );
    lines.push(
      `Entity Extraction:  ${(report.summary.averageScores.entityExtraction * 100).toFixed(1)}%`,
    );
    lines.push(
      `Response Safety:    ${(report.summary.averageScores.responseSafety * 100).toFixed(1)}%`,
    );
    lines.push(
      `TTS Quality:        ${(report.summary.averageScores.ttsQuality * 100).toFixed(1)}%`,
    );
    lines.push(
      `Latency:            ${(report.summary.averageScores.latency * 100).toFixed(1)}%`,
    );

    // Show all results with transcripts
    lines.push('');
    lines.push('RESULTS');
    lines.push('-'.repeat(60));
    for (const r of report.results) {
      const status = r.passed ? 'PASS' : 'FAIL';
      lines.push(
        `  ${r.testCaseId} [${r.transport}] (${r.variant}) — ${status}`,
      );
      if (r.details?.transcript) {
        const t = r.details.transcript.length > 80
          ? r.details.transcript.slice(0, 80) + '...'
          : r.details.transcript;
        lines.push(`    Transcript: "${t}"`);
        lines.push(`    Confidence: ${(r.details.confidence * 100).toFixed(1)}%`);
      }
      if (r.details?.responseText) {
        const resp = r.details.responseText.length > 120
          ? r.details.responseText.slice(0, 120) + '...'
          : r.details.responseText;
        lines.push(`    Response: "${resp}"`);
      }
      lines.push(
        `    STT=${r.scores.sttAccuracy.toFixed(2)} Entity=${r.scores.entityExtraction} Safety=${r.scores.responseSafety} TTS=${r.scores.ttsQuality} Latency=${r.scores.latency}`,
      );
      if (r.errors) {
        lines.push(`    Errors: ${r.errors.join(', ')}`);
      }
    }

    lines.push('');
    lines.push('='.repeat(60));

    // Suite pass determination (≥5/6 cases pass)
    const suitePass = report.summary.passed >= 5;
    lines.push(
      `\nSUITE RESULT: ${suitePass ? 'PASS' : 'FAIL'} (${report.summary.passed}/${report.summary.total} cases, threshold: 5/6)`,
    );

    return lines.join('\n');
  }

  /**
   * Export report to JSON file.
   */
  async exportToFile(
    report: VoiceEvalReport,
    filePath: string,
  ): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8');
  }

  private avg(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}
