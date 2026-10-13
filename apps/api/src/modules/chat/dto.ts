import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

/**
 * Longest user message accepted on any channel: 4096 characters, the same
 * ceiling Meta enforces on an inbound WhatsApp text, so every channel accepts
 * the same maximum. It comfortably fits a pasted pathology / lab report
 * (typically 1-4k characters) while bounding what a single request can push
 * into retrieval embedding and the LLM prompt. Over-length web/app requests
 * get a 400 from the global ValidationPipe; WhatsApp inbound bypasses this DTO
 * and is truncated to the same value in WhatsAppService.parseInbound.
 */
export const MAX_USER_TEXT_LENGTH = 4096;

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
  @IsString()
  @MaxLength(MAX_USER_TEXT_LENGTH, {
    message: `userText must be at most ${MAX_USER_TEXT_LENGTH} characters — please shorten your message or split it into parts.`,
  })
  userText!: string;
}
