/**
 * Disclaimer Engine
 * Phase 1: Deterministic Shell component
 *
 * Auto-appends medical disclaimers in the user's detected language
 * to every response. Template-based, zero LLM calls, non-removable.
 *
 * Design principle: This is the last step before a response is returned
 * to the user. It cannot be overridden by the adaptive core.
 *
 * REPAIRABLE SURFACE: Canonical templates at repairable/config/disclaimer.json
 * Future: disclaimer templates will be read from that file instead of hardcoding.
 */

export type SupportedLocale = "en" | "hi" | "bh" | "mai";

/**
 * Disclaimer templates per language.
 * Each has: standard (for education/navigation) and safety (for emergency/urgent).
 */
const DISCLAIMERS: Record<SupportedLocale, { standard: string; safety: string }> = {
  en: {
    standard:
      "\n\n---\n*This information is for general educational purposes only and is not a substitute for professional medical advice, diagnosis, or treatment. Always consult your healthcare provider for personalized guidance.*",
    safety:
      "\n\n---\n*If this is a medical emergency, call 112 or 108 immediately. This information does not replace emergency medical care.*",
  },
  hi: {
    standard:
      "\n\n---\n*यह जानकारी केवल सामान्य शैक्षिक उद्देश्यों के लिए है और पेशेवर चिकित्सा सलाह, निदान या उपचार का विकल्प नहीं है। व्यक्तिगत मार्गदर्शन के लिए हमेशा अपने डॉक्टर से परामर्श करें।*",
    safety:
      "\n\n---\n*अगर यह आपातकालीन स्थिति है तो तुरंत 112 या 108 पर कॉल करें। यह जानकारी आपातकालीन चिकित्सा सेवा का विकल्प नहीं है।*",
  },
  bh: {
    // Bhojpuri — uses Hindi script with Bhojpuri phrasing
    standard:
      "\n\n---\n*ई जानकारी सिर्फ जानकारी खातिर बा, डॉक्टर के सलाह के बदले नइखे। अपना डॉक्टर से ज़रूर मिलीं।*",
    safety:
      "\n\n---\n*अगर इमरजेंसी बा त तुरंत 112 या 108 पर फोन करीं। ई जानकारी इमरजेंसी इलाज के जगह नइखे ले सकत।*",
  },
  mai: {
    // Maithili — uses Hindi script with Maithili phrasing
    standard:
      "\n\n---\n*ई जानकारी सामान्य शिक्षा लेल अछि, डॉक्टरक सलाहक बदला मे नहि। अपन डॉक्टर सँ अवश्य भेट करू।*",
    safety:
      "\n\n---\n*अगर ई आपातकालीन स्थिति अछि त तुरंत 112 या 108 पर फोन करू।*",
  },
};

/**
 * Normalise an explicit locale string to a supported locale, or null when it
 * carries no usable signal.
 */
function localeToSupported(locale?: string | null): SupportedLocale | null {
  if (!locale) return null;
  const lower = locale.toLowerCase();
  if (lower.startsWith("hi")) return "hi";
  if (lower.startsWith("bh") || lower === "bhojpuri") return "bh";
  if (lower.startsWith("mai") || lower === "maithili") return "mai";
  if (lower.startsWith("en")) return "en";
  return null;
}

/**
 * Is this text predominantly written in Devanagari?
 *
 * Deliberately stricter than the userText heuristic below. A response body is
 * long and structured and carries machine artefacts — citation markers, source
 * URLs — that are always Latin. Measuring Devanagari against *total* length
 * would let that boilerplate drag a Hindi answer under the threshold, so we
 * compare letters against letters and strip the artefacts first.
 */
function isDevanagariDominant(text: string): boolean {
  const prose = text
    .replace(/\[citation:[^\]]*\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const devanagari = (prose.match(/[\u0900-\u097F]/g) || []).length;
  if (devanagari === 0) return false;
  const latin = (prose.match(/[A-Za-z]/g) || []).length;
  return devanagari >= latin;
}

/**
 * Detect the language the disclaimer should be written in.
 *
 * Order of precedence, and why:
 *
 * 1. An explicit *Indic* locale (hi/bh/mai). This is the only signal that can
 *    tell Bhojpuri and Maithili apart from Hindi — they share a script, so no
 *    amount of text inspection can recover the distinction.
 * 2. The language of the RESPONSE. The disclaimer is glued to the bottom of the
 *    body and its job is to be read by whoever can read that body. A Devanagari
 *    answer takes a Devanagari disclaimer even when the question was typed in
 *    romanised Hinglish — user-script detection returns "en" for that input, and
 *    it is the answer, not the question, that the reader is looking at.
 * 3. An explicit locale of "en". Unlike an Indic locale this is rarely a
 *    declaration: it is the default, and on the WhatsApp channel it is itself
 *    just derived from the absence of Devanagari in the incoming message. It
 *    must not outrank an unmistakably Devanagari body, which is why it sits
 *    below (2) rather than with (1).
 * 4. The user's own text, the original fallback.
 *
 * Falls back to "en" if nothing is conclusive.
 */
export function detectLocale(
  locale?: string | null,
  userText?: string,
  responseText?: string
): SupportedLocale {
  const explicit = localeToSupported(locale);

  // 1. Explicit Indic locale — the only carrier of the bh/mai distinction.
  if (explicit && explicit !== "en") return explicit;

  // 2. Language of the response body.
  if (responseText && isDevanagariDominant(responseText)) return "hi";

  // 3. Explicit "en".
  if (explicit) return explicit;

  // Heuristic: check for Devanagari script in user text
  if (userText) {
    const devanagariRatio =
      (userText.match(/[\u0900-\u097F]/g) || []).length / Math.max(userText.length, 1);
    if (devanagariRatio > 0.3) {
      // Mostly Devanagari — default to Hindi (Bhojpuri/Maithili need explicit locale)
      return "hi";
    }
  }

  return "en";
}

/**
 * Append the appropriate disclaimer to a response.
 * This is non-removable — it's the final step before returning to user.
 *
 * @param responseText - The response text to append to
 * @param locale - User's locale string (e.g., "hi", "en-US")
 * @param isEmergency - Whether this is an emergency/safety response
 * @param userText - Original user text (for language detection fallback)
 * @returns The response text with disclaimer appended
 *
 * The language of `responseText` is used as a detection signal too, so the
 * disclaimer is always readable next to the body it is attached to.
 */
export function appendDisclaimer(
  responseText: string,
  locale?: string | null,
  isEmergency: boolean = false,
  userText?: string
): string {
  // Don't double-append if disclaimer already present
  if (hasDisclaimer(responseText)) {
    return responseText;
  }

  // The response body is itself a first-class language signal — see detectLocale().
  const detectedLocale = detectLocale(locale, userText, responseText);
  const disclaimers = DISCLAIMERS[detectedLocale] || DISCLAIMERS.en;
  const disclaimer = isEmergency ? disclaimers.safety : disclaimers.standard;

  return responseText + disclaimer;
}

/**
 * Check if a response already contains a disclaimer.
 * Prevents double-appending when response templates already include one.
 */
export function hasDisclaimer(text: string): boolean {
  // Check for the horizontal rule + italic disclaimer pattern
  return /\n---\n\*.*(?:educational purposes|चिकित्सा सलाह|जानकारी सिर्फ|शिक्षा लेल|emergency|आपातकालीन).*\*$/i.test(
    text
  );
}

/**
 * Get the raw disclaimer text for a locale (for use in templates).
 */
export function getDisclaimer(
  locale: SupportedLocale = "en",
  isEmergency: boolean = false
): string {
  const disclaimers = DISCLAIMERS[locale] || DISCLAIMERS.en;
  return isEmergency ? disclaimers.safety : disclaimers.standard;
}
