/**
 * "Ask on WhatsApp" links (wa.me) for the landing site.
 *
 * PLACEHOLDER. SCCF's public WhatsApp number is not recorded anywhere in
 * this repository. Set it here in international format, digits only, with
 * no "+" or spaces (for example 91 followed by the ten-digit number).
 * While it is empty, every WhatsApp button is left out of the build, so
 * the site never shows a broken link.
 */
export const SCCF_WHATSAPP_NUMBER = '';

/**
 * Short code for the page the visitor came from. It travels at the end of
 * the prefilled greeting, because a wa.me link has no other place to carry
 * it. Same rule as the web chat `src` codes: lower-case letters, digits,
 * hyphen and underscore.
 */
export type WhatsAppSource = 'wa-header' | 'wa-article' | 'wa-video' | 'wa-hospitals';

/**
 * Greeting draft for owner approval. Hindi first, then English. A
 * greeting only, with no medical wording.
 */
export function whatsappGreeting(source: WhatsAppSource): string {
  return `नमस्ते सुची, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.\n(src: ${source})`;
}

const NUMBER_RE = /^[1-9][0-9]{9,14}$/;

/** wa.me link with the greeting, or null while no number is configured. */
export function whatsappUrl(source: WhatsAppSource, number: string = SCCF_WHATSAPP_NUMBER): string | null {
  if (number === '') return null;
  if (!NUMBER_RE.test(number)) {
    // Fail the build loudly. A wrong number would send people to a stranger.
    throw new Error('SCCF_WHATSAPP_NUMBER must be digits only in international format, with no "+" or spaces.');
  }
  return `https://wa.me/${number}?text=${encodeURIComponent(whatsappGreeting(source))}`;
}
