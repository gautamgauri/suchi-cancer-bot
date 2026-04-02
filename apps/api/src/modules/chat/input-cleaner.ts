/**
 * Cleans up voice input text before classification.
 *
 * The Web Speech API often produces stuttered or duplicated text when
 * interim results concatenate (e.g. "telltell me about").  This utility
 * normalises such artefacts so downstream intent classification and RAG
 * retrieval see clean input.
 */
export function cleanVoiceInput(text: string): string {
  let cleaned = text;

  // Fix stuttered word starts: "telltell me" → "tell me"
  // Pattern: a word fragment (2+ chars) immediately repeated without space
  cleaned = cleaned.replace(/\b(\w{2,})\1\b/gi, '$1');

  // Remove filler words (surrounded by whitespace or at boundaries)
  cleaned = cleaned.replace(/\s+\b(uh|um|uhh|umm|like|you know)\b\s+/gi, ' ');
  // Also handle filler words at the very start of the string
  cleaned = cleaned.replace(/^\s*\b(uh|um|uhh|umm|like|you know)\b\s+/gi, '');

  // Collapse repeated words: "symptoms symptoms" → "symptoms"
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1');

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  return cleaned.trim();
}
