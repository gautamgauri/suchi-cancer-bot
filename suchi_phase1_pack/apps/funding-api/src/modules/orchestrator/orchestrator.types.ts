/**
 * Types for the Proposal Orchestrator — "Gautam-style" gated pipeline.
 *
 * The orchestrator runs pre-drafting intelligence stages (fit scoring,
 * Gmail memory, budget envelope) before delegating to ProposalService.
 */

// --- Fit Scoring ---

export interface FitScoreDimension {
  name: string;
  score: number;
  maxScore: number;
  rationale: string;
}

export interface EnhancedFitScoreResult {
  totalScore: number;
  decision: "go" | "maybe" | "no";
  dimensions: {
    programAlignment: FitScoreDimension;
    strategicPlanFit: FitScoreDimension;
    strategicGapBonus: FitScoreDimension;
    evidenceStrength: FitScoreDimension;
    biharFeasibility: FitScoreDimension;
    budgetFit: FitScoreDimension;
  };
  gateAction: "proceed" | "proceed_with_caveats" | "park";
  caveats: string[];
}

// --- Gmail Memory ---

export interface ReusableBlock {
  source: string;
  topic: string;
  content: string;
  relevanceScore: number;
  date: string;
}

export interface GmailMemoryResult {
  blocksFound: number;
  blocks: ReusableBlock[];
  searchQueries: string[];
  searched: boolean;
}

// --- Budget Envelope ---

export interface BudgetLineItem {
  category: string;
  item: string;
  unitCostINR: number;
  unit: string;
  quantity: number;
  months: number;
  amount: number;
  notes: string;
  source: "registry" | "benchmark" | "estimated";
}

export interface BudgetEnvelope {
  targetCeilingINR: number;
  grantPeriodMonths: number;
  lineItems: BudgetLineItem[];
  subtotal: number;
  contingencyPercent: number;
  contingencyAmount: number;
  grandTotal: number;
  warnings: string[];
  unitCostFlags: string[];
}

// --- Deadline Check ---

export interface DeadlineCheckSummary {
  storedDeadline: string | null;
  storedConfidence: "verified" | "estimated" | "unknown";
  webFoundDeadline: string | null;
  match: "confirmed" | "mismatch" | "unverifiable" | "skipped";
  warning: string | null;
}

// --- Orchestrator State ---

export type OrchestratorStage =
  | "deadline_check"
  | "fit_scoring"
  | "gmail_memory"
  | "budget_envelope"
  | "web_evidence"
  | "proposal_generation"
  | "complete"
  | "parked"
  | "failed";

export interface WebEvidenceSummary {
  funderIntel: string;
  comparablePrograms: string;
  themeEvidence: string;
  sources: Array<{ title: string; uri: string }>;
  queriesUsed: number;
}

export interface OrchestratorRunState {
  opportunityId: string;
  stage: OrchestratorStage;
  deadlineCheck?: DeadlineCheckSummary;
  fitScore?: EnhancedFitScoreResult;
  gmailMemory?: GmailMemoryResult;
  budgetEnvelope?: BudgetEnvelope;
  webEvidence?: WebEvidenceSummary;
  proposalRunId?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// --- Context injected into existing proposal pipeline ---

export interface OrchestratorContext {
  fitScore?: {
    totalScore: number;
    decision: string;
    caveats: string[];
    dimensionSummary: string;
  };
  gmailMemoryBlocks?: Array<{
    topic: string;
    content: string;
    source: string;
  }>;
  budgetEnvelope?: {
    lineItems: Array<{
      category: string;
      item: string;
      unitCostINR: number;
      quantity: number;
      months: number;
      amount: number;
      notes: string;
    }>;
    targetCeilingINR: number;
    grandTotal: number;
  };
  webEvidence?: {
    funderIntel: string;
    comparablePrograms: string;
    themeEvidence: string;
    sources: Array<{ title: string; uri: string }>;
  };
}
