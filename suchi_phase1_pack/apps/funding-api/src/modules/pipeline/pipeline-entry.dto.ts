import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  IsArray,
  Min,
  Max,
  IsDateString,
  IsBoolean,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { FUNDING_LANES } from "./pipeline.types";
import type { FundingLane } from "./pipeline.types";

const STAGES = ["RFP_received", "lead", "qualified", "proposal_sent", "won", "lost"] as const;

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

export class CreatePipelineEntryDto {
  @IsString()
  orgName!: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsString()
  @IsIn(STAGES)
  stage!: (typeof STAGES)[number];

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  nextAction?: string;

  @IsOptional()
  @IsDateString()
  nextActionDate?: string;

  @IsOptional()
  @IsDateString()
  lastContactDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sectorTags?: string[];

  @IsOptional()
  @IsString()
  geography?: string;

  @IsOptional()
  @IsString()
  estimatedGrantSize?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsString()
  submissionEmail?: string;

  @IsOptional()
  @IsString()
  driveFolderUrl?: string;

  @IsOptional()
  @IsString()
  @IsIn(FUNDING_LANES)
  fundingLane?: FundingLane;

  @IsOptional()
  @ValidateNested()
  @Type(() => ApprovalContextDto)
  approval?: ApprovalContextDto;
}

export class UpdatePipelineEntryDto {
  @IsOptional()
  @IsString()
  orgName?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @IsIn(STAGES)
  stage?: (typeof STAGES)[number];

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  nextAction?: string;

  @IsOptional()
  @IsDateString()
  nextActionDate?: string;

  @IsOptional()
  @IsDateString()
  lastContactDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sectorTags?: string[];

  @IsOptional()
  @IsString()
  geography?: string;

  @IsOptional()
  @IsString()
  estimatedGrantSize?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsString()
  submissionEmail?: string;

  @IsOptional()
  @IsString()
  driveFolderUrl?: string;

  @IsOptional()
  @IsString()
  @IsIn(FUNDING_LANES)
  fundingLane?: FundingLane;

  @IsOptional()
  @IsBoolean()
  foreignSourceHint?: boolean;

  @IsOptional()
  @IsString()
  csr1Status?: string;

  @IsOptional()
  @IsString()
  csr1Number?: string;

  @IsOptional()
  @IsString()
  grantAgreementStatus?: string;

  @IsOptional()
  @IsString()
  reportingCadence?: string;

  @IsOptional()
  @IsDateString()
  ucDueDate?: string;

  @IsOptional()
  @IsDateString()
  impactReportDueDate?: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ApprovalContextDto)
  approval?: ApprovalContextDto;
}

export class SetLaneDto {
  @IsString()
  @IsIn(FUNDING_LANES)
  lane!: FundingLane;

  @IsOptional()
  @ValidateNested()
  @Type(() => ApprovalContextDto)
  approval?: ApprovalContextDto;
}
