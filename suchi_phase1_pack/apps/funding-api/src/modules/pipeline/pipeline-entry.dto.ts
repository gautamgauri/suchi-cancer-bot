import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  IsArray,
  Min,
  Max,
  IsDateString,
} from "class-validator";

const STAGES = ["lead", "qualified", "proposal_sent", "won", "lost"] as const;

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

  @IsInt()
  @Min(1)
  version!: number;
}
