import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RunResult, CaseResult } from "../../evals/types";
import {
  type LoopFailureCluster,
  FAILURE_FILE_MAP,
  type LoopStateName,
  type QualityLoopState,
  type RepairPlan,
  type ScoreComparison,
  type ImprovementAction,
} from "./types";
import { formatApprovalEmail, formatComparisonEmail, sendNotification } from "./api-notifier";
import { applyFix } from "./executor";

// ── State persistence ────────────────────────────────────────────────────────

const LOOPS_DIR = path.resolve(__dirname, "..", "loops");

async function ensureLoopsDir(): Promise<void> {
  await fs.mkdir(LOOPS_DIR, { recursive: true });
}

function loopPath(loopId: string): string {
  return path.join(LOOPS_DIR, `${loopId}.json`);
}

export async function saveState(state: QualityLoopState): Promise<void> {
  await ensureLoopsDir();
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(loopPath(state.loopId), JSON.stringify(state, null, 2), "utf-8");
}

export async function loadState(loopId: string): Promise<QualityLoopState> {
  const raw = await fs.readFile(loopPath(loopId), "utf-8");
  return JSON.parse(raw) as QualityLoopState;
}

// ── Failure clustering ──────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 3,
  major: 2,
  minor: 1,
};

/** Classify failure code severity — safety failures are critical */
function classifySeverity(code: string): "critical" | "major" | "minor" {
  if (code.startsWith("SAFETY_")) return "critical";
  if (["CIT_ZERO", "SUPPORT_UNGROUNDED", "DISC_MISSING"].includes(code)) return "major";
  return "minor";
}

export function clusterFailures(cases: CaseResult[]): LoopFailureCluster[] {
  const map = new Map<string, LoopFailureCluster>();

  for (const c of cases) {
    if (c.passed) continue;

    for (const code of c.failureCodes) {
      const existing = map.get(code);
      if (existing) {
        existing.frequency++;
        existing.weightedScore = existing.frequency * SEVERITY_WEIGHT[existing.severity];
        if (!existing.affectedCaseIds.includes(c.caseId)) {
          existing.affectedCaseIds.push(c.caseId);
        }
      } else {
        const severity = classifySeverity(code);
        const failedGrader = c.grades.find((g) => !g.passed && g.reason === code);
        map.set(code, {
          code,
          severity,
          frequency: 1,
          weightedScore: SEVERITY_WEIGHT[severity],
          label: code.replace(/_/g, " ").toLowerCase(),
          sampleReason: failedGrader?.details ?? code,
          affectedCaseIds: [c.caseId],
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => b.weightedScore - a.weightedScore);
}

// ── Repair plan generation ──────────────────────────────────────────────────

/** Auto-generate improvement actions from the top failure cluster */
function generateActions(cluster: LoopFailureCluster): ImprovementAction[] {
  const actions: ImprovementAction[] = [];

  if (cluster.code.startsWith("SAFETY_")) {
    actions.push({
      priority: 1,
      action: "Strengthen safety guardrails to catch this pattern",
      effortEstimate: "medium",
      expectedImpact: `Eliminate ${cluster.code} failures across ${cluster.frequency} cases`,
      relatedFailureCodes: [cluster.code],
    });
  }

  if (cluster.code === "CIT_ZERO" || cluster.code === "CIT_ORPHAN") {
    actions.push({
      priority: 1,
      action: "Improve RAG retrieval to return more relevant chunks with citations",
      effortEstimate: "medium",
      expectedImpact: `Fix citation issues in ${cluster.frequency} cases`,
      relatedFailureCodes: [cluster.code],
    });
  }

  if (cluster.code === "DISC_MISSING") {
    actions.push({
      priority: 1,
      action: "Ensure medical disclaimer is always appended to responses",
      effortEstimate: "small",
      expectedImpact: `Add disclaimer to ${cluster.frequency} responses`,
      relatedFailureCodes: [cluster.code],
    });
  }

  if (cluster.code === "SUPPORT_UNGROUNDED") {
    actions.push({
      priority: 1,
      action: "Tighten LLM prompt to only make claims supported by retrieved KB chunks",
      effortEstimate: "medium",
      expectedImpact: `Ground claims in ${cluster.frequency} cases`,
      relatedFailureCodes: [cluster.code],
    });
  }

  // Fallback generic action
  if (actions.length === 0) {
    actions.push({
      priority: 1,
      action: `Investigate and fix ${cluster.code} failure pattern`,
      effortEstimate: "medium",
      expectedImpact: `Fix ${cluster.frequency} failing cases`,
      relatedFailureCodes: [cluster.code],
    });
  }

  return actions;
}

function buildRepairPlan(topCluster: LoopFailureCluster): RepairPlan {
  const actions = generateActions(topCluster);
  const estimatedFiles = FAILURE_FILE_MAP[topCluster.code] ?? [];

  const constraints = [
    `Target failure: ${topCluster.code} [${topCluster.severity}]`,
    `Affected cases: ${topCluster.affectedCaseIds.length}`,
    `Max files to modify: ${Math.max(estimatedFiles.length, 3)}`,
    "Do NOT weaken safety guardrails",
    "Do NOT remove medical disclaimers",
  ];

  return {
    targetCluster: topCluster,
    actions,
    scope: `Fix ${topCluster.code}: ${topCluster.sampleReason}`,
    estimatedFiles: estimatedFiles.slice(0, 3),
    constraints,
  };
}

// ── Score comparison ────────────────────────────────────────────────────────

function buildComparison(baseline: RunResult, rerun: RunResult): ScoreComparison {
  const baselineOverall = baseline.aggregate.overall;
  const rerunOverall = rerun.aggregate.overall;

  const perGrader: ScoreComparison["perGrader"] = [];
  const regressions: string[] = [];
  const improvements: string[] = [];

  const allGraders = new Set([
    ...Object.keys(baseline.aggregate.perGrader),
    ...Object.keys(rerun.aggregate.perGrader),
  ]);

  for (const grader of allGraders) {
    const bScore = baseline.aggregate.perGrader[grader]?.mean ?? 0;
    const rScore = rerun.aggregate.perGrader[grader]?.mean ?? 0;
    const delta = rScore - bScore;

    perGrader.push({ grader, baseline: bScore, rerun: rScore, delta });

    if (delta < -0.05) {
      regressions.push(
        `${grader}: ${(bScore * 100).toFixed(0)}% -> ${(rScore * 100).toFixed(0)}% (${(delta * 100).toFixed(1)}pp)`
      );
    } else if (delta > 0.05) {
      improvements.push(
        `${grader}: ${(bScore * 100).toFixed(0)}% -> ${(rScore * 100).toFixed(0)}% (+${(delta * 100).toFixed(1)}pp)`
      );
    }
  }

  return { baselineOverall, rerunOverall, delta: rerunOverall - baselineOverall, perGrader, regressions, improvements };
}

// ── Loop runner ─────────────────────────────────────────────────────────────

export interface RunEvalFn {
  (apiUrl: string, dataset: string): Promise<RunResult>;
}

export interface LoopRunnerOptions {
  apiUrl: string;
  dataset: string;
  loopId?: string;
  runEval: RunEvalFn;
}

export async function startLoop(opts: LoopRunnerOptions): Promise<QualityLoopState> {
  const now = new Date();
  const loopId =
    opts.loopId ??
    `loop-${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  const state: QualityLoopState = {
    loopId,
    state: "IDLE",
    apiBaseUrl: opts.apiUrl,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    evalOptions: {
      dataset: opts.dataset,
      apiUrl: opts.apiUrl,
      timeoutMs: 60_000,
    },
  };

  await saveState(state);
  console.log(`Loop created: ${loopId}`);

  return runToApproval(state, opts.runEval);
}

async function transition(state: QualityLoopState, to: LoopStateName): Promise<void> {
  console.log(`  ${state.state} -> ${to}`);
  state.state = to;
  await saveState(state);
}

async function runToApproval(
  state: QualityLoopState,
  runEval: RunEvalFn,
): Promise<QualityLoopState> {
  // RUN_EVALS
  await transition(state, "RUN_EVALS");
  try {
    state.baselineReport = await runEval(state.apiBaseUrl, state.evalOptions!.dataset);
    await saveState(state);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    await saveState(state);
    throw err;
  }

  // SCORE — clustering
  await transition(state, "SCORE");
  const clusters = clusterFailures(state.baselineReport.cases);
  state.failureClusters = clusters;
  await saveState(state);

  if (clusters.length === 0) {
    console.log("No failure clusters found. All cases pass.");
    await transition(state, "DONE");
    return state;
  }

  console.log(`\nFailure clusters (${clusters.length}):`);
  for (const c of clusters.slice(0, 5)) {
    console.log(`  [${c.severity}] ${c.code} — ${c.frequency} cases, score=${c.weightedScore}`);
  }

  // PLAN — build repair plan from top cluster
  await transition(state, "PLAN");
  state.repairPlan = buildRepairPlan(clusters[0]);
  await saveState(state);

  console.log(`\nRepair plan: ${state.repairPlan.scope}`);
  console.log(`  Files: ${state.repairPlan.estimatedFiles.join(", ")}`);
  console.log(`  Actions: ${state.repairPlan.actions.length}`);

  // WAIT_APPROVAL
  await transition(state, "WAIT_APPROVAL");

  try {
    const emailPayload = formatApprovalEmail(state);
    await sendNotification(state.apiBaseUrl, emailPayload);
    console.log("\nApproval email sent.");
  } catch (err) {
    console.warn("Failed to send approval email:", err instanceof Error ? err.message : String(err));
    console.log("(Continuing — approve via CLI)");
  }

  console.log(`\nWaiting for approval. Resume with:`);
  console.log(`  cd eval && npx ts-node cli.ts loop --resume ${state.loopId} --approve`);
  console.log(`  cd eval && npx ts-node cli.ts loop --resume ${state.loopId} --reject --reason "..."`);

  return state;
}

// ── Resume after approval ───────────────────────────────────────────────────

export async function resumeWithApproval(
  loopId: string,
  runEval: RunEvalFn,
): Promise<QualityLoopState> {
  const state = await loadState(loopId);

  if (state.state !== "WAIT_APPROVAL") {
    throw new Error(`Cannot approve loop in state ${state.state} (expected WAIT_APPROVAL)`);
  }

  state.approvalDecision = "approved";
  await saveState(state);

  // APPLY_FIX
  await transition(state, "APPLY_FIX");
  try {
    const result = await applyFix(state);
    state.fixBranch = result.branch;
    state.fixCommit = result.commit;
    await saveState(state);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    await saveState(state);
    throw err;
  }

  if (!state.fixCommit) {
    console.log("\nNo commit detected — manual fix needed.");
    console.log("After fixing, re-run:");
    console.log(`  cd eval && npx ts-node cli.ts loop --resume ${state.loopId} --approve`);
    return state;
  }

  // RERUN
  await transition(state, "RERUN");
  try {
    state.rerunReport = await runEval(state.apiBaseUrl, state.evalOptions!.dataset);
    await saveState(state);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    await saveState(state);
    throw err;
  }

  // COMPARE
  await transition(state, "COMPARE");
  state.comparison = buildComparison(state.baselineReport!, state.rerunReport!);
  await saveState(state);

  console.log(`\n=== Comparison ===`);
  console.log(`Baseline: ${(state.comparison.baselineOverall * 100).toFixed(0)}%`);
  console.log(`Re-run:   ${(state.comparison.rerunOverall * 100).toFixed(0)}%`);
  const deltaSign = state.comparison.delta >= 0 ? "+" : "";
  console.log(`Delta:    ${deltaSign}${(state.comparison.delta * 100).toFixed(1)}pp`);

  if (state.comparison.regressions.length > 0) {
    console.log(`\nRegressions (>5% drop):`);
    for (const r of state.comparison.regressions) console.log(`  ${r}`);
  }

  if (state.comparison.improvements.length > 0) {
    console.log(`\nImprovements (>5% gain):`);
    for (const i of state.comparison.improvements) console.log(`  ${i}`);
  }

  try {
    const emailPayload = formatComparisonEmail(state);
    await sendNotification(state.apiBaseUrl, emailPayload);
    console.log("\nComparison email sent.");
  } catch (err) {
    console.warn("Failed to send comparison email:", err instanceof Error ? err.message : String(err));
  }

  await transition(state, "DONE");
  console.log(`\nLoop complete: ${state.loopId}`);
  return state;
}

// ── Resume with rejection ───────────────────────────────────────────────────

export async function resumeWithRejection(
  loopId: string,
  reason?: string,
): Promise<QualityLoopState> {
  const state = await loadState(loopId);

  if (state.state !== "WAIT_APPROVAL") {
    throw new Error(`Cannot reject loop in state ${state.state} (expected WAIT_APPROVAL)`);
  }

  state.approvalDecision = "rejected";
  state.rejectionReason = reason;
  await transition(state, "REJECTED");

  console.log(`Loop rejected: ${state.loopId}`);
  if (reason) console.log(`Reason: ${reason}`);

  return state;
}

// ── Status display ──────────────────────────────────────────────────────────

export async function printStatus(loopId: string): Promise<void> {
  const state = await loadState(loopId);

  console.log(`\n=== Loop: ${state.loopId} ===`);
  console.log(`State: ${state.state}`);
  console.log(`API: ${state.apiBaseUrl}`);
  console.log(`Created: ${state.createdAt}`);
  console.log(`Updated: ${state.updatedAt}`);

  if (state.baselineReport) {
    console.log(`\nBaseline: ${state.baselineReport.aggregate.passRate * 100}% pass rate`);
    console.log(`  Overall: ${(state.baselineReport.aggregate.overall * 100).toFixed(0)}%`);
  }

  if (state.failureClusters && state.failureClusters.length > 0) {
    console.log(`\nTop failure: ${state.failureClusters[0].code} [${state.failureClusters[0].severity}]`);
  }

  if (state.repairPlan) {
    console.log(`\nRepair: ${state.repairPlan.scope}`);
    console.log(`  Files: ${state.repairPlan.estimatedFiles.join(", ")}`);
  }

  if (state.approvalDecision) {
    console.log(`\nApproval: ${state.approvalDecision}`);
    if (state.rejectionReason) console.log(`  Reason: ${state.rejectionReason}`);
  }

  if (state.fixBranch) console.log(`\nBranch: ${state.fixBranch}`);
  if (state.fixCommit) console.log(`Commit: ${state.fixCommit}`);

  if (state.comparison) {
    const d = state.comparison.delta >= 0 ? "+" : "";
    console.log(`\nComparison: ${d}${(state.comparison.delta * 100).toFixed(1)}pp`);
  }

  if (state.error) console.log(`\nError: ${state.error}`);
}
