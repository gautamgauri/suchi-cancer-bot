import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

/**
 * Longest user message the pipeline sees on any channel: 4096 characters, the
 * same ceiling Meta enforces on an inbound WhatsApp text. It comfortably fits a
 * pasted pathology or lab report (typically 1 to 4k characters) while bounding
 * what a single request can push into retrieval embedding and the LLM prompt.
 *
 * Longer text is cut to this length on the server (boundUserText, called at
 * the top of ChatService.handle), the same as WhatsAppService.parseInbound and
 * the voice path do. A web request is not rejected for it: a 400 reached the
 * patient as a generic error, so a long message that opened with an emergency
 * got no safety reply (PR #202). The safety checks see the start of the text.
 */
export const MAX_USER_TEXT_LENGTH = 4096;

/**
 * Abuse ceiling for a web or app request: only text longer than this gets a
 * 400. Far above MAX_USER_TEXT_LENGTH, and small enough that Devanagari at the
 * limit (3 bytes a character) stays inside the default 100 kB JSON body limit.
 */
export const MAX_USER_TEXT_HARD_LIMIT = 20_000;

/** Cut text to MAX_USER_TEXT_LENGTH characters. Shorter text is returned unchanged. */
export function boundUserText(text: string): string {
  return typeof text === "string" && text.length > MAX_USER_TEXT_LENGTH ? text.slice(0, MAX_USER_TEXT_LENGTH) : text;
}

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
  @MaxLength(MAX_USER_TEXT_HARD_LIMIT, {
    message: `userText must be at most ${MAX_USER_TEXT_HARD_LIMIT} characters. Please shorten your message or split it into parts.`,
  })
  userText!: string;
}
