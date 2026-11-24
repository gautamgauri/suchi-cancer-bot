/**
 * "Ask on WhatsApp" links (wa.me) to Suchi's public WhatsApp number.
 *
 * Plain JavaScript so that both the Astro pages and scripts/verify-build.mjs
 * read the same number and the same greeting.
 *
 * The number is international format, digits only: 91 (India) followed by a
 * ten-digit Indian mobile number, which starts with 6, 7, 8 or 9. Anything
 * else stops the build. A wrong number would send people to a stranger, and
 * a number without the country code is routed by wa.me to another country.
 */
export const SUCHI_WHATSAPP_NUMBER = '919430674464';

export const WHATSAPP_NUMBER_RE = /^91[6-9][0-9]{9}$/;

/**
 * Short code for the place the visitor tapped the button. It travels as the
 * last line of the prefilled message, because a wa.me link has no other
 * place to carry it. The API reads that line, removes it and counts the
 * code like a web chat `src` code. Same rule as those codes: lower-case
 * letters, digits, hyphen and underscore, at most 32 characters.
 *
 * @typedef {'wa-header' | 'wa-article' | 'wa-video' | 'wa-hospitals'} WhatsAppSource
 */
export const WHATSAPP_SOURCES = ['wa-header', 'wa-article', 'wa-video', 'wa-hospitals'];

/** The last line of the prefilled message must match this. */
export const SOURCE_LINE_RE = /\n\(src: ([a-z0-9_-]{1,32})\)$/;

/**
 * Prefilled message: a Hindi greeting, an English greeting, then the source
 * line. The API recognises the two greeting lines as a greeting.
 *
 * @param {WhatsAppSource} source
 * @returns {string}
 */
export function whatsappGreeting(source) {
  return `नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.\n(src: ${source})`;
}

/**
 * @param {string} number
 * @returns {string}
 */
export function assertWhatsAppNumber(number) {
  if (!WHATSAPP_NUMBER_RE.test(number)) {
    throw new Error(
      `SUCHI_WHATSAPP_NUMBER must be 91 followed by a ten-digit Indian mobile number starting 6 to 9, digits only. Got "${number}".`,
    );
  }
  return number;
}

// Checked when the module loads, so a bad number fails `astro build`.
assertWhatsAppNumber(SUCHI_WHATSAPP_NUMBER);

/**
 * wa.me link with the prefilled greeting for `source`.
 *
 * @param {WhatsAppSource} source
 * @returns {string}
 */
export function whatsappUrl(source) {
  if (!WHATSAPP_SOURCES.includes(source)) throw new Error(`Unknown WhatsApp source code "${source}".`);
  return `https://wa.me/${SUCHI_WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappGreeting(source))}`;
}
