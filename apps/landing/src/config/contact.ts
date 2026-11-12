/**
 * Homepage contact form: where it posts, and the address shown if sending fails.
 *
 * The API (suchi-api, POST /v1/contact) emails each message to the SCCF team.
 * Who receives it is server-side config (CONTACT_FORM_TO / CONTACT_FORM_CC),
 * never part of this site. For local testing against a local API, set
 * PUBLIC_CONTACT_API_URL in apps/landing/.env (git-ignored).
 */
export const CONTACT_API_URL: string =
  import.meta.env.PUBLIC_CONTACT_API_URL || 'https://suchi-api-lxiveognla-uc.a.run.app/v1/contact';

/** Already published on the site; shown with any sending error. */
export const CONTACT_FALLBACK_EMAIL = 'info@suchitracancercare.org';
