/**
 * What every platform client returns, and the one rule for retries.
 *
 * A retry is allowed only when the platform certainly did not create a post:
 * a 4xx answer that is about rate (429), or a connection that never opened.
 * A timeout, a dropped connection or a 5xx answer may have created the post,
 * so it is recorded as "uncertain" and is never retried automatically. The
 * owner checks the page and decides. That is the price of never posting twice.
 */

export type PublishOutcome =
  | { kind: "published"; postId: string; permalink?: string; httpStatus?: number }
  | { kind: "rejected"; error: string; httpStatus?: number; retryable: boolean; tokenProblem?: boolean }
  | { kind: "uncertain"; error: string; httpStatus?: number }
  | { kind: "not_configured"; error: string };

export interface PlatformPayload {
  text: string;
  imageUrl?: string;
}

export interface PlatformClient {
  readonly platform: "linkedin" | "facebook" | "instagram" | "x";
  isConfigured(): boolean;
  /** The request that would be sent, with credentials removed. Used for dry runs and the record. */
  render(payload: PlatformPayload): Record<string, unknown>;
  publish(payload: PlatformPayload): Promise<PublishOutcome>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const REQUEST_TIMEOUT_MS = 20_000;

/** Network errors raised before any byte reached the platform. */
const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "CERT_HAS_EXPIRED"]);

export function networkOutcome(err: unknown): PublishOutcome {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string } };
  const code = e?.cause?.code ?? e?.code;
  const msg = e?.message ?? String(err);
  if (code && NEVER_SENT.has(code)) {
    return { kind: "rejected", error: `network error before sending (${code})`, retryable: true };
  }
  if (e?.name === "AbortError" || e?.name === "TimeoutError") {
    return { kind: "uncertain", error: `no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds` };
  }
  return { kind: "uncertain", error: `network error after sending may have begun (${code ?? msg.slice(0, 80)})` };
}

/** Classify a non-2xx answer. */
export function httpOutcome(status: number, detail: string, tokenProblem = false): PublishOutcome {
  const error = `HTTP ${status}${detail ? ` ${detail.slice(0, 200)}` : ""}`;
  if (status >= 500) return { kind: "uncertain", error, httpStatus: status };
  if (status === 429) return { kind: "rejected", error, httpStatus: status, retryable: true };
  return { kind: "rejected", error, httpStatus: status, retryable: false, tokenProblem: tokenProblem || status === 401 };
}

export async function fetchWithTimeout(fetchFn: FetchLike, url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function readBody(res: Response): Promise<{ text: string; json: unknown }> {
  const text = await res.text().catch(() => "");
  try {
    return { text, json: text ? JSON.parse(text) : undefined };
  } catch {
    return { text, json: undefined };
  }
}
