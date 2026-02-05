import { IsIn, IsOptional, IsString } from "class-validator";
import { APPROVAL_STATUSES, DRAFT_ARTIFACT_TYPES } from "./approvals.types";

export class CreateArtifactDto {
  @IsString()
  pipelineEntryId!: string;

  @IsString()
  @IsIn(DRAFT_ARTIFACT_TYPES)
  type!: (typeof DRAFT_ARTIFACT_TYPES)[number];
}

export class CreateVersionDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class SubmitApprovalDto {
  @IsString()
  @IsIn(APPROVAL_STATUSES)
  status!: (typeof APPROVAL_STATUSES)[number];

  @IsOptional()
  @IsString()
  decidedBy?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
