import type { RunResult, CaseResult, FailureCluster } from "../../evals/types";

// ── State machine ────────────────────────────────────────────────────────────

export type LoopStateName =
  | "IDLE"
  | "RUN_EVALS"
  | "SCORE"
  | "PLAN"
  | "WAIT_APPROVAL"
  | "APPLY_FIX"
  | "RERUN"
  | "COMPARE"
  | "DONE"
  | "REJECTED";

// ── Failure clustering (extends evals/types FailureCluster) ─────────────────

export interface LoopFailureCluster {
  /** Failure code (e.g. "SAFETY_DIAG", "CIT_ZERO") */
  code: string;
  severity: "critical" | "major" | "minor";
  /** How many cases exhibited this failure */
  frequency: number;
  /** frequency x severity weight */
  weightedScore: number;
  /** Human-readable label */
  label: string;
  /** Representative failure reason from first occurrence */
  sampleReason: string;
  /** All affected case IDs */
  affectedCaseIds: string[];
}

/** Maps failure codes to likely source files in the Suchi codebase */
export const FAILURE_FILE_MAP: Record<string, string[]> = {
  SAFETY_DIAG: [
    "apps/api/src/modules/safety/safety.service.ts",
    "apps/api/src/modules/llm/llm.service.ts",
  ],
  SAFETY_DOSE: [
    "apps/api/src/modules/safety/safety.service.ts",
  ],
  SAFETY_PROG: [
    "apps/api/src/modules/safety/safety.service.ts",
  ],
  DISC_MISSING: [
    "apps/api/src/modules/llm/llm.service.ts",
    "apps/api/src/modules/chat/chat.service.ts",
  ],
  CIT_ZERO: [
    "apps/api/src/modules/rag/rag.service.ts",
    "apps/api/src/modules/chat/chat.service.ts",
  ],
  CIT_ORPHAN: [
    "apps/api/src/modules/rag/rag.service.ts",
  ],
  SUPPORT_UNGROUNDED: [
    "apps/api/src/modules/rag/rag.service.ts",
    "apps/api/src/modules/llm/llm.service.ts",
  ],
  DIRECT_ABSTAIN: [
    "apps/api/src/modules/chat/chat.service.ts",
    "apps/api/src/modules/rag/rag.service.ts",
  ],
  DIRECT_OVERASK: [
    "apps/api/src/modules/chat/chat.service.ts",
  ],
  COMPLETE_MISSING_SECTION: [
    "apps/api/src/modules/llm/llm.service.ts",
    "apps/api/src/modules/chat/chat.service.ts",
  ],
};

// ── Improvement action ──────────────────────────────────────────────────────

export interface ImprovementAction {
  priority: number;
  action: string;
  effortEstimate: "small" | "medium" | "large";
  expectedImpact: string;
  relatedFailureCodes: string[];
}

// ── Repair plan ─────────────────────────────────────────────────────────────

export interface RepairPlan {
  /** Top-1 failure cluster targeted by this repair */
  targetCluster: LoopFailureCluster;
  /** Actions to take */
  actions: ImprovementAction[];
  /** Human-readable scope description */
  scope: string;
  /** Files to modify (2-3 max) */
  estimatedFiles: string[];
  /** Safety constraints for the executor */
  constraints: string[];
}

// ── Score comparison ────────────────────────────────────────────────────────

export interface ScoreComparison {
  baselineOverall: number;
  rerunOverall: number;
  delta: number;
  perGrader: Array<{
    grader: string;
    baseline: number;
    rerun: number;
    delta: number;
  }>;
  regressions: string[];
  improvements: string[];
}

// ── Loop state ──────────────────────────────────────────────────────────────

export interface QualityLoopState {
  loopId: string;
  state: LoopStateName;
  apiBaseUrl: string;
  createdAt: string;
  updatedAt: string;

  /** Baseline eval report (after RUN_EVALS + SCORE) */
  baselineReport?: RunResult;

  /** Failure clusters ranked by severity x frequency */
  failureClusters?: LoopFailureCluster[];

  /** Repair plan for top-1 cluster (after PLAN) */
  repairPlan?: RepairPlan;

  /** Approval decision (after WAIT_APPROVAL) */
  approvalDecision?: "approved" | "rejected";
  rejectionReason?: string;

  /** Fix branch/commit (after APPLY_FIX) */
  fixBranch?: string;
  fixCommit?: string;

  /** Re-run eval report (after RERUN) */
  rerunReport?: RunResult;

  /** Before/after comparison (after COMPARE) */
  comparison?: ScoreComparison;

  /** Error if any state transition failed */
  error?: string;

  /** Eval runner options preserved for re-run */
  evalOptions?: {
    dataset: string;
    apiUrl: string;
    timeoutMs: number;
  };
}
