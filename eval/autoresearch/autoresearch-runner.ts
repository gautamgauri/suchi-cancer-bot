/**
 * Autoresearch v0 — Main Loop Orchestrator
 *
 * A bounded self-improvement loop (Karpathy-style) that:
 *   1. Mines failures from the gold eval pack
 *   2. Generates hypotheses for root cause + candidate fixes
 *   3. Proposes a patch to a whitelisted repairable file
 *   4. Runs subset eval on affected cases
 *   5. Runs full regression if subset improved
 *   6. Gates the change (safety, citation, multilingual, overall)
 *   7. Archives the experiment log
 *   8. Flags for human approval before merge
 *
 * Hard cap: 3 iterations per run.
 * Patches ONLY touch files listed in repairable/manifest.json.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { Evaluator } from "../runner/evaluator";
import { ReportGenerator } from "../runner/report-generator";
import { loadConfig } from "../config/loader";
import {
  mineFailures,
  extractScoreSnapshot,
  mineVoiceQualityFailures,
  extractVoiceQualitySnapshot,
} from "./failure-miner";
import { Researcher } from "./researcher";
import { Patcher } from "./patcher";
import { checkGates, checkVoiceGates } from "./gatekeeper";
import { runVoiceTranscriptEval } from "../runner/voice-transcript-eval";
import {
  generateExperimentId,
  saveExperiment,
  formatExperimentSummary,
} from "./archivist";
import type {
  AutoresearchConfig,
  AutoresearchPhase,
  FailureBucket,
  ExperimentLog,
  ScoreSnapshot,
  VoiceQualitySnapshot,
  PatchProposal,
} from "./types";
import type { EvaluationConfig, EvaluationReport, TestCase } from "../types";

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_ITERATIONS_HARD_CAP = 3;

// ── Main entry point ────────────────────────────────────────────────────────

export async function runAutoresearch(config: AutoresearchConfig): Promise<void> {
  // Dispatch to voice mode if requested
  if (config.mode === "voice") {
    return runAutoresearchVoice(config);
  }

  const maxIter = Math.min(config.maxIterations, MAX_ITERATIONS_HARD_CAP);
  console.log(`\n=== Suchi Autoresearch v0 ===`);
  console.log(`Target: ${config.target}`);
  console.log(`Max iterations: ${maxIter}`);
  console.log(`Dry run: ${config.dryRun}`);
  console.log(`API: ${config.apiBaseUrl}`);
  console.log("");

  // Load eval config
  const evalConfig = await loadConfig();
  evalConfig.apiBaseUrl = config.apiBaseUrl;
  if (config.authBearer) {
    evalConfig.authBearer = config.authBearer;
  }

  // Load test cases and rubrics
  const testCases = await Evaluator.loadTestCases(config.goldCasesPath);
  const rubricPack = await Evaluator.loadRubrics(config.rubricsPath);

  // Read Deepseek config for LLM calls
  const deepseekApiKey = evalConfig.deepseekConfig?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  if (!deepseekApiKey) {
    console.error("DEEPSEEK_API_KEY is required for autoresearch. Set it in env or Secret Manager.");
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, "..", "..");
  const manifestPath = config.manifestPath;

  // Create shared LLM-backed modules
  const researcher = new Researcher({
    manifestPath,
    repoRoot,
    deepseekApiKey,
    deepseekBaseURL: evalConfig.deepseekConfig?.baseURL,
    model: evalConfig.deepseekConfig?.model,
  });

  const patcher = new Patcher({
    manifestPath,
    repoRoot,
    deepseekApiKey,
    deepseekBaseURL: evalConfig.deepseekConfig?.baseURL,
    model: evalConfig.deepseekConfig?.model,
  });

  // ── Phase 1: Baseline eval ─────────────────────────────────────────────
  console.log("Phase 1: Running baseline evaluation...");
  const baselineReport = await runFullEval(evalConfig, testCases, rubricPack);
  const baselineScores = extractScoreSnapshot(baselineReport);

  console.log(`\nBaseline results:`);
  console.log(`  Overall score: ${(baselineScores.overall * 100).toFixed(1)}%`);
  console.log(`  Pass rate: ${(baselineScores.passRate * 100).toFixed(1)}%`);
  console.log(`  P0 failures: ${baselineScores.p0Failures}`);
  console.log(`  Citation coverage: ${(baselineScores.citationCoverageRate * 100).toFixed(1)}%`);

  // ── Phase 2: Mine failures ─────────────────────────────────────────────
  console.log("\nPhase 2: Mining failure clusters...");
  const allBuckets = mineFailures(baselineReport);

  if (allBuckets.length === 0) {
    console.log("No failure clusters found. All cases pass. Nothing to improve.");
    return;
  }

  console.log(`Found ${allBuckets.length} failure cluster(s):`);
  for (const b of allBuckets) {
    console.log(`  [${b.severity}] ${b.failureType} — ${b.count} failures, ${b.affectedCaseIds.length} cases`);
  }

  // Filter buckets by target
  const targetBuckets =
    config.target === "all"
      ? allBuckets
      : allBuckets.filter((b) => b.failureType === config.target);

  if (targetBuckets.length === 0) {
    console.log(`No failure clusters match target "${config.target}".`);
    return;
  }

  // ── Iteration loop ────────────────────────────────────────────────────
  let currentBestScores = baselineScores;
  const acceptedExperiments: ExperimentLog[] = [];

  for (let iter = 0; iter < maxIter && iter < targetBuckets.length; iter++) {
    const bucket = targetBuckets[iter];
    const experimentId = generateExperimentId(iter + 1);
    const iterStart = Date.now();

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Iteration ${iter + 1}/${maxIter}: ${bucket.failureType} [${bucket.severity}]`);
    console.log(`Experiment: ${experimentId}`);
    console.log(`${"=".repeat(60)}`);

    // ── Phase 3: Research ──────────────────────────────────────────────
    console.log("\nPhase 3: Generating hypotheses...");
    let hypotheses;
    try {
      hypotheses = await researcher.generateHypotheses(bucket);
    } catch (err: any) {
      console.error(`Research failed: ${err.message}`);
      await archiveSkipped(experimentId, iter + 1, bucket, currentBestScores, "Research phase failed: " + err.message, iterStart);
      continue;
    }

    if (hypotheses.length === 0) {
      console.log("No hypotheses generated. Skipping this cluster.");
      await archiveSkipped(experimentId, iter + 1, bucket, currentBestScores, "No hypotheses generated", iterStart);
      continue;
    }

    console.log(`Generated ${hypotheses.length} hypothesis(es):`);
    for (const h of hypotheses) {
      console.log(`  [${(h.confidence * 100).toFixed(0)}%] ${h.label} -> ${h.repairableFile} (risk: ${h.risk})`);
    }

    // Pick top hypothesis
    const topHypothesis = hypotheses[0];
    console.log(`\nSelected: "${topHypothesis.label}" (confidence: ${(topHypothesis.confidence * 100).toFixed(0)}%)`);

    // ── Phase 4: Propose patch ─────────────────────────────────────────
    console.log("\nPhase 4: Generating patch...");
    let patch: PatchProposal | null;
    try {
      patch = await patcher.proposePatch(topHypothesis, experimentId);
    } catch (err: any) {
      console.error(`Patch generation failed: ${err.message}`);
      await archiveSkipped(experimentId, iter + 1, bucket, currentBestScores, "Patch generation failed: " + err.message, iterStart);
      continue;
    }

    if (!patch) {
      console.log("No patch generated. Skipping.");
      await archiveSkipped(experimentId, iter + 1, bucket, currentBestScores, "Patcher returned null", iterStart);
      continue;
    }

    if (!patch.validation.syntaxValid) {
      console.log(`Patch has syntax errors: ${patch.validation.errors.join(", ")}`);
      await archiveSkipped(experimentId, iter + 1, bucket, currentBestScores, "Patch syntax invalid: " + patch.validation.errors.join(", "), iterStart);
      continue;
    }

    console.log(`Patch generated for ${patch.filePath}`);
    console.log(`Diff preview:\n${patch.diff.slice(0, 500)}`);

    if (config.dryRun) {
      console.log("\n[DRY RUN] Skipping eval and git operations.");
      const log = buildExperimentLog(
        experimentId, iter + 1, bucket, topHypothesis, patch,
        currentBestScores, null, null, null, null,
        "skipped", "Dry run — patch not applied", iterStart,
      );
      const logPath = await saveExperiment(log);
      console.log(`Experiment log saved: ${logPath}`);
      console.log("\n" + formatExperimentSummary(log));
      continue;
    }

    // ── Apply patch ────────────────────────────────────────────────────
    console.log("\nApplying patch...");
    let appliedBranch: string;
    try {
      const result = await patcher.applyPatch(patch);
      appliedBranch = result.branch;
      console.log(`Patch applied on branch: ${appliedBranch}`);
    } catch (err: any) {
      console.error(`Failed to apply patch: ${err.message}`);
      await archiveSkipped(experimentId, iter + 1, bucket, currentBestScores, "Failed to apply patch: " + err.message, iterStart);
      continue;
    }

    // ── Phase 5: Subset eval ───────────────────────────────────────────
    console.log("\nPhase 5: Running subset eval on affected cases...");
    const subsetCaseIds = new Set(bucket.affectedCaseIds);
    const subsetCases = testCases.filter((tc) => subsetCaseIds.has(tc.id));

    let subsetReport: EvaluationReport | null = null;
    let subsetAfterScores: ScoreSnapshot | null = null;
    let subsetImproved = false;

    if (subsetCases.length > 0) {
      try {
        subsetReport = await runSubsetEval(evalConfig, subsetCases, rubricPack);
        subsetAfterScores = extractScoreSnapshot(subsetReport);

        // Compare subset pass rate
        const subsetBeforePassRate = countSubsetPassRate(baselineReport, subsetCaseIds);
        const subsetAfterPassRate = subsetReport.summary.total > 0
          ? subsetReport.summary.passed / subsetReport.summary.total
          : 0;

        subsetImproved = subsetAfterPassRate >= subsetBeforePassRate;
        console.log(`Subset pass rate: ${(subsetBeforePassRate * 100).toFixed(1)}% -> ${(subsetAfterPassRate * 100).toFixed(1)}%`);
        console.log(`Subset ${subsetImproved ? "IMPROVED or EQUAL" : "REGRESSED"}`);
      } catch (err: any) {
        console.error(`Subset eval failed: ${err.message}`);
        await revertAndArchive(patcher, patch, experimentId, iter + 1, bucket, topHypothesis, currentBestScores, "Subset eval failed: " + err.message, iterStart);
        continue;
      }
    } else {
      console.log("No affected cases found for subset eval. Treating as improved.");
      subsetImproved = true;
    }

    // ── Phase 6: Full regression ───────────────────────────────────────
    let afterScores: ScoreSnapshot | null = null;
    let fullReport: EvaluationReport | null = null;

    if (subsetImproved) {
      console.log("\nPhase 6: Running full regression eval...");
      try {
        fullReport = await runFullEval(evalConfig, testCases, rubricPack);
        afterScores = extractScoreSnapshot(fullReport);

        console.log(`\nFull regression results:`);
        console.log(`  Overall: ${(currentBestScores.overall * 100).toFixed(1)}% -> ${(afterScores.overall * 100).toFixed(1)}%`);
        console.log(`  Pass rate: ${(currentBestScores.passRate * 100).toFixed(1)}% -> ${(afterScores.passRate * 100).toFixed(1)}%`);
        console.log(`  P0 failures: ${currentBestScores.p0Failures} -> ${afterScores.p0Failures}`);
      } catch (err: any) {
        console.error(`Full regression eval failed: ${err.message}`);
        await revertAndArchive(patcher, patch, experimentId, iter + 1, bucket, topHypothesis, currentBestScores, "Full regression eval failed: " + err.message, iterStart);
        continue;
      }
    } else {
      console.log("\nSubset did not improve. Skipping full regression.");
      await revertAndArchive(patcher, patch, experimentId, iter + 1, bucket, topHypothesis, currentBestScores, "Subset eval showed regression", iterStart);
      continue;
    }

    // ── Phase 7: Gate check ────────────────────────────────────────────
    console.log("\nPhase 7: Checking gates...");
    const gateResult = checkGates(currentBestScores, afterScores!);

    console.log(`Gate result: ${gateResult.passed ? "PASS" : "FAIL"}`);
    for (const check of gateResult.checks) {
      const icon = check.passed ? "[OK]" : "[FAIL]";
      console.log(`  ${icon} ${check.name}: ${check.detail}`);
    }

    // ── Phase 8: Archive ───────────────────────────────────────────────
    const decision = gateResult.passed ? "accepted" : "rejected";
    const log = buildExperimentLog(
      experimentId, iter + 1, bucket, topHypothesis, patch,
      currentBestScores, afterScores, null, subsetAfterScores,
      gateResult, decision, gateResult.reason, iterStart,
    );

    const logPath = await saveExperiment(log);
    console.log(`\nExperiment log saved: ${logPath}`);

    if (gateResult.passed) {
      console.log(`\nChange ACCEPTED. Branch: ${patch.branch}`);
      currentBestScores = afterScores!;
      acceptedExperiments.push(log);
    } else {
      console.log(`\nChange REJECTED. Reverting...`);
      await patcher.revertPatch(patch);
    }

    console.log("\n" + formatExperimentSummary(log));
  }

  // ── Phase 9: Human approval ──────────────────────────────────────────
  if (acceptedExperiments.length > 0) {
    console.log(`\n${"=".repeat(60)}`);
    console.log("HUMAN APPROVAL REQUIRED");
    console.log(`${"=".repeat(60)}`);
    console.log(`\n${acceptedExperiments.length} experiment(s) accepted and awaiting human review:`);

    for (const exp of acceptedExperiments) {
      console.log(`\n  Experiment: ${exp.experimentId}`);
      console.log(`  Branch: ${exp.branch}`);
      console.log(`  File: ${exp.repairableFile}`);
      console.log(`  Hypothesis: ${exp.hypothesis.label}`);
      const delta = (exp.afterScores!.overall - exp.beforeScores.overall) * 100;
      const sign = delta >= 0 ? "+" : "";
      console.log(`  Score delta: ${sign}${delta.toFixed(1)}pp`);
    }

    console.log(`\nTo review and merge:`);
    for (const exp of acceptedExperiments) {
      console.log(`  git checkout ${exp.branch}`);
      console.log(`  git diff main...${exp.branch}`);
      console.log(`  git checkout main && git merge ${exp.branch}`);
    }

    console.log(`\nDo NOT auto-merge. Human review of all diffs is required.`);
  } else {
    console.log(`\nNo experiments accepted in this run.`);
  }

  console.log(`\nAutoresearch complete.`);
}

// ── Eval helpers ────────────────────────────────────────────────────────────

async function runFullEval(
  evalConfig: EvaluationConfig,
  testCases: TestCase[],
  rubricPack: any,
): Promise<EvaluationReport> {
  const evaluator = new Evaluator(evalConfig, rubricPack);
  const reportGenerator = new ReportGenerator();

  const results = await evaluator.evaluateTestCases(testCases);
  return reportGenerator.generateReport(results, evalConfig, undefined, {
    loadedCount: testCases.length,
    selectedCount: testCases.length,
  });
}

async function runSubsetEval(
  evalConfig: EvaluationConfig,
  subsetCases: TestCase[],
  rubricPack: any,
): Promise<EvaluationReport> {
  const evaluator = new Evaluator(evalConfig, rubricPack);
  const reportGenerator = new ReportGenerator();

  const results = await evaluator.evaluateTestCases(subsetCases);
  return reportGenerator.generateReport(results, evalConfig, undefined, {
    loadedCount: subsetCases.length,
    selectedCount: subsetCases.length,
  });
}

function countSubsetPassRate(report: EvaluationReport, caseIds: Set<string>): number {
  const subset = report.results.filter((r) => caseIds.has(r.testCaseId));
  if (subset.length === 0) return 0;
  const passed = subset.filter((r) => r.passed).length;
  return passed / subset.length;
}

// ── Archive helpers ─────────────────────────────────────────────────────────

async function archiveSkipped(
  experimentId: string,
  iteration: number,
  bucket: FailureBucket,
  scores: ScoreSnapshot,
  reason: string,
  startTime: number,
): Promise<void> {
  const log: ExperimentLog = {
    experimentId,
    timestamp: new Date().toISOString(),
    iteration,
    failureCluster: bucket,
    hypothesis: {
      label: "(none)",
      rootCause: "",
      intervention: "",
      confidence: 0,
      risk: "high",
      repairableFile: "",
      targetSection: "",
    },
    patchDiff: "",
    repairableFile: "",
    beforeScores: scores,
    afterScores: null,
    subsetBeforeScores: null,
    subsetAfterScores: null,
    gateResult: null,
    decision: "skipped",
    reason,
    branch: "",
    durationMs: Date.now() - startTime,
  };

  const logPath = await saveExperiment(log);
  console.log(`Experiment skipped and archived: ${logPath}`);
}

async function revertAndArchive(
  patcher: Patcher,
  patch: PatchProposal,
  experimentId: string,
  iteration: number,
  bucket: FailureBucket,
  hypothesis: any,
  scores: ScoreSnapshot,
  reason: string,
  startTime: number,
): Promise<void> {
  try {
    await patcher.revertPatch(patch);
  } catch (err: any) {
    console.warn(`Failed to revert patch: ${err.message}`);
  }

  const log = buildExperimentLog(
    experimentId, iteration, bucket, hypothesis, patch,
    scores, null, null, null, null,
    "rejected", reason, startTime,
  );

  const logPath = await saveExperiment(log);
  console.log(`Experiment rejected and archived: ${logPath}`);
}

function buildExperimentLog(
  experimentId: string,
  iteration: number,
  bucket: FailureBucket,
  hypothesis: any,
  patch: PatchProposal | null,
  beforeScores: ScoreSnapshot,
  afterScores: ScoreSnapshot | null,
  subsetBeforeScores: ScoreSnapshot | null,
  subsetAfterScores: ScoreSnapshot | null,
  gateResult: any,
  decision: "accepted" | "rejected" | "skipped",
  reason: string,
  startTime: number,
): ExperimentLog {
  return {
    experimentId,
    timestamp: new Date().toISOString(),
    iteration,
    failureCluster: bucket,
    hypothesis,
    patchDiff: patch?.diff || "",
    repairableFile: patch?.filePath || "",
    beforeScores,
    afterScores,
    subsetBeforeScores,
    subsetAfterScores,
    gateResult,
    decision,
    reason,
    branch: patch?.branch || "",
    durationMs: Date.now() - startTime,
  };
}

// ── Voice mode runner ──────────────────────────────────────────────────────

/**
 * Run autoresearch in voice mode.
 *
 * Phases:
 *   1. Run voice transcript eval (baseline)
 *   2. Mine voice quality failures (formatting, length, naturalness)
 *   3-7. Same hypothesis -> patch -> eval -> gate flow as gold mode
 *
 * Key difference: The voice mode uses voice quality gates in addition
 * to standard gold gates — patches must not regress either voice or text quality.
 *
 * LIMITATION: The `channel` field (web/voice) is available in chat.service.ts
 * from dto.channel, but is NOT currently passed through to llm.service.ts's
 * conversationContext. This means the LLM prompt cannot be conditioned on
 * channel at generation time. Voice quality improvements must therefore be
 * general (e.g., shorter responses, less markdown) or the channel passthrough
 * must be added to the LLM service first.
 */
async function runAutoresearchVoice(config: AutoresearchConfig): Promise<void> {
  const maxIter = Math.min(config.maxIterations, MAX_ITERATIONS_HARD_CAP);
  console.log(`\n=== Suchi Autoresearch v0 (Voice Mode) ===`);
  console.log(`Target: ${config.target}`);
  console.log(`Max iterations: ${maxIter}`);
  console.log(`Dry run: ${config.dryRun}`);
  console.log(`API: ${config.apiBaseUrl}`);
  console.log("");

  // Load eval config (needed for auth, deepseek, etc.)
  const evalConfig = await loadConfig();
  evalConfig.apiBaseUrl = config.apiBaseUrl;
  if (config.authBearer) {
    evalConfig.authBearer = config.authBearer;
  }

  // Deepseek config for LLM calls (researcher + patcher)
  const deepseekApiKey =
    evalConfig.deepseekConfig?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  if (!deepseekApiKey) {
    console.error(
      "DEEPSEEK_API_KEY is required for autoresearch. Set it in env or Secret Manager.",
    );
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, "..", "..");
  const manifestPath = config.manifestPath;

  const researcher = new Researcher({
    manifestPath,
    repoRoot,
    deepseekApiKey,
    deepseekBaseURL: evalConfig.deepseekConfig?.baseURL,
    model: evalConfig.deepseekConfig?.model,
  });

  const patcher = new Patcher({
    manifestPath,
    repoRoot,
    deepseekApiKey,
    deepseekBaseURL: evalConfig.deepseekConfig?.baseURL,
    model: evalConfig.deepseekConfig?.model,
  });

  // Voice transcript eval paths
  const voiceCasesPath =
    config.voiceCasesPath ||
    path.resolve(__dirname, "..", "cases", "voice", "voice_transcript_cancer_queries.yaml");
  const voiceReportPath =
    config.voiceReportPath ||
    path.resolve(__dirname, "..", "reports", "voice-autoresearch-baseline.json");

  // Also need gold eval for regression gates
  const testCases = await Evaluator.loadTestCases(config.goldCasesPath);
  const rubricPack = await Evaluator.loadRubrics(config.rubricsPath);

  // ── Phase 1: Baseline voice transcript eval ────────────────────────────
  console.log("Phase 1: Running baseline voice transcript eval...");
  const baselineVoiceReport = await runVoiceTranscriptEval({
    casesPath: voiceCasesPath,
    apiBaseUrl: config.apiBaseUrl,
    outputPath: voiceReportPath,
    timeoutMs: evalConfig.timeoutMs || 60000,
    authBearer: config.authBearer,
  });
  const baselineVoiceSnapshot = extractVoiceQualitySnapshot(baselineVoiceReport);

  console.log(`\nBaseline voice quality:`);
  console.log(`  Voice-ready: ${baselineVoiceSnapshot.voiceReadyCount}/${baselineVoiceSnapshot.totalTranscripts} (${(baselineVoiceSnapshot.voiceReadyRate * 100).toFixed(1)}%)`);
  console.log(`  Avg word count: ${baselineVoiceSnapshot.avgWordCount}`);
  console.log(`  Too long: ${baselineVoiceSnapshot.tooLongCount}`);
  console.log(`  Formatting issues: ${baselineVoiceSnapshot.formattingIssueCount}`);
  console.log(`  Unnatural language: ${baselineVoiceSnapshot.unnaturalLanguageCount}`);

  // Also run gold eval baseline (for regression gates)
  console.log("\nRunning baseline gold eval (for regression gates)...");
  const baselineGoldReport = await runFullEval(evalConfig, testCases, rubricPack);
  const baselineGoldScores = extractScoreSnapshot(baselineGoldReport);

  console.log(`  Gold overall: ${(baselineGoldScores.overall * 100).toFixed(1)}%`);
  console.log(`  Gold pass rate: ${(baselineGoldScores.passRate * 100).toFixed(1)}%`);

  // ── Phase 2: Mine voice quality failures ───────────────────────────────
  console.log("\nPhase 2: Mining voice quality failure clusters...");
  const allBuckets = mineVoiceQualityFailures(baselineVoiceReport);

  if (allBuckets.length === 0) {
    console.log("No voice quality failure clusters found. All responses are voice-ready.");
    return;
  }

  console.log(`Found ${allBuckets.length} voice quality failure cluster(s):`);
  for (const b of allBuckets) {
    console.log(`  [${b.severity}] ${b.failureType} — ${b.count} failures, ${b.affectedCaseIds.length} cases`);
  }

  // Filter buckets by target
  const targetBuckets =
    config.target === "all"
      ? allBuckets
      : allBuckets.filter((b) => b.failureType === config.target);

  if (targetBuckets.length === 0) {
    console.log(`No failure clusters match target "${config.target}".`);
    return;
  }

  // ── Iteration loop ────────────────────────────────────────────────────
  let currentBestGoldScores = baselineGoldScores;
  let currentBestVoiceSnapshot = baselineVoiceSnapshot;
  const acceptedExperiments: ExperimentLog[] = [];

  for (let iter = 0; iter < maxIter && iter < targetBuckets.length; iter++) {
    const bucket = targetBuckets[iter];
    const experimentId = generateExperimentId(iter + 1);
    const iterStart = Date.now();

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Iteration ${iter + 1}/${maxIter}: ${bucket.failureType} [${bucket.severity}]`);
    console.log(`Experiment: ${experimentId}`);
    console.log(`${"=".repeat(60)}`);

    // ── Phase 3: Research ──────────────────────────────────────────────
    console.log("\nPhase 3: Generating hypotheses...");
    let hypotheses;
    try {
      hypotheses = await researcher.generateHypotheses(bucket);
    } catch (err: any) {
      console.error(`Research failed: ${err.message}`);
      await archiveSkipped(
        experimentId, iter + 1, bucket, currentBestGoldScores,
        "Research phase failed: " + err.message, iterStart,
      );
      continue;
    }

    if (hypotheses.length === 0) {
      console.log("No hypotheses generated. Skipping this cluster.");
      await archiveSkipped(
        experimentId, iter + 1, bucket, currentBestGoldScores,
        "No hypotheses generated", iterStart,
      );
      continue;
    }

    console.log(`Generated ${hypotheses.length} hypothesis(es):`);
    for (const h of hypotheses) {
      console.log(`  [${(h.confidence * 100).toFixed(0)}%] ${h.label} -> ${h.repairableFile} (risk: ${h.risk})`);
    }

    const topHypothesis = hypotheses[0];
    console.log(`\nSelected: "${topHypothesis.label}" (confidence: ${(topHypothesis.confidence * 100).toFixed(0)}%)`);

    // ── Phase 4: Propose patch ─────────────────────────────────────────
    console.log("\nPhase 4: Generating patch...");
    let patch: PatchProposal | null;
    try {
      patch = await patcher.proposePatch(topHypothesis, experimentId);
    } catch (err: any) {
      console.error(`Patch generation failed: ${err.message}`);
      await archiveSkipped(
        experimentId, iter + 1, bucket, currentBestGoldScores,
        "Patch generation failed: " + err.message, iterStart,
      );
      continue;
    }

    if (!patch) {
      console.log("No patch generated. Skipping.");
      await archiveSkipped(
        experimentId, iter + 1, bucket, currentBestGoldScores,
        "Patcher returned null", iterStart,
      );
      continue;
    }

    if (!patch.validation.syntaxValid) {
      console.log(`Patch has syntax errors: ${patch.validation.errors.join(", ")}`);
      await archiveSkipped(
        experimentId, iter + 1, bucket, currentBestGoldScores,
        "Patch syntax invalid: " + patch.validation.errors.join(", "), iterStart,
      );
      continue;
    }

    console.log(`Patch generated for ${patch.filePath}`);
    console.log(`Diff preview:\n${patch.diff.slice(0, 500)}`);

    if (config.dryRun) {
      console.log("\n[DRY RUN] Skipping eval and git operations.");
      const log = buildExperimentLog(
        experimentId, iter + 1, bucket, topHypothesis, patch,
        currentBestGoldScores, null, null, null, null,
        "skipped", "Dry run — patch not applied", iterStart,
      );
      const logPath = await saveExperiment(log);
      console.log(`Experiment log saved: ${logPath}`);
      console.log("\n" + formatExperimentSummary(log));
      continue;
    }

    // ── Apply patch ────────────────────────────────────────────────────
    console.log("\nApplying patch...");
    let appliedBranch: string;
    try {
      const result = await patcher.applyPatch(patch);
      appliedBranch = result.branch;
      console.log(`Patch applied on branch: ${appliedBranch}`);
    } catch (err: any) {
      console.error(`Failed to apply patch: ${err.message}`);
      await archiveSkipped(
        experimentId, iter + 1, bucket, currentBestGoldScores,
        "Failed to apply patch: " + err.message, iterStart,
      );
      continue;
    }

    // ── Phase 5: Re-run voice transcript eval ──────────────────────────
    console.log("\nPhase 5: Re-running voice transcript eval after patch...");
    const afterVoiceReportPath = path.resolve(
      __dirname, "..", "reports",
      `voice-autoresearch-${experimentId}.json`,
    );

    let afterVoiceReport;
    let afterVoiceSnapshot: VoiceQualitySnapshot;
    let voiceImproved = false;

    try {
      afterVoiceReport = await runVoiceTranscriptEval({
        casesPath: voiceCasesPath,
        apiBaseUrl: config.apiBaseUrl,
        outputPath: afterVoiceReportPath,
        timeoutMs: evalConfig.timeoutMs || 60000,
        authBearer: config.authBearer,
      });
      afterVoiceSnapshot = extractVoiceQualitySnapshot(afterVoiceReport);

      console.log(`Voice-ready: ${currentBestVoiceSnapshot.voiceReadyRate * 100}% -> ${afterVoiceSnapshot.voiceReadyRate * 100}%`);
      console.log(`Avg words: ${currentBestVoiceSnapshot.avgWordCount} -> ${afterVoiceSnapshot.avgWordCount}`);
      console.log(`Formatting issues: ${currentBestVoiceSnapshot.formattingIssueCount} -> ${afterVoiceSnapshot.formattingIssueCount}`);

      // Voice improved = voice-ready rate did not regress
      voiceImproved = afterVoiceSnapshot.voiceReadyRate >= currentBestVoiceSnapshot.voiceReadyRate;
      console.log(`Voice ${voiceImproved ? "IMPROVED or EQUAL" : "REGRESSED"}`);
    } catch (err: any) {
      console.error(`Voice eval failed: ${err.message}`);
      await revertAndArchive(
        patcher, patch, experimentId, iter + 1, bucket, topHypothesis,
        currentBestGoldScores, "Voice eval failed: " + err.message, iterStart,
      );
      continue;
    }

    // ── Phase 6: Full gold regression ──────────────────────────────────
    let afterGoldScores: ScoreSnapshot | null = null;
    let fullGoldReport: EvaluationReport | null = null;

    if (voiceImproved) {
      console.log("\nPhase 6: Running full gold regression eval...");
      try {
        fullGoldReport = await runFullEval(evalConfig, testCases, rubricPack);
        afterGoldScores = extractScoreSnapshot(fullGoldReport);

        console.log(`Gold overall: ${(currentBestGoldScores.overall * 100).toFixed(1)}% -> ${(afterGoldScores.overall * 100).toFixed(1)}%`);
        console.log(`Gold pass rate: ${(currentBestGoldScores.passRate * 100).toFixed(1)}% -> ${(afterGoldScores.passRate * 100).toFixed(1)}%`);
      } catch (err: any) {
        console.error(`Gold regression eval failed: ${err.message}`);
        await revertAndArchive(
          patcher, patch, experimentId, iter + 1, bucket, topHypothesis,
          currentBestGoldScores, "Gold regression eval failed: " + err.message, iterStart,
        );
        continue;
      }
    } else {
      console.log("\nVoice quality did not improve. Skipping gold regression.");
      await revertAndArchive(
        patcher, patch, experimentId, iter + 1, bucket, topHypothesis,
        currentBestGoldScores, "Voice eval showed regression", iterStart,
      );
      continue;
    }

    // ── Phase 7: Voice + gold gate check ───────────────────────────────
    console.log("\nPhase 7: Checking voice + gold gates...");
    const gateResult = checkVoiceGates(
      currentBestVoiceSnapshot,
      afterVoiceSnapshot!,
      currentBestGoldScores,
      afterGoldScores!,
    );

    console.log(`Gate result: ${gateResult.passed ? "PASS" : "FAIL"}`);
    for (const check of gateResult.checks) {
      const icon = check.passed ? "[OK]" : "[FAIL]";
      console.log(`  ${icon} ${check.name}: ${check.detail}`);
    }

    // ── Phase 8: Archive ───────────────────────────────────────────────
    const decision = gateResult.passed ? "accepted" : "rejected";
    const log = buildExperimentLog(
      experimentId, iter + 1, bucket, topHypothesis, patch,
      currentBestGoldScores, afterGoldScores, null, null,
      gateResult, decision, gateResult.reason, iterStart,
    );

    const logPath = await saveExperiment(log);
    console.log(`\nExperiment log saved: ${logPath}`);

    if (gateResult.passed) {
      console.log(`\nChange ACCEPTED. Branch: ${patch.branch}`);
      currentBestGoldScores = afterGoldScores!;
      currentBestVoiceSnapshot = afterVoiceSnapshot!;
      acceptedExperiments.push(log);
    } else {
      console.log(`\nChange REJECTED. Reverting...`);
      await patcher.revertPatch(patch);
    }

    console.log("\n" + formatExperimentSummary(log));
  }

  // ── Phase 9: Human approval ──────────────────────────────────────────
  if (acceptedExperiments.length > 0) {
    console.log(`\n${"=".repeat(60)}`);
    console.log("HUMAN APPROVAL REQUIRED");
    console.log(`${"=".repeat(60)}`);
    console.log(`\n${acceptedExperiments.length} experiment(s) accepted and awaiting human review:`);

    for (const exp of acceptedExperiments) {
      console.log(`\n  Experiment: ${exp.experimentId}`);
      console.log(`  Branch: ${exp.branch}`);
      console.log(`  File: ${exp.repairableFile}`);
      console.log(`  Hypothesis: ${exp.hypothesis.label}`);
    }

    console.log(`\nTo review and merge:`);
    for (const exp of acceptedExperiments) {
      console.log(`  git checkout ${exp.branch}`);
      console.log(`  git diff main...${exp.branch}`);
      console.log(`  git checkout main && git merge ${exp.branch}`);
    }

    console.log(`\nDo NOT auto-merge. Human review of all diffs is required.`);
  } else {
    console.log(`\nNo experiments accepted in this run.`);
  }

  console.log(`\nAutoresearch (voice mode) complete.`);

  // ── Report channel limitation ──────────────────────────────────────────
  console.log(`\n--- LIMITATION NOTE ---`);
  console.log(`The 'channel' field (web/voice) is available in chat.service.ts`);
  console.log(`but is NOT passed through to llm.service.ts's conversationContext.`);
  console.log(`Prompt patches cannot be conditioned on voice vs text channel.`);
  console.log(`To enable channel-aware prompts, add 'channel' to the`);
  console.log(`conversationContext parameter in llm.service.ts.generateWithCitations().`);
}
