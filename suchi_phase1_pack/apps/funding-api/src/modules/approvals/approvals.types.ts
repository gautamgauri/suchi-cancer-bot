export const DRAFT_ARTIFACT_TYPES = ["need_statement", "email"] as const;
export type DraftArtifactType = (typeof DRAFT_ARTIFACT_TYPES)[number];

export const APPROVAL_STATUSES = ["approved", "changes_requested"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface DraftArtifactRecord {
  id: string;
  pipelineEntryId: string;
  type: DraftArtifactType;
  createdAt: string;
}

export interface DraftVersionRecord {
  id: string;
  artifactId: string;
  content: string;
  createdBy?: string;
  createdAt: string;
  approval?: ApprovalRecord;
}

export interface ApprovalRecord {
  id: string;
  versionId: string;
  status: ApprovalStatus;
  decidedBy?: string;
  decidedAt: string;
  comment?: string;
}
