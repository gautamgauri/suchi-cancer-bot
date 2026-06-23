/**
 * Shared text normalization for safety / policy pattern matching.
 *
 * Principle (Cluster C): a safety rule must fire regardless of script,
 * invisible characters, or spacing/punctuation variants. Language detection
 * must NEVER be a prerequisite for a guardrail firing. Every safety-relevant
 * matcher should run patterns against the output of this function.
 *
 * Pure and dependency-free so it can be reused by SafetyService,
 * OutputVerifierService, EmpathyDetector, and tests.
 *
 * Note: this normalizes a COPY for matching only — callers keep the original
 * text for display / auto-fix so we never mutate user- or model-facing content.
 */

// Zero-width / formatting characters that can be injected to evade matching:
// ZWSP, ZWNJ, ZWJ, word-joiner, ZWNBSP/BOM, soft hyphen, LRM, RLM.
const INVISIBLE_CHARS = /[​‌‍⁠﻿­‎‏]/g;

// Curly quotes / apostrophes -> straight, so English patterns written with a
// plain ' or " match regardless of the smart-quote variant the LLM produced.
const SMART_SINGLE = /[‘’‚‛′]/g; // ' ' ‚ ‛ ′
const SMART_DOUBLE = /[“”„‟″]/g; // " " „ ‟ ″

// Common Romanized medical-term spellings -> canonical English, so a guardrail
// or matcher keyed on the standard term also catches the WhatsApp transliteration
// (FR-1). Conservative: only unambiguous medical variants, matched whole-word.
const ROMANIZED_MEDICAL: Array<[RegExp, string]> = [
  [/\b(kainsar|kainser|kaincer|cainsar|kainsr)\b/gi, "cancer"],
  [/\b(keemo|kimo|kemo)\b/gi, "chemo"],
  [/\b(baipsi|bayopsi|biopsi|baayopsi)\b/gi, "biopsy"],
  [/\b(radiyeshan|rediyeshan|redieshan|radieshan)\b/gi, "radiation"],
  [/\b(tyumar|tumer|tumar)\b/gi, "tumor"],
];

export function normalizeForMatch(text: string | null | undefined): string {
  if (!text) return "";
  let t = text
    .normalize("NFC") // canonical composition (Devanagari combining marks, etc.)
    .replace(INVISIBLE_CHARS, "")
    .replace(SMART_SINGLE, "'")
    .replace(SMART_DOUBLE, '"')
    // Collapse 3+ repeated letters (Devanagari or Latin) — WhatsApp emphasis
    // typing like "dardddd" / "naheeee" — to a single letter. Legitimate doubles
    // ("maa", "gaanth") are 2 chars and untouched; digits are left alone so
    // phone/helpline numbers survive.
    .replace(/([A-Za-zऀ-ॿ])\1{2,}/g, "$1");
  for (const [re, canonical] of ROMANIZED_MEDICAL) t = t.replace(re, canonical);
  return t.replace(/\s+/g, " ").trim();
}
