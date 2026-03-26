/**
 * Autoresearch v0 — Archivist (Experiment Logger)
 *
 * Saves experiment logs to disk for auditing and analysis.
 * Each experiment gets a JSON file in the experiments/ directory.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExperimentLog } from "./types";

const EXPERIMENTS_DIR = path.resolve(__dirname, "experiments");

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a unique experiment ID.
 */
export function generateExperimentId(iteration: number): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const seq = String(iteration).padStart(3, "0");
  return `exp-${date}-${seq}`;
}

/**
 * Save an experiment log to disk.
 */
export async function saveExperiment(log: ExperimentLog): Promise<string> {
  await fs.mkdir(EXPERIMENTS_DIR, { recursive: true });
  const filePath = path.join(EXPERIMENTS_DIR, `${log.experimentId}.json`);
  await fs.writeFile(filePath, JSON.stringify(log, null, 2), "utf-8");
  return filePath;
}

/**
 * Load an experiment log from disk.
 */
export async function loadExperiment(experimentId: string): Promise<ExperimentLog> {
  const filePath = path.join(EXPERIMENTS_DIR, `${experimentId}.json`);
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as ExperimentLog;
}

/**
 * List all experiment logs, sorted by timestamp descending.
 */
export async function listExperiments(): Promise<ExperimentLog[]> {
  await fs.mkdir(EXPERIMENTS_DIR, { recursive: true });

  const files = await fs.readdir(EXPERIMENTS_DIR);
  const logs: ExperimentLog[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(EXPERIMENTS_DIR, file), "utf-8");
      logs.push(JSON.parse(raw) as ExperimentLog);
    } catch {
      // Skip malformed files
    }
  }

  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Print a human-readable summary of an experiment.
 */
export function formatExperimentSummary(log: ExperimentLog): string {
  const lines: string[] = [];

  lines.push(`=== Experiment: ${log.experimentId} ===`);
  lines.push(`Timestamp: ${log.timestamp}`);
  lines.push(`Iteration: ${log.iteration}`);
  lines.push(`Decision: ${log.decision.toUpperCase()}`);
  lines.push(`Reason: ${log.reason}`);
  lines.push("");

  lines.push(`Failure cluster: ${log.failureCluster.failureType} [${log.failureCluster.severity}]`);
  lines.push(`  Affected cases: ${log.failureCluster.affectedCaseIds.length}`);
  lines.push(`  Failed checks: ${log.failureCluster.failedCheckIds.join(", ")}`);
  lines.push("");

  lines.push(`Hypothesis: ${log.hypothesis.label}`);
  lines.push(`  Root cause: ${log.hypothesis.rootCause}`);
  lines.push(`  Confidence: ${(log.hypothesis.confidence * 100).toFixed(0)}%`);
  lines.push(`  Risk: ${log.hypothesis.risk}`);
  lines.push(`  File: ${log.repairableFile}`);
  lines.push("");

  lines.push(`Before scores:`);
  lines.push(`  Overall: ${(log.beforeScores.overall * 100).toFixed(1)}%`);
  lines.push(`  Pass rate: ${(log.beforeScores.passRate * 100).toFixed(1)}%`);
  lines.push(`  P0 failures: ${log.beforeScores.p0Failures}`);
  lines.push(`  Citation coverage: ${(log.beforeScores.citationCoverageRate * 100).toFixed(1)}%`);

  if (log.afterScores) {
    lines.push("");
    lines.push(`After scores:`);
    lines.push(`  Overall: ${(log.afterScores.overall * 100).toFixed(1)}%`);
    lines.push(`  Pass rate: ${(log.afterScores.passRate * 100).toFixed(1)}%`);
    lines.push(`  P0 failures: ${log.afterScores.p0Failures}`);
    lines.push(`  Citation coverage: ${(log.afterScores.citationCoverageRate * 100).toFixed(1)}%`);

    const delta = log.afterScores.overall - log.beforeScores.overall;
    const sign = delta >= 0 ? "+" : "";
    lines.push(`  Delta: ${sign}${(delta * 100).toFixed(1)}pp`);
  }

  if (log.gateResult) {
    lines.push("");
    lines.push(`Gate result: ${log.gateResult.passed ? "PASS" : "FAIL"}`);
    for (const check of log.gateResult.checks) {
      const icon = check.passed ? "[OK]" : "[FAIL]";
      lines.push(`  ${icon} ${check.name}: ${check.detail}`);
    }
  }

  lines.push("");
  lines.push(`Branch: ${log.branch}`);
  lines.push(`Duration: ${(log.durationMs / 1000).toFixed(1)}s`);

  if (log.patchDiff) {
    lines.push("");
    lines.push(`Diff preview (first 500 chars):`);
    lines.push(log.patchDiff.slice(0, 500));
  }

  return lines.join("\n");
}
