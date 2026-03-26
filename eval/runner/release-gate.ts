/**
 * Release Gate — Pre-deployment quality check for Suchi Cancer Bot
 *
 * Runs the gold eval pack (all 4 sets) and checks quality thresholds.
 * Blocks deployment if any hard gate fails or thresholds are not met.
 *
 * Usage:
 *   eval release-gate [--api-url <url>] [--save-baseline] [--output <path>]
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Evaluator } from "./evaluator";
import { ReportGenerator } from "./report-generator";
import { loadConfig } from "../config/loader";
import {
  TestCase,
  EvaluationResult,
  EvaluationReport,
  EvaluationConfig,
  RubricPack,
} from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GateThresholds {
  gates: Record<string, GateDefinition>;
  regression: {
    max_regression_pct: number;
  };
}

export interface GateDefinition {
  description: string;
  metric: string;
  operator: string;
  threshold: number;
  hard_gate: boolean;
}

export interface GateResult {
  gate: string;
  description: string;
  threshold: string; // human-readable threshold string
  actual: string; // human-readable actual value
  passed: boolean;
  hard_gate: boolean;
}

export interface ReleaseGateReport {
  timestamp: string;
  apiBaseUrl: string;
  gates: GateResult[];
  regression: {
    checked: boolean;
    baselinePath?: string;
    regressions: Array<{
      metric: string;
      baseline: number;
      current: number;
      delta_pct: number;
    }>;
    passed: boolean;
  };
  verdict: "DEPLOY" | "BLOCK";
  scores: ReleaseScores;
  evalReport: EvaluationReport;
}

export interface ReleaseScores {
  p0_failure_count: number;
  p0_total: number;
  citation_coverage_rate: number;
  disclaimer_pass_rate: number;
  language_voice_pass_rate: number;
  overall_pass_rate: number;
  per_set: Record<string, { passed: number; total: number; rate: number }>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EVAL_ROOT = path.resolve(__dirname, "..");
const GOLD_DIR = path.join(EVAL_ROOT, "cases", "gold");
const MANIFEST_PATH = path.join(GOLD_DIR, "manifest.json");
const THRESHOLDS_PATH = path.join(
  EVAL_ROOT,
  "autoresearch",
  "config",
  "gate-thresholds.json"
);
const BASELINE_PATH = path.join(
  EVAL_ROOT,
  "autoresearch",
  "baselines",
  "latest.json"
);
const DEFAULT_RUBRICS = path.join(EVAL_ROOT, "rubrics", "rubrics.v1.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadThresholds(): Promise<GateThresholds> {
  const raw = await fs.readFile(THRESHOLDS_PATH, "utf-8");
  return JSON.parse(raw);
}

async function loadBaseline(): Promise<ReleaseScores | null> {
  try {
    const raw = await fs.readFile(BASELINE_PATH, "utf-8");
    return JSON.parse(raw) as ReleaseScores;
  } catch {
    return null;
  }
}

async function saveBaseline(scores: ReleaseScores): Promise<void> {
  await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true });
  await fs.writeFile(BASELINE_PATH, JSON.stringify(scores, null, 2), "utf-8");
}

/**
 * Load all gold eval test cases from all 4 set YAML files.
 */
async function loadGoldTestCases(): Promise<{
  allCases: TestCase[];
  casesBySet: Record<string, TestCase[]>;
}> {
  const manifestRaw = await fs.readFile(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(manifestRaw);

  const casesBySet: Record<string, TestCase[]> = {};
  const allCases: TestCase[] = [];

  for (const [setName, setInfo] of Object.entries(manifest.sets) as Array<
    [string, { file: string }]
  >) {
    const filePath = path.join(GOLD_DIR, setInfo.file);
    const cases = await Evaluator.loadTestCases(filePath);
    casesBySet[setName] = cases;
    allCases.push(...cases);
  }

  return { allCases, casesBySet };
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

function computeScores(
  results: EvaluationResult[],
  casesBySet: Record<string, TestCase[]>,
  resultsBySet: Record<string, EvaluationResult[]>
): ReleaseScores {
  // P0 failures: cases with risk=P0 that failed
  // We identify P0 cases by matching test case IDs against the core_safety set
  const safetyCases = casesBySet["core_safety"] || [];
  const safetyCaseIds = new Set(safetyCases.map((c) => c.id));
  const safetyResults = results.filter((r) => safetyCaseIds.has(r.testCaseId));
  const p0Failures = safetyResults.filter((r) => !r.passed).length;

  // Citation coverage: percentage of retrieval_grounding cases that have citations
  const retrievalResults = resultsBySet["retrieval_grounding"] || [];
  const casesWithCitations = retrievalResults.filter(
    (r) => (r.responseMetadata.citations?.length || 0) > 0
  );
  const citationCoverageRate =
    retrievalResults.length > 0
      ? casesWithCitations.length / retrievalResults.length
      : 0;

  // Disclaimer pass rate: check deterministic 'disclaimer_present' check across all results
  const casesWithDisclaimerCheck = results.filter((r) =>
    r.deterministicResults.some((d) => d.checkId === "disclaimer_present")
  );
  const disclaimerPassed = casesWithDisclaimerCheck.filter((r) =>
    r.deterministicResults.some(
      (d) => d.checkId === "disclaimer_present" && d.passed
    )
  );
  const disclaimerPassRate =
    casesWithDisclaimerCheck.length > 0
      ? disclaimerPassed.length / casesWithDisclaimerCheck.length
      : 1.0; // If no cases check disclaimers, treat as passing

  // Language/voice pass rate
  const languageResults = resultsBySet["language_voice"] || [];
  const languagePassed = languageResults.filter((r) => r.passed).length;
  const languageVoicePassRate =
    languageResults.length > 0 ? languagePassed / languageResults.length : 0;

  // Overall pass rate
  const overallPassed = results.filter((r) => r.passed).length;
  const overallPassRate =
    results.length > 0 ? overallPassed / results.length : 0;

  // Per-set breakdown
  const perSet: Record<
    string,
    { passed: number; total: number; rate: number }
  > = {};
  for (const [setName, setResults] of Object.entries(resultsBySet)) {
    const passed = setResults.filter((r) => r.passed).length;
    perSet[setName] = {
      passed,
      total: setResults.length,
      rate: setResults.length > 0 ? passed / setResults.length : 0,
    };
  }

  return {
    p0_failure_count: p0Failures,
    p0_total: safetyResults.length,
    citation_coverage_rate: citationCoverageRate,
    disclaimer_pass_rate: disclaimerPassRate,
    language_voice_pass_rate: languageVoicePassRate,
    overall_pass_rate: overallPassRate,
    per_set: perSet,
  };
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

function evaluateGates(
  scores: ReleaseScores,
  thresholds: GateThresholds
): GateResult[] {
  const results: GateResult[] = [];

  for (const [gateId, gate] of Object.entries(thresholds.gates)) {
    const metricValue = (scores as any)[gate.metric];
    if (metricValue === undefined) {
      results.push({
        gate: gateId,
        description: gate.description,
        threshold: `${gate.operator} ${gate.threshold}`,
        actual: "N/A",
        passed: false,
        hard_gate: gate.hard_gate,
      });
      continue;
    }

    let passed = false;
    switch (gate.operator) {
      case "==":
        passed = metricValue === gate.threshold;
        break;
      case ">=":
        passed = metricValue >= gate.threshold;
        break;
      case "<=":
        passed = metricValue <= gate.threshold;
        break;
      case ">":
        passed = metricValue > gate.threshold;
        break;
      case "<":
        passed = metricValue < gate.threshold;
        break;
      default:
        passed = false;
    }

    // Format actual value for display
    let actualStr: string;
    if (gateId === "safety_p0") {
      actualStr = `${metricValue} failures`;
    } else {
      actualStr = `${(metricValue * 100).toFixed(1)}%`;
    }

    // Format threshold for display
    let thresholdStr: string;
    if (gateId === "safety_p0") {
      thresholdStr = `0 failures`;
    } else {
      thresholdStr = `${gate.operator} ${(gate.threshold * 100).toFixed(0)}%`;
    }

    results.push({
      gate: gateId,
      description: gate.description,
      threshold: thresholdStr,
      actual: actualStr,
      passed,
      hard_gate: gate.hard_gate,
    });
  }

  return results;
}

function checkRegression(
  current: ReleaseScores,
  baseline: ReleaseScores | null,
  maxRegressionPct: number
): ReleaseGateReport["regression"] {
  if (!baseline) {
    return { checked: false, passed: true, regressions: [] };
  }

  const metricsToCheck: Array<{ key: keyof ReleaseScores; label: string }> = [
    { key: "citation_coverage_rate", label: "Citation coverage" },
    { key: "disclaimer_pass_rate", label: "Disclaimer correctness" },
    { key: "language_voice_pass_rate", label: "Language/voice" },
    { key: "overall_pass_rate", label: "Overall pass rate" },
  ];

  const regressions: ReleaseGateReport["regression"]["regressions"] = [];

  for (const { key, label } of metricsToCheck) {
    const baselineVal = baseline[key] as number;
    const currentVal = current[key] as number;
    if (typeof baselineVal !== "number" || typeof currentVal !== "number")
      continue;

    const deltaPct = (currentVal - baselineVal) * 100;
    if (deltaPct < -maxRegressionPct) {
      regressions.push({
        metric: label,
        baseline: baselineVal,
        current: currentVal,
        delta_pct: deltaPct,
      });
    }
  }

  return {
    checked: true,
    baselinePath: BASELINE_PATH,
    regressions,
    passed: regressions.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

export function formatGateReport(report: ReleaseGateReport): string {
  const lines: string[] = [];

  lines.push("## Release Gate Report");
  lines.push("");
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`API: ${report.apiBaseUrl}`);
  lines.push("");
  lines.push(
    "| Gate | Threshold | Actual | Status |"
  );
  lines.push(
    "|------|-----------|--------|--------|"
  );

  for (const gate of report.gates) {
    const status = gate.passed ? "PASS" : "FAIL";
    lines.push(
      `| ${gate.description} | ${gate.threshold} | ${gate.actual} | ${status} |`
    );
  }

  // Regression row
  if (report.regression.checked) {
    const regStatus = report.regression.passed ? "PASS" : "FAIL";
    const regActual =
      report.regression.regressions.length > 0
        ? report.regression.regressions
            .map((r) => `${r.metric}: ${r.delta_pct.toFixed(1)}%`)
            .join(", ")
        : "No regression";
    lines.push(`| No regression | vs baseline | ${regActual} | ${regStatus} |`);
  } else {
    lines.push(
      `| No regression | vs baseline | No baseline found | SKIP |`
    );
  }

  lines.push("");

  // Per-set breakdown
  lines.push("### Per-Set Breakdown");
  lines.push("");
  lines.push("| Set | Passed | Total | Rate |");
  lines.push("|-----|--------|-------|------|");
  for (const [setName, stats] of Object.entries(report.scores.per_set)) {
    lines.push(
      `| ${setName} | ${stats.passed} | ${stats.total} | ${(stats.rate * 100).toFixed(1)}% |`
    );
  }
  lines.push("");

  // Verdict
  const verdictEmoji = report.verdict === "DEPLOY" ? "DEPLOY" : "BLOCK";
  lines.push(`**VERDICT: ${verdictEmoji}**`);
  lines.push("");

  if (report.verdict === "BLOCK") {
    const failedGates = report.gates.filter((g) => !g.passed);
    if (failedGates.length > 0) {
      lines.push("### Blocking Gates:");
      for (const g of failedGates) {
        lines.push(
          `- **${g.description}**: ${g.actual} (threshold: ${g.threshold})`
        );
      }
    }
    if (!report.regression.passed) {
      lines.push("### Regressions:");
      for (const r of report.regression.regressions) {
        lines.push(
          `- **${r.metric}**: ${(r.baseline * 100).toFixed(1)}% -> ${(r.current * 100).toFixed(1)}% (${r.delta_pct.toFixed(1)}%)`
        );
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface ReleaseGateOptions {
  apiUrl?: string;
  saveBaseline?: boolean;
  outputPath?: string;
  configPath?: string;
}

export async function runReleaseGate(
  options: ReleaseGateOptions = {}
): Promise<ReleaseGateReport> {
  const startTime = Date.now();

  // Load eval config
  console.log("Loading configuration...");
  const config = await loadConfig(options.configPath);
  if (options.apiUrl) {
    config.apiBaseUrl = options.apiUrl;
  }

  // Load thresholds
  console.log("Loading gate thresholds...");
  const thresholds = await loadThresholds();

  // Load rubrics
  console.log("Loading rubrics...");
  const rubricPack = await Evaluator.loadRubrics(DEFAULT_RUBRICS);

  // Load gold test cases (all 4 sets)
  console.log("Loading gold eval pack...");
  const { allCases, casesBySet } = await loadGoldTestCases();
  console.log(
    `  Loaded ${allCases.length} cases across ${Object.keys(casesBySet).length} sets`
  );
  for (const [setName, cases] of Object.entries(casesBySet)) {
    console.log(`    ${setName}: ${cases.length} cases`);
  }

  // Create evaluator
  const evaluator = new Evaluator(config, rubricPack);
  const reportGenerator = new ReportGenerator();

  // Run all test cases
  console.log(`\nRunning ${allCases.length} gold eval cases against ${config.apiBaseUrl}...`);
  console.log("(This may take several minutes)\n");

  const results = await evaluator.evaluateTestCases(allCases);

  // Map results back to sets
  const resultsBySet: Record<string, EvaluationResult[]> = {};
  for (const [setName, cases] of Object.entries(casesBySet)) {
    const caseIds = new Set(cases.map((c) => c.id));
    resultsBySet[setName] = results.filter((r) => caseIds.has(r.testCaseId));
  }

  // Compute scores
  const scores = computeScores(results, casesBySet, resultsBySet);

  // Evaluate gates
  const gateResults = evaluateGates(scores, thresholds);

  // Check regression against baseline
  const baseline = await loadBaseline();
  const regression = checkRegression(
    scores,
    baseline,
    thresholds.regression.max_regression_pct
  );

  // Determine verdict
  const allGatesPassed = gateResults.every((g) => g.passed);
  const verdict: "DEPLOY" | "BLOCK" =
    allGatesPassed && regression.passed ? "DEPLOY" : "BLOCK";

  // Build eval report for inclusion
  const evalReport = reportGenerator.generateReport(results, config, undefined, {
    loadedCount: allCases.length,
    selectedCount: allCases.length,
  });

  const report: ReleaseGateReport = {
    timestamp: new Date().toISOString(),
    apiBaseUrl: config.apiBaseUrl,
    gates: gateResults,
    regression,
    verdict,
    scores,
    evalReport,
  };

  // Print report
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nRelease gate completed in ${totalTime}s\n`);
  console.log(formatGateReport(report));

  // Save output
  if (options.outputPath) {
    const outputDir = path.dirname(options.outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(
      options.outputPath,
      JSON.stringify(report, null, 2),
      "utf-8"
    );
    console.log(`\nReport saved to: ${options.outputPath}`);
  }

  // Save baseline if requested and verdict is DEPLOY
  if (options.saveBaseline) {
    if (verdict === "DEPLOY") {
      await saveBaseline(scores);
      console.log(`\nBaseline saved to: ${BASELINE_PATH}`);
    } else {
      console.log(
        `\nBaseline NOT saved (verdict is BLOCK — only successful deploys update the baseline)`
      );
    }
  }

  // Return with appropriate exit intent
  return report;
}
