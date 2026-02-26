import { IsString, MinLength, IsOptional, IsBoolean, IsObject } from "class-validator";

export class OrchestratorRunDto {
  @IsString()
  @MinLength(1)
  opportunityId!: string;

  @IsOptional()
  @IsBoolean()
  skipGmail?: boolean;

  @IsOptional()
  @IsBoolean()
  skipBudget?: boolean;

  @IsOptional()
  @IsBoolean()
  skipWebEvidence?: boolean;

  @IsOptional()
  @IsBoolean()
  forceGenerate?: boolean;

  @IsOptional()
  @IsObject()
  proposalOptions?: {
    focusGeography?: string;
    targetGroup?: string;
    budgetCeiling?: string;
    dontMention?: string[];
    sectionOnly?: string;
    skipFramework?: boolean;
  };
}

export class OrchestratorAssessDto {
  @IsString()
  @MinLength(1)
  opportunityId!: string;
}
