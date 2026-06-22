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

export function normalizeForMatch(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .normalize("NFC") // canonical composition (Devanagari combining marks, etc.)
    .replace(INVISIBLE_CHARS, "")
    .replace(SMART_SINGLE, "'")
    .replace(SMART_DOUBLE, '"')
    .replace(/\s+/g, " ") // collapse all whitespace (incl. newlines + NBSP) to a single space
    .trim();
}
