/**
 * Where a session came from, as a short code chosen by SCCF (for example
 * `site-article`, `yt`, `qr-poster`) or a standard `utm_source` value.
 *
 * The code arrives as a query parameter on POST /v1/sessions. Query
 * parameters are not checked by the global ValidationPipe, so this is the
 * only gate. Anything that is not a short lower-case token is dropped
 * silently. We never store a referrer URL or any free text.
 */
export const SOURCE_CODE_MAX_LENGTH = 32;
const SOURCE_CODE_RE = new RegExp(`^[a-z0-9_-]{1,${SOURCE_CODE_MAX_LENGTH}}$`);

export function normalizeSourceCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return SOURCE_CODE_RE.test(value) ? value : undefined;
}

export interface SessionAttribution {
  src?: string;
  utmSource?: string;
}

export function parseAttribution(src: unknown, utmSource: unknown): SessionAttribution {
  const out: SessionAttribution = {};
  const s = normalizeSourceCode(src);
  const u = normalizeSourceCode(utmSource);
  if (s) out.src = s;
  if (u) out.utmSource = u;
  return out;
}
