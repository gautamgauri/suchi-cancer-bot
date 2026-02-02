import { IsString, IsArray, IsOptional, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class DonorProfileChunkDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  url?: string;
}

export class GenerateProfileDto {
  @IsString()
  orgName!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  urls?: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DonorProfileChunkDto)
  chunks?: DonorProfileChunkDto[];
}
