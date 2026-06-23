/**
 * Response-language selection for symptom-related / personal-concern replies.
 *
 * Contract (reviewer-defined): reply in the user's dominant language —
 *   - English for English
 *   - Hindi (Devanagari) for Devanagari Hindi
 *   - simple Hinglish for Romanized Hindi or clearly mixed-language input
 *   - if unclear, use simple English and invite the user to choose Hindi or English
 * Commonly understood medical terms may be preserved in English where helpful.
 *
 * This module makes the *selection* deterministic and unit-testable; the
 * concrete directive is injected into the LLM prompt so behaviour is driven by
 * the rule, not left to the model to guess.
 */

export type ResponseLanguage = "en" | "hi" | "hinglish" | "unknown";

// Common Romanized-Hindi / Hinglish markers (Latin script). Intentionally broad
// but anchored on words unlikely to appear in ordinary English cancer questions.
const HINGLISH_MARKERS =
  /\b(mujhe|mujhko|mera|meri|mere|hai|hain|kya|kaise|kyun|nahi|nahin|dard|bukhar|khansi|khoon|gaanth|sujan|ilaaj|ilaj|tabiyat|theek|thik|sahab|sahib|kripya|batao|bataye|ho\s*raha|ho\s*gaya|ho\s*gayi|ke\s*baare)\b/i;

/** Pick the dominant response language for the given user text. */
export function selectResponseLanguage(text: string): ResponseLanguage {
  const t = (text ?? "").trim();
  if (!t) return "unknown";

  const devanagari = (t.match(/[ऀ-ॿ]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const total = devanagari + latin;
  if (total === 0) return "unknown"; // only digits / symbols

  const devRatio = devanagari / total;

  // Predominantly Devanagari → Hindi.
  if (devRatio >= 0.6) return "hi";

  // Both scripts present (and not Hindi-dominant) → clearly mixed → Hinglish.
  if (devanagari > 0 && latin > 0) return "hinglish";

  // All-Latin: Romanized-Hindi markers → Hinglish.
  if (HINGLISH_MARKERS.test(t)) return "hinglish";

  // All-Latin with enough alphabetic content and no Hindi markers → English.
  if (latin >= 3) return "en";

  // Too short / ambiguous to tell.
  return "unknown";
}

/** Concrete per-language instruction appended to the LLM prompt. */
export function responseLanguageDirective(lang: ResponseLanguage): string {
  switch (lang) {
    case "hi":
      return "LANGUAGE: Reply in Hindi (Devanagari script). You may keep commonly understood medical terms in English where that is clearer.";
    case "hinglish":
      return "LANGUAGE: Reply in simple Hinglish (Romanized Hindi in Latin script), the way people text. Keep commonly understood medical terms in English where that is clearer.";
    case "en":
      return "LANGUAGE: Reply in English.";
    default:
      return "LANGUAGE: Reply in simple English, and warmly invite the user to continue in Hindi or English, whichever they prefer.";
  }
}
