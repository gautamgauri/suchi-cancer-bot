import { IsString, IsOptional, IsIn } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  chatSessionId: string;

  @IsString()
  messageId: string;
}

export class ApproveDto {
  @IsOptional()
  @IsString()
  approvedBy?: string;
}

export class RejectDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
