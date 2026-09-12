import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";

/** Channels that may enter the chat pipeline. Kept in sync with the @IsIn list below. */
export type ChatChannel = "web" | "app" | "whatsapp" | "voice";
/** Input modality (see ChatDto.inputMode). */
export type InputMode = "typed" | "voice";

export class ChatDto {
  @IsUUID() sessionId!: string;
  @IsString() @IsIn(["web","app","whatsapp","voice"]) channel!: ChatChannel;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() userType?: string;
  /**
   * How the text was produced, independent of channel. "voice" = speech
   * recognition output (browser Web Speech API on the web channel); the
   * `voice` channel is always spoken. Drives Phase 0 input cleanup: only spoken
   * text gets stutter/repeat/filler removal — typed Hinglish must not be
   * rewritten ("didi" -> "di", "papa" -> "pa", issue #115).
   */
  @IsOptional() @IsIn(["typed", "voice"]) inputMode?: InputMode;
  @IsString() userText!: string;
}
