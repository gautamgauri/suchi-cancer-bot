import { IsString, IsArray, IsOptional, ValidateNested, IsIn } from "class-validator";
import { Type } from "class-transformer";

export const EMAIL_TEMPLATES = ["intro", "follow_up", "meeting_request", "proposal_nudge", "thank_you"] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export class PipelineContextDto {
  @IsOptional()
  @IsString()
  orgName?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @IsString()
  nextAction?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ChunkDto {
  @IsString()
  id!: string;

  @IsString()
  source!: string;

  @IsString()
  text!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  section?: string;

  @IsOptional()
  @IsString()
  urlOrPath?: string;
}

export class ConversationContextDto {
  @IsOptional()
  @IsString()
  funderName?: string;

  @IsOptional()
  @IsString()
  intent?: string;

  @IsOptional()
  @IsString()
  checklist?: string;
}

export class ApprovalActorDto {
  @IsString()
  actorType!: "human" | "agent" | "system";

  @IsString()
  actorId!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

export class ApprovalContextDto {
  @IsString()
  approvalToken!: string;

  @IsOptional()
  @IsString()
  interactionId?: string;

  @IsOptional()
  @IsString()
  outcome?: "approved" | "rejected" | "expired" | "cancelled";

  @IsOptional()
  @ValidateNested()
  @Type(() => ApprovalActorDto)
  actor?: ApprovalActorDto;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class DraftNeedStatementDto {
  @IsString()
  context!: string;

  @IsString()
  userMessage!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChunkDto)
  chunks!: ChunkDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationContextDto)
  conversationContext?: ConversationContextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ApprovalContextDto)
  approval?: ApprovalContextDto;
}

export class DraftEmailDto {
  @IsString()
  @IsIn(EMAIL_TEMPLATES)
  template!: EmailTemplate;

  @IsString()
  context!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineContextDto)
  pipelineContext?: PipelineContextDto;

  @IsOptional()
  @IsString()
  donorProfileSnippet?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChunkDto)
  chunks?: ChunkDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ApprovalContextDto)
  approval?: ApprovalContextDto;
}
