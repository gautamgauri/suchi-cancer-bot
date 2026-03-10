import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";
export class FeedbackDto {
  @IsUUID() sessionId!: string;
  @IsOptional() @IsUUID() messageId?: string;
  @IsString() @IsIn(["up","down"]) rating!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() comment?: string;
}
