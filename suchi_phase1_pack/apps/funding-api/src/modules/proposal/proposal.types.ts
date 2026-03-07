/**
 * Types for RAG + Reasoner proposal generation (aligned to product spec).
 */

export type ProposalRunStatus =
  | "pending"
  | "planning"
  | "drafting"
  | "qa"
  | "complete"
  | "failed"
  | "blocked_missing_inputs";

export type ProposalSectionStatus =
  | "pending"
  | "retrieved"
  | "drafted"
  | "reviewed";

export interface OutlineSection {
  section: string;
  target_words: number;
  must_answer: string[];
  /** Capability codes (e.g. C4, C6) this section should address when using framework */
  capability_focus?: string[];
}

export interface RetrievalPlanItem {
  section: string;
  query_intents: string[];
  required_evidence_types: string[];
  /** Capability codes to align retrieval (Nussbaum C1–C10) */
  capability_focus?: string[];
}

export interface ComplianceChecklistItem {
  item: string;
  source: string;
  status: string;
}

export interface ProposalScopeCenter {
  name: string;
  location?: string | null;
  targetGroup?: string | null;
}

export interface ProposalScopeDeliverable {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  frequency?: string | null;
}

export interface ProposalScopeMissingInput {
  field: string;
  reason: string;
  severity: "low" | "medium" | "high";
}

export interface ProposalScope {
  programName: string;
  centers: ProposalScopeCenter[];
  totalDirectBeneficiaries: string;
  totalIndirectBeneficiaries?: string;
  geographicScope: string;
  grantPeriod: string | { start?: string | null; end?: string | null };
  budgetCeiling?: string;
  deliverables: ProposalScopeDeliverable[];
  staffing?: { totalStaff?: number | null; keyRoles?: string[] };
  assumptions?: string[];
  constraints?: string[];
  missing_inputs?: ProposalScopeMissingInput[];

  /** @deprecated Use deliverables instead */
  keyDeliverables?: string[];
}

export interface ProposalOutline {
  outline: OutlineSection[];
  retrieval_plan: RetrievalPlanItem[];
  compliance_checklist: ComplianceChecklistItem[];
  /** Canonical scope extracted by planner — injected into every section writer call */
  proposal_scope?: ProposalScope;
  /** Inferred or confirmed primary capabilities (C1–C10) when framework is used */
  suggested_primary_capabilities?: string[];
  /** Inferred or confirmed secondary capabilities when framework is used */
  suggested_secondary_capabilities?: string[];
}

export interface RetrievedChunkRef {
  chunkId: string;
  docId: string;
  score?: number;
}

export interface CitationRef {
  chunkId: string;
  docId: string;
  inlineMarker: string;
}

export interface ProposalRunModelConfig {
  planner?: string;
  writer?: string;
  reviewer?: string;
  retriever?: string;
}

export interface ProposalRunArtifacts {
  driveFolderId?: string;
  driveFolderUrl?: string;
  docId?: string;
  docUrl?: string;
  evidencePackId?: string;
  runLogFileId?: string;
  complianceReportFileId?: string;
}

export interface QaReviewResult {
  coverage_score: number;
  missing_requirements: string[];
  ungrounded_claims: Array<{
    text: string;
    location: string;
    suggestion: string;
  }>;
  inconsistencies: Array<{ type: string; detail: string }>;
  revision_plan: Array<{
    section: string;
    action: string;
    needed_evidence: string[];
  }>;
}

export interface ProposalGap {
  field?: string;
  section?: string;
  question: string;
  priority?: "high" | "medium" | "low";
}

export interface GenerateProposalOptions {
  focusGeography?: string;
  targetGroup?: string;
  budgetCeiling?: string;
  dontMention?: string[];
  /** If set, only draft this section (e.g. "M&E") */
  sectionOnly?: string;
  /** Skip framework intelligence gathering */
  skipFramework?: boolean;
  /** Framework capability context: align outline and retrieval to these capabilities */
  capabilityContext?: {
    primary: string[];
    secondary?: string[];
  };
}

export interface FunderPriorityProfile {
  primaryCapabilities: string[];
  secondaryCapabilities: string[];
  themes: string[];
  preferredEvidenceTypes: string[];
  targetDemographics: Record<string, unknown>;
  suggestedMIModalities: string[];
}

export interface FrameworkIntelligencePack {
  funderProfile: FunderPriorityProfile;
  methodCards: Array<{ title: string; description: string; capabilities: string[] }>;
  patternCards: Array<{ title: string; description: string }>;
  comparableCases: Array<{ programName: string; outcomes: string; geography: string }>;
  comparablesParagraph: string;
  transferabilityNotes: string;
  programDesign: {
    theoryOfChange: {
      inputs: string[];
      activities: string[];
      outputs: string[];
      outcomes: string[];
      impact: string;
    };
    activityBlocks: Array<{ weekRange: string; theme: string; capabilityFocus: string[] }>;
    gaps: string[];
  } | null;
  melPack: {
    capabilityIndicators: Array<{
      capability: string;
      indicators: Array<{ type: string; indicator: string; frequency: string; tool: string }>;
    }>;
  } | null;
}

export interface RegenerateSectionOptions {
  additionalContext?: string;
  userNotes?: string;
}
