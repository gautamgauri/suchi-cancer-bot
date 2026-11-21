/**
 * Where this visit came from, read from the page URL:
 *   ?src=site-article            a short SCCF code (see apps/landing)
 *   ?utm_source=instagram        a standard campaign tag
 *
 * The values are sent to the API as query parameters on POST /sessions,
 * never in the JSON body. The API's ValidationPipe rejects unknown body
 * fields with a 400, so a body field would break session creation on any
 * API build that predates attribution. Query parameters are ignored there.
 *
 * Same rule as the server (apps/api/src/modules/sessions/source-code.ts):
 * lower-case letters, digits, hyphen and underscore, at most 32 characters.
 * Anything else is dropped. No referrer and no free text is ever sent.
 */
const SOURCE_CODE_RE = /^[a-z0-9_-]{1,32}$/;

export interface AttributionParams {
  src?: string;
  utm_source?: string;
}

function clean(value: string | null): string | undefined {
  return value !== null && SOURCE_CODE_RE.test(value) ? value : undefined;
}

export function readAttribution(search?: string): AttributionParams {
  let query = search;
  if (query === undefined) {
    try {
      query = typeof window !== "undefined" ? window.location.search : "";
    } catch {
      query = "";
    }
  }
  const params = new URLSearchParams(query);
  // A repeated parameter is ambiguous. Treat it as absent.
  const single = (key: string) => (params.getAll(key).length === 1 ? params.get(key) : null);
  const out: AttributionParams = {};
  const src = clean(single("src"));
  const utm = clean(single("utm_source"));
  if (src) out.src = src;
  if (utm) out.utm_source = utm;
  return out;
}
