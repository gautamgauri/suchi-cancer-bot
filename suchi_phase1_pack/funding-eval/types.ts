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
  | "approvals"
  | "safety";

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
    coverageScore: number;
    hardClaimCount: number;
    unsupportedHardClaimCount: number;
  };
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
}
