/**
 * Types for RAG + Reasoner proposal generation (aligned to product spec).
 */

export type ProposalRunStatus =
  | "pending"
  | "planning"
  | "drafting"
  | "qa"
  | "complete"
  | "failed";

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

export interface ProposalOutline {
  outline: OutlineSection[];
  retrieval_plan: RetrievalPlanItem[];
  compliance_checklist: ComplianceChecklistItem[];
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
  /** Framework capability context: align outline and retrieval to these capabilities */
  capabilityContext?: {
    primary: string[];
    secondary?: string[];
  };
}

export interface RegenerateSectionOptions {
  additionalContext?: string;
  userNotes?: string;
}
