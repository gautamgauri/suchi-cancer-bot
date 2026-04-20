/**
 * LLM call retry helper — exponential backoff with jitter on transient
 * errors. Gemini Flash's per-minute quota is easy to exceed when the
 * autoresearch loop generates N=4 candidate patches in parallel; without
 * retries, 3 of 4 calls typically fail with 429 on burst.
 */

import OpenAI from "openai";

type CreateParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type Completion = OpenAI.Chat.Completions.ChatCompletion;

export interface RetryOpts {
  /** Max attempts including the first one. Default 4. */
  maxAttempts?: number;
  /** Base delay for exponential backoff. Default 2000ms. */
  baseDelayMs?: number;
  /** Human-readable label for log lines (e.g., "researcher", "judge pair 0v2"). */
  label?: string;
}

/** HTTP statuses considered transient — retry rather than throw immediately. */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

export async function retryableCompletion(
  client: OpenAI,
  request: CreateParams,
  opts: RetryOpts = {},
): Promise<Completion> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 2000;
  const label = opts.label ?? "llm";

  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.chat.completions.create(request);
    } catch (err: any) {
      lastErr = err;
      const status: number | undefined = err?.status ?? err?.response?.status;
      const isTransient = status !== undefined && TRANSIENT_STATUSES.has(status);
      const isLast = attempt === maxAttempts;

      if (!isTransient || isLast) {
        throw err;
      }

      // Honor Retry-After header if the server provided one (seconds OR
      // HTTP-date; we only handle seconds — that's what Gemini/OpenAI return).
      const retryAfterRaw =
        err?.headers?.get?.("retry-after") ??
        err?.headers?.["retry-after"] ??
        err?.response?.headers?.["retry-after"];
      const retryAfterSec = Number(retryAfterRaw);
      const serverDelay =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 0;

      // Exponential backoff with jitter to de-synchronize parallel callers
      // that all got 429 at the same time.
      const expDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelayMs);
      const delay = Math.max(serverDelay, expDelay + jitter);

      console.warn(
        `[llm-retry:${label}] attempt ${attempt}/${maxAttempts} got ${status}, retrying in ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
