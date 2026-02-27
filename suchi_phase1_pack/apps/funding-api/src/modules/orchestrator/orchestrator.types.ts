/**
 * Types for the Proposal Orchestrator — "Gautam-style" gated pipeline.
 *
 * The orchestrator runs pre-drafting intelligence stages (fit scoring,
 * Gmail memory, budget envelope) before delegating to ProposalService.
 */

import type { ProjectCategory } from "../opportunity/opportunity.types";

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
  /** Primary budget anchor: cost per direct beneficiary per year (INR).
   * Derived from programme intensity — e.g. daily=20000, 2-3x/week=10000. */
  perChildCostPerYearINR: number;
  /** Programme intensity classification that drove the per-child cost. */
  programIntensity: "daily" | "frequent" | "weekly" | "periodic";
  /** Number of direct beneficiaries used to compute the anchor. */
  beneficiaryCount: number;
  /** Project category — drives framing for implementation plan and other sections. */
  projectCategory: ProjectCategory;
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
  | "size_mismatch"
  | "deadline_check"
  | "fit_scoring"
  | "gmail_memory"
  | "budget_envelope"
  | "web_evidence"
  | "proposal_generation"
  | "complete"
  | "parked"
  | "failed";

export interface SizeMismatchResult {
  /** What the funder requires as a minimum grant (INR, total over project period). */
  funderMinINR: number;
  /** What Diksha can absorb (maxAskINRPerYear × durationYears). */
  orgCapacityINR: number;
  /** funderMinINR / orgCapacityINR — e.g. 6.1 for Google.org at 18 months. */
  ratio: number;
  /** Decision choices surfaced to the user. */
  options: string[];
}

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
  sizeMismatch?: SizeMismatchResult;
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
  /** Project category — drives section framing (tech-product vs field-programme). */
  projectCategory?: ProjectCategory;
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
      unit: string;
      quantity: number;
      months: number;
      amount: number;
      notes: string;
    }>;
    targetCeilingINR: number;
    grandTotal: number;
    subtotal: number;
    contingencyAmount: number;
    grantPeriodMonths: number;
    perChildCostPerYearINR: number;
    programIntensity: "daily" | "frequent" | "weekly" | "periodic";
    beneficiaryCount: number;
    projectCategory?: ProjectCategory;
  };
  webEvidence?: {
    funderIntel: string;
    comparablePrograms: string;
    themeEvidence: string;
    sources: Array<{ title: string; uri: string }>;
  };
}
