import { IsString, IsOptional, IsIn } from "class-validator";

const ACTIVITY_TYPES = ["email_sent", "call", "meeting", "proposal_submitted", "note"] as const;

export class LogActivityDto {
  @IsOptional()
  @IsString()
  donorId?: string;

  @IsOptional()
  @IsString()
  orgId?: string;

  @IsString()
  @IsIn(ACTIVITY_TYPES)
  type!: (typeof ACTIVITY_TYPES)[number];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  createdBy?: string;
}
