export type PipelineStage =
  | "RFP_received"
  | "lead"
  | "qualified"
  | "proposal_sent"
  | "won"
  | "lost";

export type FundingLane = "DOMESTIC_80G" | "CSR" | "FCRA";

export const FUNDING_LANES: FundingLane[] = ["DOMESTIC_80G", "CSR", "FCRA"];

export interface PipelineEntry {
  id?: string;
  orgName: string;
  contactName?: string;
  contactEmail?: string;
  stage: PipelineStage;
  assignedTo?: string;
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
  fundingLane?: FundingLane;
  complianceRiskFlag?: string;
  bankRouteHint?: string;
  foreignSourceHint?: boolean;
  csr1Status?: string;
  csr1Number?: string;
  grantAgreementStatus?: string;
  reportingCadence?: string;
  ucDueDate?: string;
  impactReportDueDate?: string;
}

export interface NextBestActionSuggestion {
  title: string;
  reason: string;
  priority: "high" | "medium" | "low";
  targetStage?: PipelineStage;
}

export interface NextBestActionResult {
  entryId: string;
  orgName: string;
  stage: PipelineStage;
  generatedAt: string;
  suggestions: NextBestActionSuggestion[];
}

export interface WriteGuardBlockedResult {
  blocked: true;
  reason: string;
  approvalRequired: true;
  preview: Record<string, unknown>;
}

export type ActivityType =
  | "email_sent"
  | "call"
  | "meeting"
  | "proposal_submitted"
  | "note";

export interface ActivityPayload {
  donorId?: string;
  orgId?: string;
  type: ActivityType;
  notes?: string;
  timestamp?: string;
  createdBy?: string;
}

export interface ActivityRecord extends ActivityPayload {
  id: string;
  timestamp: string;
}
