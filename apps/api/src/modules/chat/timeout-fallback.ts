/**
 * Shared timeout handling for every channel that fronts `ChatService.handle`.
 *
 * `ChatService` deliberately throws when a turn runs out of LLM budget
 * (`llmWithDeadline` → "LLM generation timeout: …") or when the caller's
 * AbortSignal fires. The web controller has always converted that class of
 * error into a 504 carrying `TIMEOUT_GUIDANCE_TEXT`; the WhatsApp path did not,
 * and answered the same error with a generic "something went wrong" (issue
 * #115). Both channels now share the classifier and the copy below so they
 * cannot drift again.
 *
 * The wording is the pre-existing web controller copy moved here verbatim —
 * no clinical or escalation wording was authored in this file. Rewording it is
 * an SCCF decision (AGENTS.md §1.3; docs/RELIABILITY_BACKLOG.md P1-11).
 */

/** Sentinel message for the per-request abort raced against `ChatService.handle`. */
export const REQUEST_TIMEOUT_ERROR = "REQUEST_TIMEOUT";

/**
 * Per-turn wall-clock cap for one chat turn as seen by the channel. Aligned
 * with `ChatService`'s bounded LLM budget so the fallback returns before the
 * Cloud Run request cap. Shared by the web controller and the WhatsApp worker.
 */
export const CHAT_TURN_TIMEOUT_MS = 55_000;

/** Patient-facing copy returned when a turn times out (moved from chat.controller.ts, unchanged). */
export const TIMEOUT_GUIDANCE_TEXT =
  "I'm sorry — my response is taking longer than expected. " +
  "In the meantime, here are some general steps you can take:\n\n" +
  "1. **Talk to a doctor**: If you have symptoms or concerns about cancer, the most important step is seeing a healthcare professional.\n" +
  "2. **Indian Cancer Society Helpline**: Call 1800-22-1951 (toll-free) for guidance.\n" +
  "3. **Emergency**: If you're experiencing severe symptoms (coughing blood, sudden severe pain, difficulty breathing), call 112 or 108 for an ambulance.\n\n" +
  "Please try asking your question again — I should be able to give you a more detailed, referenced answer.";

/**
 * True for the error class `ChatService` raises when a turn ran out of time:
 * the channel-level abort race, `llmWithDeadline` budget exhaustion, and
 * upstream aborts. Same predicate the web controller has used since the
 * bounded-budget work; extracted so WhatsApp applies the identical rule.
 */
export function isChatTimeoutError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return false;
  return (
    message === REQUEST_TIMEOUT_ERROR ||
    message.includes("timeout") ||
    message.includes("LLM generation timeout") ||
    message.includes("aborted")
  );
}
