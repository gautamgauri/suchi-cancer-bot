import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";

/**
 * Abuse ceiling on every channel: the chat pipeline reads at most this many
 * characters, and one text value of that length flows through the whole turn,
 * as main does with the whole message (PR #202). When a message is longer,
 * its last SAFETY_TAIL_LENGTH characters are screened for safety as well.
 *
 * No request is refused for its length, since a 400 reaches the patient as a
 * generic error even when the first line is an emergency (PR #202, review N3). The Express JSON body limit (100 kB) stays
 * the hard bound on a web request. Devanagari at this length (3 bytes a
 * character) still fits inside it.
 */
export const MAX_USER_TEXT_HARD_LIMIT = 20_000;

/**
 * Cut text to at most `max` UTF-16 code units. A high surrogate left alone at
 * the cut (the first half of an emoji or other astral character) is dropped,
 * so the result is always well-formed. Shorter text is returned unchanged.
 */
export function cutToLength(text: string, max: number): string {
  if (typeof text !== "string" || text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
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
  userText!: string;
}
