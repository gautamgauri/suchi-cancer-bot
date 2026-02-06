import { IsString, IsArray, IsOptional, IsNumber } from "class-validator";

export class MelPackInputDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsArray()
  @IsString({ each: true })
  capabilities!: string[];

  @IsString()
  targetGroup!: string;

  @IsOptional()
  @IsString()
  geography?: string;
}

export class ProgramDesignInputDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsArray()
  @IsString({ each: true })
  capabilities!: string[];

  @IsArray()
  @IsString({ each: true })
  miModalities!: string[];

  @IsString()
  targetGroup!: string;

  @IsString()
  ageBand!: string;

  @IsString()
  setting!: string;

  @IsOptional()
  @IsNumber()
  durationWeeks?: number;

  @IsOptional()
  @IsNumber()
  sessionsPerWeek?: number;
}

export class ComparablesInputDto {
  @IsArray()
  @IsString({ each: true })
  capabilities!: string[];

  @IsString()
  targetGroup!: string;

  @IsOptional()
  @IsString()
  geographyConstraints?: string;
}

export class ConsistencyCheckInputDto {
  @IsString()
  draftText!: string;

  @IsArray()
  @IsString({ each: true })
  claimedCapabilities!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  claimedMIModalities?: string[];

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class RecommendationInputDto {
  @IsString()
  ageBand!: string;

  @IsString()
  setting!: string;

  @IsArray()
  @IsString({ each: true })
  capabilities!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  miModalities?: string[];
}
