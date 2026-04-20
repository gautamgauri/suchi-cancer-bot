/**
 * Autoresearch v1 — Main Loop Orchestrator
 *
 * A bounded self-improvement loop (Karpathy-style) with agent-based triage:
 *   1. Mines failures from the gold eval pack
 *   2. Triages each failure to the right agent (Prompt / KB / Config)
 *   3. Agent generates hypotheses + proposes patch
 *   4. Runs subset eval on affected cases
 *   5. Runs full regression if subset improved
 *   6. Gates the change (safety, citation, multilingual, overall)
 *   7. Archives the experiment log
 *   8. Flags for human approval before merge
 *
 * Agents:
 *   - Config Agent (original): retrieval.json, routing.json, language.json, disclaimer.json
 *   - Prompt Agent: explain-mode.md, navigate-mode.md, identify-requirements.md
 *   - KB Agent (Phase 2 stub): kb/ content gaps
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
import { TriageRouter } from "./triage-router";
import { PromptResearcher, PromptPatcher } from "./prompt-agent";
import { KBResearcher, KBPatcher } from "./kb-agent";
import { PatchJudge } from "./judge";
import { checkGates, checkVoiceGates } from "./gatekeeper";
import { runVoiceTranscriptEval } from "../runner/voice-transcript-eval";
import {
  generateExperimentId,
  saveExperiment,
  formatExperimentSummary,
} from "./archivist";
import { emailAutoresearchSummary } from "./summary-emailer";
import type {
  AutoresearchConfig,
  AutoresearchPhase,
  RepairAgentType,
  FailureBucket,
  ExperimentLog,
  ScoreSnapshot,
  VoiceQualitySnapshot,
  PatchProposal,
  Hypothesis,
} from "./types";
import type { EvaluationConfig, EvaluationReport, TestCase } from "../types";

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Hard cap on iterations per run. Karpathy's autoresearch reference runs ~100
 * experiments overnight; with the new sub-bucketing each iteration is one
 * targeted patch on ~5 cases, so 20 lets a nightly run actually move the needle
 * across multiple failure clusters instead of dabbling in 3 then stopping.
 */
const MAX_ITERATIONS_HARD_CAP = 20;

/** Number of candidate patches generated per failure bucket (N-of-K proposer). */
const CANDIDATES_PER_BUCKET = 4;

/**
 * Baseline pass-rate floor. If the baseline eval falls below this, the eval
 * itself is almost certainly broken (bad API key, API down, schema mismatch),
 * and iterating against it just burns LLM tokens on garbage data. Bail early.
 * Would have prevented exp-2026-04-02's 0% baseline waste.
 */
const BASELINE_PASS_RATE_FLOOR = 0.30;

// ── Main entry point ────────────────────────────────────────────────────────

export async function runAutoresearch(config: AutoresearchConfig): Promise<void> {
  // Dispatch to voice mode if requested
  if (config.mode === "voice") {
    return runAutoresearchVoice(config);
  }

  const maxIter = Math.min(config.maxIterations, MAX_ITERATIONS_HARD_CAP);
  const runStart = Date.now();
  // Collect every experiment (accepted + rejected + skipped) so the end-of-run
  // emailer can render a complete summary, not just the accepted ones.
  const allExperiments: ExperimentLog[] = [];

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

  // Read LLM config for agent calls (prefer Gemini, fall back to Deepseek)
  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const deepseekApiKey = evalConfig.deepseekConfig?.apiKey || process.env.DEEPSEEK_API_KEY || "";

  // Resolve which LLM backend to use
  let agentApiKey: string;
  let agentBaseURL: string;
  let agentModel: string;

  if (geminiApiKey) {
    agentApiKey = geminiApiKey;
    agentBaseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
    agentModel = process.env.AUTORESEARCH_MODEL || "gemini-2.0-flash";
    console.log(`Agent LLM: Gemini (${agentModel})`);
  } else if (deepseekApiKey) {
    agentApiKey = deepseekApiKey;
    agentBaseURL = evalConfig.deepseekConfig?.baseURL || "https://api.deepseek.com/v1";
    agentModel = evalConfig.deepseekConfig?.model || "deepseek-chat";
    console.log(`Agent LLM: Deepseek (${agentModel})`);
  } else {
    console.error("GEMINI_API_KEY or DEEPSEEK_API_KEY is required for autoresearch.");
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, "..", "..");
  const manifestPath = config.manifestPath;

  // ── Create agents ─────────────────────────────────────────────────────
  const llmOpts = {
    manifestPath,
    repoRoot,
    deepseekApiKey: agentApiKey,
    deepseekBaseURL: agentBaseURL,
    model: agentModel,
  };

  // Config Agent (original researcher + patcher)
  const configResearcher = new Researcher(llmOpts);
  const configPatcher = new Patcher(llmOpts);

  // Prompt Agent (prompt-engineering-aware)
  const promptResearcher = new PromptResearcher(llmOpts);
  const promptPatcher = new PromptPatcher(llmOpts);

  // KB Agent (Phase 2 stub)
  const kbResearcher = new KBResearcher({
    ...llmOpts,
    kbRoot: path.join(repoRoot, "kb"),
    apiBaseUrl: config.apiBaseUrl,
  });
  const kbPatcher = new KBPatcher({
    ...llmOpts,
    kbRoot: path.join(repoRoot, "kb"),
  });

  // Triage Router
  const triageRouter = new TriageRouter();

  // Pairwise patch judge (Gemini Flash) — picks the best of N candidate patches
  // before we spend tokens on subset eval. This is the core "N-of-K + judge"
  // pattern that Cursor 2.2 / Devin 2.0 / Karpathy autoresearch converged on.
  const patchJudge = new PatchJudge({
    apiKey: agentApiKey,
    baseURL: agentBaseURL,
    model: agentModel,
  });

  // Agent lookup helpers
  const getResearcher = (agent: RepairAgentType) => {
    switch (agent) {
      case "prompt": return promptResearcher;
      case "kb": return kbResearcher;
      default: return configResearcher;
    }
  };
  const getPatcher = (agent: RepairAgentType) => {
    switch (agent) {
      case "prompt": return promptPatcher;
      case "kb": return kbPatcher;
      default: return configPatcher;
    }
  };

  // ── Phase 1: Baseline eval ─────────────────────────────────────────────
  console.log("Phase 1: Running baseline evaluation...");
  const baselineReport = await runFullEval(evalConfig, testCases, rubricPack);
  const baselineScores = extractScoreSnapshot(baselineReport);

  console.log(`\nBaseline results:`);
  console.log(`  Overall score: ${(baselineScores.overall * 100).toFixed(1)}%`);
  console.log(`  Pass rate: ${(baselineScores.passRate * 100).toFixed(1)}%`);
  console.log(`  P0 failures: ${baselineScores.p0Failures}`);
  console.log(`  Citation coverage: ${(baselineScores.citationCoverageRate * 100).toFixed(1)}%`);

  // ── Preflight: baseline sanity check ────────────────────────────────
  // If the baseline pass rate is implausibly low, the eval itself is broken
  // (bad API key, API down, eval schema mismatch). Iterating against a broken
  // baseline accepts no-op patches and wastes LLM budget.
  if (baselineScores.passRate < BASELINE_PASS_RATE_FLOOR) {
    const msg =
      `ABORTING: baseline pass rate ${(baselineScores.passRate * 100).toFixed(1)}% is below floor ${(BASELINE_PASS_RATE_FLOOR * 100).toFixed(0)}%.`;
    console.error(`\n${msg}`);
    console.error("This indicates the eval/API is broken — refusing to iterate against a broken baseline.");
    console.error("Investigate: check API_BASE_URL is reachable, GEMINI_API_KEY is valid, eval cases load correctly.");
    if (config.emailRecipient) {
      try {
        await emailAutoresearchSummary({
          experiments: [],
          baselineScores,
          finalScores: baselineScores,
          recipientEmail: config.emailRecipient,
          durationMs: Date.now() - runStart,
          runLabel: `${config.runLabel || "manual"} — BASELINE BROKEN`,
        });
      } catch (e: any) {
        console.error(`Email send failed: ${e.message}`);
      }
    }
    process.exit(2);
  }

  // ── Phase 2: Mine failures ─────────────────────────────────────────────
  console.log("\nPhase 2: Mining failure clusters...");
  const allBuckets = mineFailures(baselineReport);

  if (allBuckets.length === 0) {
    console.log("No failure clusters found. All cases pass. Nothing to improve.");
    await maybeEmailSummary(config, allExperiments, baselineScores, baselineScores, runStart);
    return;
  }

  console.log(`Found ${allBuckets.length} failure cluster(s):`);
  for (const b of allBuckets) {
    const tag = b.clusterTag ? ` [${b.clusterTag}]` : "";
    console.log(`  [${b.severity}] ${b.failureType}${tag} — ${b.count} failures, ${b.affectedCaseIds.length} cases`);
  }

  // Filter buckets by target
  const targetBuckets =
    config.target === "all"
      ? allBuckets
      : allBuckets.filter((b) => b.failureType === config.target);

  if (targetBuckets.length === 0) {
    console.log(`No failure clusters match target "${config.target}".`);
    await maybeEmailSummary(config, allExperiments, baselineScores, baselineScores, runStart);
    return;
  }

  // ── Iteration loop (with triage) ────────────────────────────────────
  let currentBestScores = baselineScores;
  const acceptedExperiments: ExperimentLog[] = [];

  for (let iter = 0; iter < maxIter && iter < targetBuckets.length; iter++) {
    const bucket = targetBuckets[iter];
    const experimentId = generateExperimentId(iter + 1);
    const iterStart = Date.now();

    // ── Triage: route to correct agent ────────────────────────────────
    const triageDecision = triageRouter.route(bucket);
    const agentType = triageDecision.agent;
    const agentLabel = { prompt: "Prompt Agent", kb: "KB Agent", config: "Config Agent" }[agentType];

    const bucketTag = bucket.clusterTag ? ` [${bucket.clusterTag}]` : "";
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Iteration ${iter + 1}/${maxIter}: ${bucket.failureType}${bucketTag} [${bucket.severity}]`);
    console.log(`Agent: ${agentLabel} (confidence: ${(triageDecision.confidence * 100).toFixed(0)}%)`);
    console.log(`Reason: ${triageDecision.reason}`);
    console.log(`Experiment: ${experimentId}`);
    console.log(`${"=".repeat(60)}`);

    const researcher = getResearcher(agentType);
    const patcher = getPatcher(agentType);

    // ── Phase 3: Research ──────────────────────────────────────────────
    console.log(`\nPhase 3: ${agentLabel} generating hypotheses...`);
    let hypotheses: Hypothesis[];
    try {
      hypotheses = await researcher.generateHypotheses(bucket, triageDecision.candidateFiles);
    } catch (err: any) {
      console.error(`Research failed (${agentLabel}): ${err.message}`);
      allExperiments.push(await archiveSkipped(experimentId, iter + 1, bucket, currentBestScores, `${agentLabel} research failed: ` + err.message, iterStart, agentType));
      continue;
    }

    if (hypotheses.length === 0) {
      console.log(`${agentLabel}: no hypotheses generated. Skipping this cluster.`);
      allExperiments.push(await archiveSkipped(experimentId, iter + 1, bucket, currentBestScores, `${agentLabel}: no hypotheses generated`, iterStart, agentType));
      continue;
    }

    console.log(`Generated ${hypotheses.length} hypothesis(es):`);
    for (const h of hypotheses) {
      h.agent = agentType;
      console.log(`  [${(h.confidence * 100).toFixed(0)}%] ${h.label} -> ${h.repairableFile} (risk: ${h.risk})`);
    }

    // ── Phase 4: N-of-K patch generation + judge selection ──────────────
    // Generate up to CANDIDATES_PER_BUCKET patches in parallel (Cursor 2.2 /
    // Karpathy autoresearch pattern). A cheap pairwise judge picks the winner
    // before we spend tokens on subset eval. Single-shot proposers produce
    // no-ops in the noise floor; this pattern catches them cheaply.
    const topNHypotheses = hypotheses.slice(0, CANDIDATES_PER_BUCKET);
    console.log(
      `\nPhase 4: ${agentLabel} generating ${topNHypotheses.length} candidate patch(es) in parallel...`,
    );

    const patchAttempts = await Promise.all(
      topNHypotheses.map(async (h, i) => {
        try {
          const p = await patcher.proposePatch(h, experimentId);
          return { ok: true as const, patch: p, idx: i };
        } catch (err: any) {
          return { ok: false as const, error: err.message, idx: i };
        }
      }),
    );

    const validCandidates: PatchProposal[] = [];
    for (const a of patchAttempts) {
      if (!a.ok) {
        console.log(`  [FAIL] Candidate #${a.idx + 1}: generation errored — ${a.error}`);
        continue;
      }
      if (!a.patch) {
        console.log(`  [SKIP] Candidate #${a.idx + 1}: patcher returned null (likely no-op)`);
        continue;
      }
      if (!a.patch.validation.syntaxValid) {
        console.log(`  [SKIP] Candidate #${a.idx + 1}: syntax invalid — ${a.patch.validation.errors.join(", ")}`);
        continue;
      }
      const lines = a.patch.diff.split("\n");
      const adds = lines.filter((l) => l.startsWith("+")).length;
      const dels = lines.filter((l) => l.startsWith("-")).length;
      console.log(
        `  [OK]   Candidate #${a.idx + 1}: ${a.patch.filePath} +${adds}/-${dels} — "${a.patch.hypothesis.label.slice(0, 60)}"`,
      );
      validCandidates.push(a.patch);
    }

    if (validCandidates.length === 0) {
      console.log(`No valid patch candidates from ${topNHypotheses.length} hypotheses. Skipping bucket.`);
      allExperiments.push(await archiveSkipped(
        experimentId, iter + 1, bucket, currentBestScores,
        `${agentLabel}: 0 valid candidates from ${topNHypotheses.length} attempts`,
        iterStart, agentType,
      ));
      continue;
    }

    // ── Pairwise judging (skipped when only one valid candidate) ─────────
    let patch: PatchProposal;
    if (validCandidates.length === 1) {
      patch = validCandidates[0];
      console.log(`\nOnly 1 valid candidate — judge skipped.`);
    } else {
      console.log(`\nPairwise judging ${validCandidates.length} valid candidates...`);
      try {
        const judgeResult = await patchJudge.pickWinner(validCandidates, bucket);
        patch = judgeResult.winner;
        console.log(`  Judge scores: [${judgeResult.scores.map((s) => s.toFixed(1)).join(", ")}]`);
        for (const r of judgeResult.rationale) console.log(`    ${r}`);
      } catch (err: any) {
        console.warn(`  Judge failed: ${err.message}. Falling back to highest-confidence candidate.`);
        patch = [...validCandidates].sort(
          (a, b) => b.hypothesis.confidence - a.hypothesis.confidence,
        )[0];
      }
    }

    console.log(`\nWinner: "${patch.hypothesis.label}" (file: ${patch.filePath})`);
    console.log(`Diff preview:\n${patch.diff.slice(0, 500)}`);

    if (config.dryRun) {
      console.log("\n[DRY RUN] Skipping eval and git operations.");
      const log = buildExperimentLog(
        experimentId, iter + 1, bucket, patch.hypothesis, patch,
        currentBestScores, null, null, null, null,
        "skipped", "Dry run — patch not applied", iterStart, agentType,
      );
      const logPath = await saveExperiment(log);
      allExperiments.push(log);
      console.log(`Experiment log saved: ${logPath}`);
      console.log("\n" + formatExperimentSummary(log));
      continue;
    }

    // ── Apply patch ────────────────────────────────────────────────────
    console.log(`\n${agentLabel} applying winning patch...`);
    let appliedBranch: string;
    try {
      const result = await patcher.applyPatch(patch);
      appliedBranch = result.branch;
      console.log(`Patch applied on branch: ${appliedBranch}`);
    } catch (err: any) {
      console.error(`Failed to apply patch: ${err.message}`);
      allExperiments.push(await archiveSkipped(experimentId, iter + 1, bucket, currentBestScores, `${agentLabel}: failed to apply patch: ` + err.message, iterStart, agentType));
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

        // Strict-improvement gate: at least one more case must pass than before.
        // Replaces the old "no regression" rule that accepted no-op patches
        // (e.g., exp-2026-04-02-001 accepted with pass rate 0% → 0%).
        const subsetBeforePassed = countSubsetPassed(baselineReport, subsetCaseIds);
        const subsetAfterPassed = subsetReport.summary.passed;
        const subsetTotal = subsetCaseIds.size;
        const beforePct = subsetTotal > 0 ? (subsetBeforePassed / subsetTotal) * 100 : 0;
        const afterPct = subsetTotal > 0 ? (subsetAfterPassed / subsetTotal) * 100 : 0;

        subsetImproved = subsetAfterPassed > subsetBeforePassed;
        console.log(
          `Subset pass: ${subsetBeforePassed}/${subsetTotal} (${beforePct.toFixed(1)}%) -> ${subsetAfterPassed}/${subsetTotal} (${afterPct.toFixed(1)}%)`,
        );
        console.log(
          subsetImproved
            ? `Subset IMPROVED — at least one more case passing, proceeding to full regression.`
            : `Subset NO IMPROVEMENT — no-op or regression, rejecting patch.`,
        );
      } catch (err: any) {
        console.error(`Subset eval failed: ${err.message}`);
        allExperiments.push(await revertAndArchive(patcher, patch, experimentId, iter + 1, bucket, patch.hypothesis, currentBestScores, "Subset eval failed: " + err.message, iterStart, agentType));
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
        allExperiments.push(await revertAndArchive(patcher, patch, experimentId, iter + 1, bucket, patch.hypothesis, currentBestScores, "Full regression eval failed: " + err.message, iterStart, agentType));
        continue;
      }
    } else {
      console.log("\nSubset did not improve. Skipping full regression.");
      allExperiments.push(await revertAndArchive(patcher, patch, experimentId, iter + 1, bucket, patch.hypothesis, currentBestScores, "Subset eval showed regression", iterStart, agentType));
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
      experimentId, iter + 1, bucket, patch.hypothesis, patch,
      currentBestScores, afterScores, null, subsetAfterScores,
      gateResult, decision, gateResult.reason, iterStart, agentType,
    );

    const logPath = await saveExperiment(log);
    console.log(`\nExperiment log saved: ${logPath}`);

    allExperiments.push(log);
    if (gateResult.passed) {
      console.log(`\n${agentLabel}: change ACCEPTED. Branch: ${patch.branch}`);
      currentBestScores = afterScores!;
      acceptedExperiments.push(log);
    } else {
      console.log(`\n${agentLabel}: change REJECTED. Reverting...`);
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
      const agentName = exp.agent ? { prompt: "Prompt Agent", kb: "KB Agent", config: "Config Agent" }[exp.agent] : "Config Agent";
      console.log(`\n  Experiment: ${exp.experimentId}`);
      console.log(`  Agent: ${agentName}`);
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

  console.log(`\nAutoresearch v1 (with triage) complete.`);

  await maybeEmailSummary(config, allExperiments, baselineScores, currentBestScores, runStart);
}

// ── Email helper ────────────────────────────────────────────────────────────

async function maybeEmailSummary(
  config: AutoresearchConfig,
  experiments: ExperimentLog[],
  baselineScores: ScoreSnapshot,
  finalScores: ScoreSnapshot,
  runStart: number,
): Promise<void> {
  if (!config.emailRecipient) return;
  try {
    await emailAutoresearchSummary({
      experiments,
      baselineScores,
      finalScores,
      recipientEmail: config.emailRecipient,
      durationMs: Date.now() - runStart,
      runLabel: config.runLabel,
    });
  } catch (e: any) {
    console.error(`Email send failed (non-fatal): ${e.message}`);
  }
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

function countSubsetPassed(report: EvaluationReport, caseIds: Set<string>): number {
  return report.results.filter((r) => caseIds.has(r.testCaseId) && r.passed).length;
}

// ── Archive helpers ─────────────────────────────────────────────────────────

async function archiveSkipped(
  experimentId: string,
  iteration: number,
  bucket: FailureBucket,
  scores: ScoreSnapshot,
  reason: string,
  startTime: number,
  agent?: RepairAgentType,
): Promise<ExperimentLog> {
  const log: ExperimentLog = {
    experimentId,
    timestamp: new Date().toISOString(),
    iteration,
    agent,
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
  return log;
}

async function revertAndArchive(
  agentPatcher: { revertPatch(p: PatchProposal): Promise<void> },
  patch: PatchProposal,
  experimentId: string,
  iteration: number,
  bucket: FailureBucket,
  hypothesis: any,
  scores: ScoreSnapshot,
  reason: string,
  startTime: number,
  agent?: RepairAgentType,
): Promise<ExperimentLog> {
  try {
    await agentPatcher.revertPatch(patch);
  } catch (err: any) {
    console.warn(`Failed to revert patch: ${err.message}`);
  }

  const log = buildExperimentLog(
    experimentId, iteration, bucket, hypothesis, patch,
    scores, null, null, null, null,
    "rejected", reason, startTime, agent,
  );

  const logPath = await saveExperiment(log);
  console.log(`Experiment rejected and archived: ${logPath}`);
  return log;
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
  agent?: RepairAgentType,
): ExperimentLog {
  return {
    experimentId,
    timestamp: new Date().toISOString(),
    iteration,
    agent: agent ?? hypothesis?.agent,
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

  // LLM config for agent calls (prefer Gemini, fall back to Deepseek)
  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const deepseekApiKey =
    evalConfig.deepseekConfig?.apiKey || process.env.DEEPSEEK_API_KEY || "";

  let agentApiKey: string;
  let agentBaseURL: string;
  let agentModel: string;

  if (geminiApiKey) {
    agentApiKey = geminiApiKey;
    agentBaseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
    agentModel = process.env.AUTORESEARCH_MODEL || "gemini-2.0-flash";
    console.log(`Agent LLM: Gemini (${agentModel})`);
  } else if (deepseekApiKey) {
    agentApiKey = deepseekApiKey;
    agentBaseURL = evalConfig.deepseekConfig?.baseURL || "https://api.deepseek.com/v1";
    agentModel = evalConfig.deepseekConfig?.model || "deepseek-chat";
    console.log(`Agent LLM: Deepseek (${agentModel})`);
  } else {
    console.error("GEMINI_API_KEY or DEEPSEEK_API_KEY is required for autoresearch.");
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, "..", "..");
  const manifestPath = config.manifestPath;

  const researcher = new Researcher({
    manifestPath,
    repoRoot,
    deepseekApiKey: agentApiKey,
    deepseekBaseURL: agentBaseURL,
    model: agentModel,
  });

  const patcher = new Patcher({
    manifestPath,
    repoRoot,
    deepseekApiKey: agentApiKey,
    deepseekBaseURL: agentBaseURL,
    model: agentModel,
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
    const tag = b.clusterTag ? ` [${b.clusterTag}]` : "";
    console.log(`  [${b.severity}] ${b.failureType}${tag} — ${b.count} failures, ${b.affectedCaseIds.length} cases`);
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

    const bucketTag = bucket.clusterTag ? ` [${bucket.clusterTag}]` : "";
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Iteration ${iter + 1}/${maxIter}: ${bucket.failureType}${bucketTag} [${bucket.severity}]`);
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

      console.log(`Voice-ready: ${currentBestVoiceSnapshot.voiceReadyCount}/${currentBestVoiceSnapshot.totalTranscripts} -> ${afterVoiceSnapshot.voiceReadyCount}/${afterVoiceSnapshot.totalTranscripts}`);
      console.log(`Avg words: ${currentBestVoiceSnapshot.avgWordCount} -> ${afterVoiceSnapshot.avgWordCount}`);
      console.log(`Formatting issues: ${currentBestVoiceSnapshot.formattingIssueCount} -> ${afterVoiceSnapshot.formattingIssueCount}`);

      // Strict-improvement gate: at least one more transcript must be voice-ready.
      // Mirrors the gold subset gate; closes the no-op accept loophole.
      voiceImproved = afterVoiceSnapshot.voiceReadyCount > currentBestVoiceSnapshot.voiceReadyCount;
      console.log(
        voiceImproved
          ? `Voice IMPROVED — at least one more transcript voice-ready, proceeding to gold regression.`
          : `Voice NO IMPROVEMENT — no-op or regression, rejecting patch.`,
      );
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
