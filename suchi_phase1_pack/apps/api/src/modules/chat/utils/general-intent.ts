/**
 * Shared utility for detecting "generally asking" / general educational intent
 * Single source of truth to prevent inconsistency across modules
 */

export const GENERAL_INTENT_REGEX =
  /\b(generally asking|just asking|general question|not personal|educational|learning about|for awareness|information only)\b/i;

export function hasGeneralIntentSignal(text?: string | null): boolean {
  if (!text) return false;
  return GENERAL_INTENT_REGEX.test(text);
}

