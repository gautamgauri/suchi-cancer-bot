/**
 * Phone links for hospital data. Read by the Hospital Directory page and by
 * scripts/verify-build.mjs.
 */

/**
 * `tel:` href for a phone field, or null when the field is not exactly one
 * Indian number. Accepted forms, once spaces, hyphens, dots and brackets are
 * gone: +91 and ten digits, a ten-digit mobile, 0 and a ten-digit landline,
 * or a 1800 toll-free number. Anything else (two numbers, an extension,
 * "+91-0...") is shown as text with no link. The text shown stays as written.
 */
export function telHref(phone) {
  const s = String(phone ?? '').replace(/[\s\-().]/g, '');
  let m;
  if ((m = s.match(/^\+91([1-9]\d{9})$/))) return `tel:+91${m[1]}`;
  if ((m = s.match(/^0([1-9]\d{9})$/))) return `tel:+91${m[1]}`;
  if ((m = s.match(/^([6-9]\d{9})$/))) return `tel:+91${m[1]}`;
  if ((m = s.match(/^(1800\d{6,7})$/))) return `tel:${m[1]}`;
  return null;
}

/** The form every `tel:` href on the site must take. */
export const TEL_HREF_RE = /^tel:(\+91[1-9]\d{9}|1800\d{6,7})$/;
