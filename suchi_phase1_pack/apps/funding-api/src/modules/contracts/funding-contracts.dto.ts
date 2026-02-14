import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  APPROVAL_CONFIRMATION_OUTCOMES,
  DELIVERY_CHANNELS,
  WRITE_PREVIEW_ACTIONS,
} from "./funding-contracts.types";

export class ContractActorDto {
  @IsIn(["human", "agent", "system"])
  actorType!: "human" | "agent" | "system";

  @IsString()
  @MinLength(1)
  actorId!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

export class WritePreviewDto {
  @IsString()
  @MinLength(1)
  previewId!: string;

  @IsIn(WRITE_PREVIEW_ACTIONS)
  action!: (typeof WRITE_PREVIEW_ACTIONS)[number];

  @IsString()
  @MinLength(1)
  entityType!: string;

  @IsString()
  @MinLength(1)
  entityId!: string;

  @ValidateNested()
  @Type(() => ContractActorDto)
  actor!: ContractActorDto;

  @IsString()
  @MinLength(1)
  reason!: string;

  @IsISO8601()
  timestamp!: string;

  @IsOptional()
  @IsObject()
  before?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  after?: Record<string, unknown> | null;
}

export class ApprovalConfirmationDto {
  @IsString()
  @MinLength(1)
  approvalToken!: string;

  @IsString()
  @MinLength(1)
  interactionId!: string;

  @IsIn(APPROVAL_CONFIRMATION_OUTCOMES)
  outcome!: (typeof APPROVAL_CONFIRMATION_OUTCOMES)[number];

  @ValidateNested()
  @Type(() => ContractActorDto)
  actor!: ContractActorDto;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsISO8601()
  timestamp!: string;
}

export class InternalDeliveryGuardCheckDto {
  @IsIn(DELIVERY_CHANNELS)
  medium!: (typeof DELIVERY_CHANNELS)[number];

  @ValidateNested()
  @Type(() => ContractActorDto)
  requestedBy!: ContractActorDto;

  @IsString()
  @MinLength(1)
  reason!: string;

  @IsISO8601()
  timestamp!: string;

  @IsOptional()
  @IsString()
  slackChannelId?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  emailRecipients?: string[];
}
