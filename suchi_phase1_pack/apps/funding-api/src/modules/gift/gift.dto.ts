import {
  IsString,
  IsOptional,
  IsIn,
  IsNumber,
  IsBoolean,
  IsDateString,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

const DONOR_TYPES = ["individual", "org"] as const;
const MODES = ["UPI", "NEFT", "card", "cheque", "cash"] as const;
const FUNDING_LANES = ["DOMESTIC_80G", "CSR", "FCRA"] as const;

export class CreateGiftDto {
  @IsString()
  donorName!: string;

  @IsString()
  @IsIn(DONOR_TYPES)
  donorType!: (typeof DONOR_TYPES)[number];

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount!: number;

  @IsDateString()
  dateReceived!: string;

  @IsString()
  @IsIn(MODES)
  mode!: (typeof MODES)[number];

  @IsOptional()
  @IsString()
  txnRef?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  mappedBankCredit?: boolean;

  @IsString()
  @IsIn(FUNDING_LANES)
  fundingLane!: (typeof FUNDING_LANES)[number];

  @IsOptional()
  @IsString()
  purposeRestriction?: string;

  @IsOptional()
  @IsString()
  fy?: string; // e.g. 2024-25; auto-derived from dateReceived if omitted

  @IsOptional()
  @IsString()
  pan?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactMobile?: string;
}
