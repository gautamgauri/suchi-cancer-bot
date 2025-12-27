import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";
export class ChatDto {
  @IsUUID() sessionId!: string;
  @IsString() @IsIn(["web","app","whatsapp"]) channel!: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() userType?: string;
  @IsString() userText!: string;
}
