import { IsOptional, IsString, IsObject, IsArray, MinLength } from "class-validator";

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
