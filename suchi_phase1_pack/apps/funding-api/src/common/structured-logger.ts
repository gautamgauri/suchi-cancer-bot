/**
 * Thin structured logger: outputs JSON lines for Cloud Logging / log aggregation.
 * Use for request-scoped and bootstrap logs.
 */
export type LogLevel = "log" | "warn" | "error" | "debug";

export interface StructuredLogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  requestId?: string;
  timestamp: string;
  [key: string]: unknown;
}

function formatEntry(entry: StructuredLogEntry): string {
  return JSON.stringify(entry) + "\n";
}

export function structuredLog(
  level: LogLevel,
  message: string,
  extra: Omit<StructuredLogEntry, "level" | "message" | "timestamp"> = {}
): void {
  const entry: StructuredLogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  };
  const line = formatEntry(entry);
  if (level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const logStructured = {
  log: (message: string, extra?: Omit<StructuredLogEntry, "level" | "message" | "timestamp">) =>
    structuredLog("log", message, extra ?? {}),
  warn: (message: string, extra?: Omit<StructuredLogEntry, "level" | "message" | "timestamp">) =>
    structuredLog("warn", message, extra ?? {}),
  error: (message: string, extra?: Omit<StructuredLogEntry, "level" | "message" | "timestamp">) =>
    structuredLog("error", message, extra ?? {}),
  debug: (message: string, extra?: Omit<StructuredLogEntry, "level" | "message" | "timestamp">) =>
    structuredLog("debug", message, extra ?? {}),
};
