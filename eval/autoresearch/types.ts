/**
 * Autoresearch v0 — Type definitions
 *
 * Types for the bounded self-improvement loop that proposes and tests
 * changes to the repairable surface.
 */

// ── Repair agent types ─────────────────────────────────────────────────────

/** Which specialized agent handles the repair */
export type RepairAgentType = "config" | "prompt" | "kb";

/** Triage decision: which agent should handle a failure bucket */
export interface TriageDecision {
  agent: RepairAgentType;
  confidence: number;
  reason: string;
  /** Hint files the agent should focus on */
  candidateFiles: string[];
}

// ── Failure mining ──────────────────────────────────────────────────────────

export type SeverityLevel = "P0" | "P1" | "P2";

export interface FailureBucket {
  /** Failure type label (e.g. "safety", "citation", "completeness", "tone") */
  failureType: string;
  /** Severity tier */
  severity: SeverityLevel;
  /** Affected eval case IDs */
  affectedCaseIds: string[];
  /** Count of failures in this bucket */
  count: number;
  /** Representative example: case ID + response excerpt + failure reason */
  representative: {
    caseId: string;
    query: string;
    responseExcerpt: string;
    failureReason: string;
  };
  /** Deterministic check IDs or LLM judge check IDs that failed */
  failedCheckIds: string[];
  /**
   * Cluster identifier shown in logs to disambiguate sub-buckets.
   * Set when the miner splits an oversized cluster (e.g., "has_citations (2/4)").
   */
  clusterTag?: string;
}

// ── Research / hypothesis ───────────────────────────────────────────────────

export interface Hypothesis {
  /** Short label for the hypothesis */
  label: string;
  /** Detailed explanation of root cause */
  rootCause: string;
  /** Proposed intervention text */
  intervention: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Risk assessment: how likely is regression */
  risk: "low" | "medium" | "high";
  /** Which repairable file to modify */
  repairableFile: string;
  /** Which section/region within the file */
  targetSection: string;
  /** Which agent generated this hypothesis */
  agent?: RepairAgentType;
}

// ── Patch ────────────────────────────────────────────────────────────────────

export interface PatchProposal {
  /** The repairable file path (relative to repo root) */
  filePath: string;
  /** The original content */
  originalContent: string;
  /** The proposed new content */
  proposedContent: string;
  /** Unified diff string */
  diff: string;
  /** The hypothesis that generated this patch */
  hypothesis: Hypothesis;
  /** Validation result */
  validation: {
    syntaxValid: boolean;
    errors: string[];
  };
  /** Git branch name for this experiment */
  branch: string;
}

// ── Gate check ──────────────────────────────────────────────────────────────

export interface GateResult {
  passed: boolean;
  checks: {
    name: string;
    passed: boolean;
    value: number;
    threshold: number;
    detail: string;
  }[];
  reason: string;
}

// ── Experiment archive ──────────────────────────────────────────────────────

export interface ExperimentLog {
  experimentId: string;
  timestamp: string;
  iteration: number;
  /** Which agent handled this experiment */
  agent?: RepairAgentType;
  failureCluster: FailureBucket;
  hypothesis: Hypothesis;
  patchDiff: string;
  repairableFile: string;
  beforeScores: ScoreSnapshot;
  afterScores: ScoreSnapshot | null;
  subsetBeforeScores: ScoreSnapshot | null;
  subsetAfterScores: ScoreSnapshot | null;
  gateResult: GateResult | null;
  decision: "accepted" | "rejected" | "skipped";
  reason: string;
  branch: string;
  durationMs: number;
}

export interface ScoreSnapshot {
  overall: number;
  passRate: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  citationCoverageRate: number;
  p0Failures: number;
  perCheck: Record<string, { passRate: number; count: number }>;
}

// ── Voice quality snapshot ──────────────────────────────────────────────────

export interface VoiceQualitySnapshot {
  /** Total transcripts evaluated */
  totalTranscripts: number;
  /** Count of voice-ready responses */
  voiceReadyCount: number;
  /** Voice-ready rate (0-1) */
  voiceReadyRate: number;
  /** Average word count across responses */
  avgWordCount: number;
  /** Count of responses exceeding voice word limit */
  tooLongCount: number;
  /** Count of responses with markdown/formatting issues */
  formattingIssueCount: number;
  /** Count of responses with unnatural/academic language */
  unnaturalLanguageCount: number;
}

// ── Runner config ───────────────────────────────────────────────────────────

export type AutoresearchMode = "gold" | "voice";

export interface AutoresearchConfig {
  /** Target: "all" runs the full loop; a cluster label targets a specific failure type */
  target: string;
  /** Maximum iterations per run (hard cap: 3) */
  maxIterations: number;
  /** Dry run: generate hypotheses and patches but do not apply or eval */
  dryRun: boolean;
  /** API base URL for running evals */
  apiBaseUrl: string;
  /** Path to gold eval cases YAML */
  goldCasesPath: string;
  /** Path to rubrics JSON */
  rubricsPath: string;
  /** Path to repairable manifest */
  manifestPath: string;
  /** Auth bearer token (optional) */
  authBearer?: string;
  /** Mode: "gold" (default) or "voice" */
  mode: AutoresearchMode;
  /** Path to voice transcript cases YAML (used when mode=voice) */
  voiceCasesPath?: string;
  /** Path to voice transcript report JSON (used when mode=voice) */
  voiceReportPath?: string;
  /** If set, email a run summary to this address at the end. */
  emailRecipient?: string;
  /** Optional label included in the email subject (e.g., "nightly", "manual"). */
  runLabel?: string;
  /**
   * Proposal mode: skip subset/regression/gate checks after patch application
   * and accept every syntax-valid judge-winner as a human-review candidate.
   * Used when the eval target (e.g., prod API) doesn't actually consume the
   * patched files at runtime, making post-patch evals meaningless. Each
   * accepted branch is pushed for human review.
   */
  proposalMode?: boolean;
}

// ── Runner state ────────────────────────────────────────────────────────────

export type AutoresearchPhase =
  | "INIT"
  | "MINE_FAILURES"
  | "RESEARCH"
  | "PROPOSE_PATCH"
  | "SUBSET_EVAL"
  | "FULL_REGRESSION"
  | "GATE_CHECK"
  | "ARCHIVE"
  | "HUMAN_APPROVAL"
  | "DONE"
  | "ABORTED";
