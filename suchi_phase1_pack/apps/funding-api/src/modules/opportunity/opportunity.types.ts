/**
 * Types aligned to BRD Opportunity JSON (schemaVersion 1.0).
 * Used for validation and API responses; full payload stored in Opportunity.jsonBlob.
 */

export interface OpportunitySourceAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  driveFileId?: string;
  driveUrl?: string;
  checksum?: string;
}

export interface OpportunitySource {
  emailMessageId: string;
  threadId: string;
  receivedAt: string;
  from: { name?: string; email: string };
  to: string[];
  cc?: string[];
  subject: string;
  bodyHash?: string;
  attachments: OpportunitySourceAttachment[];
}

export interface OpportunityFunder {
  name: string;
  programName?: string;
  grantCycle?: string;
  funderType?: string;
  submissionEmail?: string;
}

export interface OpportunityKeyConstraints {
  maxGrantAmountINR?: number;
  /** Minimum total grant amount the proposal should request.
   * Budget envelope will scale up if bottom-up calculation falls below this floor.
   * Use this when you know the real program cost (e.g. 30L/centre × 3 centres = 90L).
   */
  minGrantAmountINR?: number;
  projectDurationMonthsMax?: number;
  deadline?: string;
  /** Confidence level for the stored deadline value.
   * "verified"  — explicit date from RFP or confirmed source URL
   * "estimated" — inferred from vague language or manually entered
   * "unknown"   — manually loaded or no source; must be web-verified before submitting
   */
  deadlineConfidence?: "verified" | "estimated" | "unknown";
  deadlineNote?: string;
  geography?: string[];
}

export interface OpportunityThemes {
  primary?: string[];
  secondary?: string[];
}

export interface OpportunityRequiredTemplate {
  templateName: string;
  sourceFile: string;
  driveFileId?: string;
  outputArtifact: "doc" | "sheet";
}

export interface RfpSectionRequirement {
  name: string;
  targetWords?: number;
  mustAnswer?: string[];
}

export interface OpportunityExtractedRequirements {
  summary?: string;
  scoringSignals?: string[];
  reportingCadence?: string;
  mandatorySections?: string[];
  complianceDocuments?: string[];
  /** Parsed RFP sections with word limits and must-answer questions */
  sections?: RfpSectionRequirement[];
  /** Evaluation/scoring criteria from RFP */
  evaluationCriteria?: string[];
  /** Mandatory annexures/attachments required */
  mandatoryAnnexures?: string[];
  /** Structured submission checklist extracted from RFP text */
  submissionChecklist?: OpportunitySubmissionChecklist;
}

export interface OpportunityInternalPerson {
  name: string;
  email: string;
  role?: string;
}

export interface OpportunityDriveFolder {
  path: string;
  driveFolderId?: string;
  driveUrl?: string;
}

export interface OpportunityInternal {
  org?: string;
  owner?: OpportunityInternalPerson;
  reviewers?: OpportunityInternalPerson[];
  pipelineStage?: string;
  priority?: string;
  driveFolder?: OpportunityDriveFolder;
}

export interface OpportunityAutomationAction {
  type: string;
  status: string;
}

export interface OpportunityMissingInput {
  field: string;
  question: string;
  priority: "high" | "medium" | "low";
}

export interface OpportunityAutomationPlan {
  actions?: OpportunityAutomationAction[];
  missingInputs?: OpportunityMissingInput[];
}

export type FcraRelevance = "required" | "mentioned" | "not_mentioned";
export type FitBand = "strong_fit" | "moderate_fit" | "weak_fit" | "unknown";

export interface OpportunityCard {
  funder: string;
  program?: string;
  deadline?: string;
  eligibilitySummary?: string;
  fcraRelevance: FcraRelevance;
  geographyFit: FitBand;
  thematicFit: FitBand;
  sourceLink?: string;
  confidence: number;
}

export interface OpportunityFitAssessment {
  score: number;
  reasons: string[];
  confidence: number;
  missingInfo?: OpportunityMissingInput[];
}

export interface OpportunityChecklistItem {
  key: string;
  label: string;
  required: boolean;
  evidence?: string;
}

export interface OpportunityWordLimitRequirement {
  section: string;
  limitWords: number;
  evidence?: string;
}

export interface OpportunitySubmissionChecklist {
  wordLimits: OpportunityWordLimitRequirement[];
  attachments: string[];
  budgetFormat?: string;
  submissionMode?: string;
  annexures: string[];
  items: OpportunityChecklistItem[];
}

export interface OpportunityAudit {
  createdAt: string;
  createdBy: string;
  lastUpdatedAt: string;
  lastUpdatedBy: string;
}

export interface OpportunityPayload {
  opportunityId: string;
  dedupeKey?: string;
  sourceType?: string;
  source: OpportunitySource;
  funder: OpportunityFunder;
  keyConstraints?: OpportunityKeyConstraints;
  themes?: OpportunityThemes;
  triageCard?: OpportunityCard;
  fitAssessment?: OpportunityFitAssessment;
  eligibility?: { notes?: string; mustHaves?: string[]; niceToHaves?: string[]; exclusions?: string[] };
  requiredTemplates?: OpportunityRequiredTemplate[];
  extractedRequirements?: OpportunityExtractedRequirements;
  internal?: OpportunityInternal;
  automationPlan?: OpportunityAutomationPlan;
  audit?: OpportunityAudit;
}

export interface OpportunityDocument {
  schemaVersion: string;
  opportunity: OpportunityPayload;
}
