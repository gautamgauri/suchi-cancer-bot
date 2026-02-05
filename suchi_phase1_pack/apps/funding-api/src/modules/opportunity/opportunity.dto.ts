import { IsString, IsOptional, IsArray, IsObject, IsIn } from "class-validator";

const STATUSES = [
  "received",
  "extracted",
  "draft_generated",
  "blocked_missing_inputs",
] as const;

export class CreateOpportunityDto {
  @IsString()
  opportunityId!: string;

  @IsOptional()
  @IsString()
  schemaVersion?: string;

  @IsOptional()
  @IsString()
  emailMessageId?: string;

  @IsOptional()
  @IsString()
  threadId?: string;

  @IsOptional()
  @IsString()
  driveFolderId?: string;

  @IsOptional()
  @IsString()
  driveFolderUrl?: string;

  @IsObject()
  jsonBlob!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsArray()
  missingInputs?: Array<{ field: string; question: string; priority: string }>;

  @IsOptional()
  @IsString()
  pipelineEntryId?: string;
}

export class UpdateOpportunityDto {
  @IsOptional()
  @IsString()
  driveFolderId?: string;

  @IsOptional()
  @IsString()
  driveFolderUrl?: string;

  @IsOptional()
  @IsObject()
  jsonBlob?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsArray()
  missingInputs?: Array<{ field: string; question: string; priority: string }>;

  @IsOptional()
  @IsString()
  pipelineEntryId?: string;
}

export class ListOpportunitiesQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
