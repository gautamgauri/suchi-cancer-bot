/**
 * LLM-judge error classification and bounded retry (issue #110).
 *
 * A judge call can end three ways:
 *   1. a rendered verdict (ok=true / ok=false per check)   -> scored
 *   2. the judge was never reached, or its reply was not a
 *      verdict (429, 5xx, auth, timeout, DNS, SDK missing,
 *      unparseable JSON)                                    -> UNSCORED
 *   3. the judge was not configured at all                  -> UNSCORED
 *
 * Only (1) says anything about answer quality. (2) and (3) are properties of
 * the evaluation infrastructure and must never be recorded as a failed rubric
 * check — nor silently dropped from the denominator (the inflation #74 found).
 * They become an explicit `unscored` outcome with a machine-readable reason,
 * are counted separately from pass/fail, and drive a distinct CI signal
 * (`judge_unavailable`, see eval/ci/eval-status.js).
 *
 * The Vertex SDK is the motivating shape: `@google-cloud/vertexai` throws
 * `ClientError` whose message is
 *   "[VertexAI.ClientError]: got status: 429 Too Many Requests. {...}"
 * with NO `status` property (the HTTP code lives in `error.cause.code` and in
 * the message text). The previous classifier looked only at `error.status`
 * and the phrase "rate limit", fell through to `unknown`, and scored every
 * check on the case as failed.
 */

import type { LLMJudgeResult } from "../types";

export type JudgeErrorKind =
  | "auth_failed"
  | "rate_limited"
  | "timeout"
  | "provider_error"
  | "network_error"
  | "sdk_missing"
  | "not_configured"
  | "malformed_verdict"
  | "unknown";

export interface JudgeErrorClassification {
  kind: JudgeErrorKind;
  /** HTTP status when one could be recovered from the error shape or message */
  statusCode?: number;
  /**
   * True when the failure sits between the harness and the judge model
   * (auth, quota, network, provider outage, SDK). False for `unknown` and
   * `malformed_verdict`, which are still not verdicts but are not obviously
   * transport either — they are reported under their own reason.
   */
  transport: boolean;
  /** Worth another attempt with backoff */
  retryable: boolean;
  /** Human-readable label, e.g. "rate_limited (HTTP 429)" */
  label: string;
  /** Server-suggested wait, when the error carried one */
  retryAfterMs?: number;
}

const RETRYABLE: ReadonlySet<JudgeErrorKind> = new Set([
  "rate_limited",
  "timeout",
  "provider_error",
  "network_error",
]);

const TRANSPORT: ReadonlySet<JudgeErrorKind> = new Set([
  "auth_failed",
  "rate_limited",
  "timeout",
  "provider_error",
  "network_error",
  "sdk_missing",
  "not_configured",
]);

function asHttpStatus(value: unknown): number | undefined {
  const n =
    typeof value === "string" && /^\d{3}$/.test(value) ? parseInt(value, 10) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 100 && n < 600 ? n : undefined;
}

/**
 * Recover an HTTP status from the many shapes SDKs use: OpenAI (`status`),
 * axios (`response.status`), Vertex (`cause.code` + message text), gRPC-ish
 * (`code`), or a bare "HTTP 503" / "got status: 429" in the message.
 */
export function extractStatusCode(error: unknown): number | undefined {
  const e = error as any;
  if (!e) return undefined;
  const candidates = [
    e.status,
    e.statusCode,
    e.response?.status,
    e.cause?.code,
    e.cause?.status,
    e.code,
  ];
  for (const c of candidates) {
    const n = asHttpStatus(c);
    if (n !== undefined) return n;
  }
  const msg = String(e.message ?? "");
  const m = msg.match(/(?:got status|status(?: code)?|HTTP)[:\s]+(\d{3})\b/i);
  if (m) return parseInt(m[1], 10);
  return undefined;
}

function extractRetryAfterMs(error: unknown): number | undefined {
  const e = error as any;
  if (!e) return undefined;
  const header = e.headers?.["retry-after"] ?? e.response?.headers?.["retry-after"];
  if (header !== undefined) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs > 0) return Math.round(secs * 1000);
  }
  // Vertex error bodies carry `"retryDelay": "12s"` inside RetryInfo details.
  const m = String(e.message ?? "").match(/retryDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)s/i);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  return undefined;
}

/** Classify a thrown judge error. Never throws. */
export function classifyJudgeError(error: unknown): JudgeErrorClassification {
  const e = (error ?? {}) as any;
  const statusCode = extractStatusCode(e);
  const name = String(e.name ?? "");
  const code = String(e.code ?? "").toUpperCase();
  const grpc = String(e.cause?.status ?? "").toUpperCase();
  const msg = String(e.message ?? "").toLowerCase();

  let kind: JudgeErrorKind;

  if (msg.includes("cannot find module") || msg.includes("sdk not installed")) {
    kind = "sdk_missing";
  } else if (
    name === "GoogleAuthError" ||
    statusCode === 401 ||
    statusCode === 403 ||
    grpc === "UNAUTHENTICATED" ||
    grpc === "PERMISSION_DENIED" ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("unauthenticated") ||
    msg.includes("permission denied") ||
    msg.includes("could not load the default credentials") ||
    msg.includes("invalid api key") ||
    msg.includes("incorrect api key")
  ) {
    kind = "auth_failed";
  } else if (
    statusCode === 429 ||
    grpc === "RESOURCE_EXHAUSTED" ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("quota exceeded") ||
    msg.includes("quota")
  ) {
    kind = "rate_limited";
  } else if (
    statusCode === 408 ||
    grpc === "DEADLINE_EXCEEDED" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    msg.includes("etimedout") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("deadline exceeded")
  ) {
    kind = "timeout";
  } else if (
    (statusCode !== undefined && statusCode >= 500) ||
    grpc === "UNAVAILABLE" ||
    grpc === "INTERNAL" ||
    grpc === "ABORTED" ||
    msg.includes("internal server error") ||
    msg.includes("service unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("bad gateway")
  ) {
    kind = "provider_error";
  } else if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "EPIPE" ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("dns")
  ) {
    kind = "network_error";
  } else {
    kind = "unknown";
  }

  return {
    kind,
    statusCode,
    transport: TRANSPORT.has(kind),
    retryable: RETRYABLE.has(kind),
    label: `${kind}${statusCode ? ` (HTTP ${statusCode})` : ""}`,
    retryAfterMs: extractRetryAfterMs(e),
  };
}

// ── Bounded retry with backoff ───────────────────────────────────────────────

export interface JudgeRetryOptions {
  /** Additional attempts after the first (default 3 → 4 attempts total) */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Deterministic jitter hook for tests; defaults to Math.random */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    classification: JudgeErrorClassification;
  }) => void;
}

export type JudgeCallOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: unknown; classification: JudgeErrorClassification; attempts: number };

export const DEFAULT_JUDGE_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 2000;
const DEFAULT_MAX_DELAY_MS = 30000;

export function backoffDelayMs(
  attempt: number,
  classification: JudgeErrorClassification,
  opts: { baseDelayMs?: number; maxDelayMs?: number; random?: () => number } = {}
): number {
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  if (classification.retryAfterMs && classification.retryAfterMs > 0) {
    return Math.min(max, classification.retryAfterMs);
  }
  const exp = base * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = (opts.random ?? Math.random)() * base * 0.5;
  return Math.min(max, Math.round(exp + jitter));
}

/**
 * Run a judge call, retrying retryable transport errors with exponential
 * backoff. Never throws: the caller decides how to record the outcome.
 */
export async function callJudgeWithRetry<T>(
  fn: () => Promise<T>,
  opts: JudgeRetryOptions = {}
): Promise<JudgeCallOutcome<T>> {
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_JUDGE_RETRIES);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const value = await fn();
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      const classification = classifyJudgeError(error);
      if (!classification.retryable || attempt > maxRetries) {
        return { ok: false, error, classification, attempts: attempt };
      }
      const delayMs = backoffDelayMs(attempt, classification, opts);
      opts.onRetry?.({ attempt, delayMs, classification });
      await sleep(delayMs);
    }
  }
}

// ── Result helpers ───────────────────────────────────────────────────────────

/**
 * True when a judge check result carries no verdict. `skipped` is the legacy
 * flag (pre-#110 reports); `unscored` is the explicit one.
 */
export function isUnscored(result: Pick<LLMJudgeResult, "unscored" | "skipped">): boolean {
  return result.unscored === true || result.skipped === true;
}

const MAX_ERROR_CHARS = 400;

export function unscoredJudgeResult(
  checkId: string,
  classification: Pick<JudgeErrorClassification, "kind" | "label">,
  message: string,
  attempts?: number
): LLMJudgeResult {
  const trimmed = message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message;
  return {
    checkId,
    passed: false,
    skipped: true, // legacy alias, kept so older consumers keep excluding it from pass/fail
    unscored: true,
    unscoredReason: classification.kind,
    error: `${classification.label}: ${trimmed}`,
    ...(attempts !== undefined ? { attempts } : {}),
  };
}

/** One-line summary of why a case's judge checks went unscored, e.g. "rate_limited (HTTP 429) ×6". */
export function summarizeUnscoredReasons(results: LLMJudgeResult[] | undefined): string | undefined {
  if (!results) return undefined;
  const counts = new Map<string, number>();
  for (const r of results) {
    if (!isUnscored(r)) continue;
    const label = r.error?.split(":")[0]?.trim() || r.unscoredReason || "unavailable";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].map(([label, n]) => `${label} ×${n}`).join(", ");
}

// ── Case-level outcome resolution ────────────────────────────────────────────

/** Minimal shape of an EvaluationResult needed to resolve the unscored bucket. */
export interface UnscorableCase {
  unscored?: boolean;
  error?: string;
  deterministicResults?: Array<{ required?: boolean; passed: boolean }>;
  llmJudgeResults?: LLMJudgeResult[];
}

/**
 * Decide whether a case belongs in the `unscored` bucket rather than `failed`.
 *
 * Precedence matters: rendered evidence of a failure OUTRANKS a missing
 * verdict. A case that blew up executing, that failed a *required*
 * deterministic check, or that has a *required* judge check which actually
 * rendered `ok: false`, is a genuine quality failure — a second check going
 * unscored alongside it must not launder it into "judge unavailable".
 * Only a case whose failure rests entirely on verdicts that were never
 * rendered is unscored.
 *
 * An explicit `unscored` boolean (set by the evaluator, which has the rubric)
 * always wins; the heuristic below is the fallback for results produced
 * elsewhere or read back from an older report.
 */
export function resolveCaseUnscored(
  result: UnscorableCase,
  requiredLlmCheckIds?: ReadonlySet<string>
): boolean {
  if (typeof result.unscored === "boolean") return result.unscored;
  const judgeResults = result.llmJudgeResults ?? [];
  if (!judgeResults.some(isUnscored)) return false;
  if (result.error) return false;
  if ((result.deterministicResults ?? []).some((d) => d.required && !d.passed)) return false;
  if (
    requiredLlmCheckIds &&
    judgeResults.some((r) => !isUnscored(r) && !r.passed && requiredLlmCheckIds.has(r.checkId))
  ) {
    return false;
  }
  return true;
}
