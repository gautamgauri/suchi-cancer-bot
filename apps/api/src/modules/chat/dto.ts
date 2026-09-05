import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";

/** Channels that may enter the chat pipeline. Kept in sync with the @IsIn list below. */
export type ChatChannel = "web" | "app" | "whatsapp" | "voice";

export class ChatDto {
  @IsUUID() sessionId!: string;
  @IsString() @IsIn(["web","app","whatsapp","voice"]) channel!: ChatChannel;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() userType?: string;
  @IsString() userText!: string;
}
