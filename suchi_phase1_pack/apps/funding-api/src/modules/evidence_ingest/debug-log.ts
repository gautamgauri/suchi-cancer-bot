/**
 * Debug logging utility for evidence ingest pipeline.
 * Logs to console when EVIDENCE_DEBUG=true.
 */
const DEBUG = process.env.EVIDENCE_DEBUG === "true";

export function debugLog(
  contextOrObj: string | { location: string; message: string; data?: unknown; hypothesisId?: string },
  ...args: unknown[]
): void {
  if (!DEBUG) return;
  if (typeof contextOrObj === "string") {
    console.log(`[evidence:${contextOrObj}]`, ...args);
  } else {
    console.log(`[evidence:${contextOrObj.location}] ${contextOrObj.message}`, contextOrObj.data ?? "");
  }
}
