export type PipelineStage =
  | "RFP_received"
  | "lead"
  | "qualified"
  | "proposal_sent"
  | "won"
  | "lost";

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
