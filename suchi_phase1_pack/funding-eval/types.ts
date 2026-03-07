/** Chunk shape used by draft/need-statement and email */
export interface EvidenceChunk {
  id: string;
  source: string;
  text: string;
  title?: string;
  urlOrPath?: string;
}

/** Conversation context for need statement */
export interface ConversationContext {
  funderName?: string;
  intent?: string;
  checklist?: string;
}

/** Pipeline entry create payload */
export interface PipelineEntryCreate {
  orgName: string;
  contactName?: string;
  contactEmail?: string;
  stage: string;
  owner?: string;
  nextAction?: string;
  nextActionDate?: string;
  lastContactDate?: string;
  probability?: number;
  notes?: string;
  sectorTags?: string[];
  geography?: string;
  estimatedGrantSize?: string;
  deadline?: string;
  submissionEmail?: string;
  driveFolderUrl?: string;
}

/** Pipeline entry update payload */
export interface PipelineEntryUpdate {
  orgName?: string;
  stage?: string;
  notes?: string;
  version: number;
  [key: string]: unknown;
}

/** Activity log payload */
export interface ActivityLogPayload {
  donorId?: string;
  orgId?: string;
  type: string;
  notes?: string;
  timestamp?: string;
  createdBy?: string;
}

/** Email draft payload */
export interface EmailDraftPayload {
  template: string;
  context: string;
  pipelineContext?: Record<string, string>;
  donorProfileSnippet?: string;
  chunks?: EvidenceChunk[];
}

/** Donor profile generate payload */
export interface DonorProfilePayload {
  orgName: string;
  urls?: string[];
  notes?: string;
  chunks?: Array<{ content: string; title?: string; url?: string }>;
}

/** Opportunity create payload */
export interface OpportunityCreatePayload {
  opportunityId: string;
  schemaVersion?: string;
  emailMessageId?: string;
  threadId?: string;
  driveFolderId?: string;
  driveFolderUrl?: string;
  jsonBlob: Record<string, unknown>;
  status?: string;
  missingInputs?: Array<{ field: string; question: string; priority: string }>;
  pipelineEntryId?: string;
}

/** Opportunity update payload */
export interface OpportunityUpdatePayload {
  status?: string;
  driveFolderId?: string;
  driveFolderUrl?: string;
  jsonBlob?: Record<string, unknown>;
  pipelineEntryId?: string;
}

/** Proposal generate payload */
export interface ProposalGeneratePayload {
  opportunityId: string;
  options?: {
    focusGeography?: string;
    targetGroup?: string;
    budgetCeiling?: string;
    dontMention?: string[];
    sectionOnly?: string;
  };
}

/** Framework retrieve payload */
export interface FrameworkRetrievePayload {
  capabilities?: string[];
  miModalities?: string[];
  cardTypes?: ("method" | "pattern" | "comparable")[];
  targetGroup?: string;
  ageBand?: string;
  setting?: string;
  limit?: number;
}

/** Evidence retrieve payload */
export interface EvidenceRetrievePayload {
  query: string;
  mode?: string;
  limit?: number;
  publicSafeOnly?: boolean;
  visibilityScope?: string;
}

/** Approvals artifact payload */
export interface ApprovalsArtifactPayload {
  pipelineEntryId: string;
  type: string;
}

/** Approvals version payload */
export interface ApprovalsVersionPayload {
  content: string;
  createdBy?: string;
}

/** Approvals submit payload */
export interface ApprovalsSubmitPayload {
  status: string;
  decidedBy?: string;
  comment?: string;
}

export type FundingCaseType =
  | "need_statement"
  | "need_statement_refine"
  | "donor_profile"
  | "pipeline_crud"
  | "activity_log"
  | "email_draft"
  | "opportunity_intake"
  | "proposal_generate"
  | "framework_retrieve"
  | "evidence_retrieve"
  | "evidence_recall"
  | "approvals"
  | "safety"
  | "orchestrator_e2e";

// ── Proposal suite types ────────────────────────────────────────────────────

export type ProposalCategory =
  | "tech_accelerator"
  | "fellowship"
  | "donor_chapter"
  | "partnership_pitch";

/** Test case for orchestrator E2E evaluation */
export interface OrchestratorE2ECase extends FundingTestCase {
  type: "orchestrator_e2e";
  proposalCategory: ProposalCategory;
  orchestratorOptions?: {
    focusGeography?: string;
    targetGroup?: string;
    budgetCeiling?: string;
    dontMention?: string[];
    sectionOnly?: string;
  };
  /** Category-specific rubric add-on checks to evaluate */
  categoryRubricAddOns?: string[];
  /** Expected output types (for partnership_pitch: concept_note, pitch_email, pilot_design) */
  expectedOutputs?: string[];
  /** Path to a reference proposal for comparison (relative to funding-eval/) */
  referenceProposalPath?: string;
  /** Category-specific thresholds */
  categoryExpectations?: {
    min_fit_score?: number;
    cross_section_threshold?: number;
    category_threshold?: number;
    min_sections?: number;
    min_evidence_chunks?: number;
    min_gmail_blocks?: number;
  };
}

/** Failure mode identified during diagnostic evaluation */
export interface FailureMode {
  id: string;
  severity: "critical" | "major" | "minor";
  stage: string;
  symptom: string;
  rootCause: string;
  affectedSections: string[];
}

/** Prioritized improvement action derived from failure modes */
export interface ImprovementAction {
  priority: number;
  action: string;
  expectedImpact: string;
  effortEstimate: "low" | "medium" | "high";
  relatedFailureModes: string[];
}

/** Per-category diagnostic result from the proposal diagnostic evaluator */
export interface ProposalDiagnosticResult {
  category: ProposalCategory;
  opportunityId: string;
  proposalRunId?: string;
  latencyMs: number;
  passed: boolean;

  /** Orchestrator stage results */
  orchestratorStages: {
    fitScore?: number;
    fitDecision?: string;
    gmailBlocks?: number;
    budgetEnvelope?: { total?: number; currency?: string; months?: number };
    webEvidenceChunks?: number;
    proposalSections?: number;
  };

  /** Core 7-dimension scorecard */
  coreScorecard: Array<{
    dimension: string;
    weight: number;
    passed: boolean;
    score: number;
    details: string[];
  }>;
  coreScore: number;

  /** Category-specific scorecard */
  categoryScorecard: Array<{
    checkId: string;
    passed: boolean;
    evidence?: string;
  }>;
  categoryScore: number;

  /** Per-section rubric results (reuse existing evaluator) */
  sectionResults?: Array<{
    sectionType: string;
    passed: boolean;
    score: number;
    failReasons: string[];
  }>;

  /** Failure modes diagnosed */
  failureModes: FailureMode[];

  /** Improvement plan */
  improvementPlan: ImprovementAction[];

  /** Raw error if orchestrator pipeline failed */
  error?: string;
}

/** Top-level report for the full proposal suite */
export interface ProposalSuiteReport {
  runAt: string;
  apiBaseUrl: string;
  totalCategories: number;
  passedCategories: number;
  failedCategories: number;
  categoryResults: ProposalDiagnosticResult[];
  crossCuttingSummary: {
    avgCoreScore: number;
    avgCategoryScore: number;
    commonFailureModes: Array<{ id: string; count: number }>;
    totalImprovementActions: number;
  };
  latencyMs: { total: number; perCategory: Record<string, number> };
}

export interface FundingTestCase {
  id: string;
  type: FundingCaseType;
  context?: string;
  userMessage?: string;
  chunks?: EvidenceChunk[];
  conversationContext?: ConversationContext;
  /** For CRUD/API cases: request body or params */
  body?: Record<string, unknown>;
  /** Query params e.g. status, limit */
  query?: Record<string, string | number>;
  /** Path param name to value, e.g. runId, id */
  params?: Record<string, string>;
  /** Sub-action for multi-step case types, e.g. "list" | "create" | "get" | "update" */
  action?: string;
  expectations?: {
    min_citations?: number;
    expect_abstain?: boolean;
    expect_status?: number;
    expect_placeholder?: boolean;
    expect_no_fabrication?: boolean;
    expect_createdBy?: boolean;
    expect_error?: boolean;
    expect_array?: boolean;
    expect_keys?: string[];
    /** v1 Citation Policy: require citation integrity validation */
    citation_integrity?: boolean;
    /** v1 Citation Policy: how to handle hard claims */
    hard_claim_policy?: "cite_or_placeholder_or_soften" | "cite_required" | "none";
    /** v1 Citation Policy: whether this task requires evidence (triggers MISSING_EVIDENCE on empty) */
    require_evidence?: boolean;
  };
}

export interface FundingCaseFile {
  cases: FundingTestCase[];
}

export interface FundingCaseResult {
  caseId: string;
  type: FundingCaseType;
  passed: boolean;
  citationCount: number;
  expectAbstain: boolean;
  abstainCorrect: boolean;
  latencyMs: number;
  error?: string;
  textPreview?: string;
  /** For CRUD: HTTP status or response shape check */
  responseStatus?: number;
  responsePreview?: string;
  /** Raw response for $ref resolution in subsequent cases */
  response?: unknown;
  /** v1 Citation Policy: integrity validation result */
  citationIntegrity?: {
    ok: boolean;
    invalidCitationCount: number;
    hardClaimCount: number;
    unsupportedHardClaimCount: number;
    placeholderCount: number;
    violations: string[];
  };
  /** Proposal-specific metrics (for proposal_generate cases) */
  proposalMetrics?: {
    totalSections: number;
    sectionsWithCitations: number;
    totalCitations: number;
    /** Citations that reference chunks in the section's retrieval provenance */
    validCitations: number;
    /** Citations that don't reference any retrieved chunk (bogus/fabricated) */
    invalidCitations: number;
    coverageScore: number;
    hardClaimCount: number;
    /** Hard claims with valid citation OR placeholder */
    supportedHardClaimCount: number;
    unsupportedHardClaimCount: number;
    /** Ratio of unsupported hard claims (0.0 = all supported, 1.0 = none supported) */
    unsupportedHardClaimRate: number;
  };
  /** Sprint 3 C4: Per-section LLM judge results */
  llmJudgeResults?: Array<{
    checkId: string;
    passed: boolean;
    skipped?: boolean;
    score?: number;
    count?: number;
    evidence?: string;
    error?: string;
    consensus?: string;
  }>;
}

export interface FundingEvalReport {
  runAt: string;
  apiBaseUrl: string;
  totalCases: number;
  passed: number;
  failed: number;
  citationCoverageRate: number;
  abstainCorrectnessRate: number;
  latencyMs: { p50: number; p95: number; mean: number };
  results: FundingCaseResult[];
  /** Fraction of non-evidence endpoints that did not invent metrics */
  fabricationRate?: number;
  /** Fraction of template drafts with proper placeholders */
  placeholderCompliance?: number;
  /** CRUD success rate (pipeline, opportunity, approvals) */
  crudSuccessRate?: number;
  /** Evidence retrieval precision (when gold queries used) */
  evidencePrecision?: number;
  /** v1 Citation Policy: citation integrity metrics */
  citationIntegrity?: {
    /** Cases with citation_integrity enabled */
    evaluatedCount: number;
    /** Cases that passed citation integrity */
    passedCount: number;
    /** Total invalid citations across all cases */
    totalInvalidCitations: number;
    /** Total hard claims across all cases */
    totalHardClaims: number;
    /** Total unsupported hard claims */
    totalUnsupportedHardClaims: number;
    /** Citation integrity pass rate */
    integrityRate: number;
  };
  /** Sprint 3 C4: LLM judge summary across all evaluated sections */
  llmJudgeSummary?: {
    evaluatedSections: number;
    passedSections: number;
    avgScore: number;
    costUsd: number;
    checkBreakdown: Record<string, { passed: number; failed: number; skipped: number }>;
  };
}
