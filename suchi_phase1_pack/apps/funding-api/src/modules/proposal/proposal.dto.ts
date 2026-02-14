import { IsOptional, IsString, IsObject, IsArray, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class ApprovalActorDto {
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

export class GenerateProposalDto {
  @MinLength(1, { message: "opportunityId is required" })
  opportunityId!: string;

  @IsOptional()
  @IsObject()
  options?: {
    focusGeography?: string;
    targetGroup?: string;
    budgetCeiling?: string;
    dontMention?: string[];
    sectionOnly?: string;
  };

  @IsOptional()
  @ValidateNested()
  @Type(() => ApprovalContextDto)
  approval?: ApprovalContextDto;
}

export class RegenerateSectionDto {
  @IsOptional()
  @IsString()
  additionalContext?: string;

  @IsOptional()
  @IsString()
  userNotes?: string;
}

export class ExportProposalDto {
  @IsOptional()
  @IsString()
  format?: "docx" | "gdoc";
}
