import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  KB_FTS_COLUMN,
  KB_FTS_CONFIG,
  KB_FTS_INDEX,
  KB_FTS_OWNERSHIP_NOTE,
  KB_FTS_PROBE_SQL,
  KB_FTS_TABLE,
  KB_FTS_TRIGGER,
  KbFtsProbeRow,
} from "./kb-fts.sql";

/**
 * Health of the lexical (FTS) arm of hybrid retrieval.
 *
 * - `ok`            — column exists, is maintained (by the enabled trigger, or as a legacy STORED
 *                     generated column) on the expected config, GIN index present and valid.
 * - `degraded`      — queryable but not in the expected shape (GIN index missing or invalid → slow
 *                     but correct; config mismatch → far fewer matches).
 * - `unavailable`   — the column/table the query needs is missing, or present but maintained by
 *                     nothing (always NULL). The lexical arm contributes nothing.
 * - `unknown`       — the probe could not run (DB unreachable at boot). Not a verdict.
 */
export type KbFtsStatus = "ok" | "degraded" | "unavailable" | "unknown";

export interface KbFtsHealth {
  status: KbFtsStatus;
  detail: string;
  checkedAt: string | null;
  /** Queries that failed because the schema does not match the query. Should stay 0. */
  schemaFailureCount: number;
  /** Queries that failed for other reasons (timeouts, pool exhaustion, …). */
  queryFailureCount: number;
  lastError: string | null;
}

const LOG_THROTTLE_MS = 60_000;

/**
 * Keeps the state of the FTS arm observable.
 *
 * Issue #92: `content_tsv` was dropped by a migration in June 2026 and the FTS
 * query kept failing inside a `catch { logger.error(...); return []; }`. One
 * error line per chat turn, buried in a wall of retrieval logs, with the caller
 * unable to tell "no lexical matches" from "the lexical arm is dead" — so nobody
 * noticed for three months. This service exists so that the distinction is
 * explicit, checked once at boot, counted per query, and reported on /v1/health.
 *
 * Deliberate non-goal: this does NOT abort boot when the column is missing.
 * Vector-only retrieval still answers correctly (just with degraded ranking), so
 * refusing to start would turn a ranking regression into a full chat outage for
 * patients. The escalation path is the boot-time ERROR log plus
 * `GET /v1/health/retrieval`, which returns 503 while the arm is dead.
 */
@Injectable()
export class KbFtsHealthService implements OnModuleInit {
  private readonly logger = new Logger(KbFtsHealthService.name);

  /** Minimum gap between re-probes triggered by query success. */
  private static readonly REPROBE_THROTTLE_MS = 30_000;

  private reprobeInFlight = false;
  private lastReprobeAt = 0;
  private status: KbFtsStatus = "unknown";
  private detail = "not probed yet";
  private checkedAt: string | null = null;
  private schemaFailureCount = 0;
  private queryFailureCount = 0;
  private lastError: string | null = null;
  private lastSchemaLogAt = 0;
  private lastQueryLogAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Never let the probe block or break startup — it is diagnostics, not a gate.
    await this.probe();
  }

  /**
   * Checks the FTS objects against the database and logs the verdict loudly
   * enough to be noticed. Safe to call at any time (e.g. from a health check).
   */
  async probe(): Promise<KbFtsHealth> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<KbFtsProbeRow[]>(KB_FTS_PROBE_SQL);
      const row = rows?.[0];

      if (!row || !row.tablePresent) {
        this.set(
          "unavailable",
          `table "${KB_FTS_TABLE}" not found — the knowledge base schema is not migrated`
        );
        this.logUnavailable();
        return this.getHealth();
      }

      if (!row.columnPresent) {
        this.set(
          "unavailable",
          `"${KB_FTS_TABLE}"."${KB_FTS_COLUMN}" is missing — run migration 20260908000000_restore_kb_chunk_fts`
        );
        this.logUnavailable();
        return this.getHealth();
      }

      // How is the column kept current? Either Postgres does it (legacy STORED
      // generated column) or the maintenance trigger does (current shape — a
      // generated column rewrites the whole table and caused the 2026-09-12 outage).
      // A plain column with neither is `prisma migrate diff` output: always NULL.
      const maintainedBy: "generated column" | "trigger" | null = row.columnGenerated
        ? "generated column"
        : row.triggerEnabled
          ? "trigger"
          : null;
      if (!maintainedBy) {
        this.set(
          "unavailable",
          `"${KB_FTS_TABLE}"."${KB_FTS_COLUMN}" exists but nothing maintains it (not GENERATED, and ` +
            `trigger ${KB_FTS_TRIGGER} is missing or disabled), so it is always NULL and every lexical ` +
            `query returns zero rows. This is what a schema built by \`prisma migrate diff\`/\`db push\` ` +
            `produces. Run migration 20260908000000_restore_kb_chunk_fts.`
        );
        this.logUnavailable();
        return this.getHealth();
      }

      const expr = (row.columnGenerated ? row.generationExpr : row.triggerFunctionDef) ?? "";
      if (!expr.includes(`'${KB_FTS_CONFIG}'`)) {
        this.set(
          "degraded",
          `"${KB_FTS_COLUMN}" is maintained by ${maintainedBy} with ${expr ? "a definition that does not use" : "an unreadable definition for"} ` +
            `'${KB_FTS_CONFIG}', but queries use websearch_to_tsquery('${KB_FTS_CONFIG}', …). Mismatched ` +
            `text-search configs match far fewer rows (and no Hindi/Hinglish at all).`
        );
        this.logger.error({
          event: "kb_fts_config_mismatch",
          message: this.detail,
          expectedConfig: KB_FTS_CONFIG,
          maintainedBy,
          definition: expr.slice(0, 300),
        });
        return this.getHealth();
      }

      if (!row.indexPresent) {
        this.set(
          "degraded",
          `GIN index ${KB_FTS_INDEX} is missing — lexical search still returns correct rows but ` +
            `sequentially scans every chunk.`
        );
        this.logger.warn({ event: "kb_fts_index_missing", message: this.detail, index: KB_FTS_INDEX });
        return this.getHealth();
      }

      if (!row.indexValid) {
        this.set(
          "degraded",
          `GIN index ${KB_FTS_INDEX} exists but is INVALID — an interrupted CREATE INDEX CONCURRENTLY ` +
            `leaves this behind. The planner ignores it (sequential scans). DROP INDEX ${KB_FTS_INDEX} ` +
            `and rebuild it CONCURRENTLY.`
        );
        this.logger.error({ event: "kb_fts_index_invalid", message: this.detail, index: KB_FTS_INDEX });
        return this.getHealth();
      }

      this.set("ok", `${KB_FTS_COLUMN} maintained by ${maintainedBy} on '${KB_FTS_CONFIG}', ${KB_FTS_INDEX} present and valid`);
      this.logger.log({
        event: "kb_fts_health_ok",
        message: `Lexical retrieval arm ready: ${this.detail}`,
      });
      return this.getHealth();
    } catch (error: any) {
      // Could not reach the DB — say so, but do not claim FTS is broken.
      this.status = "unknown";
      this.detail = `probe failed: ${error?.message ?? error}`;
      this.checkedAt = new Date().toISOString();
      this.lastError = String(error?.message ?? error);
      this.logger.warn({
        event: "kb_fts_probe_failed",
        message: `Could not verify the lexical retrieval arm: ${this.detail}`,
      });
      return this.getHealth();
    }
  }

  /**
   * A lexical query failed because the schema does not match it. This is the
   * condition that hid for three months — it is logged at error level with a
   * dedicated event and surfaced on the health endpoint, not swallowed.
   */
  recordSchemaFailure(error: unknown): void {
    this.schemaFailureCount += 1;
    this.lastError = this.describe(error);
    this.set(
      "unavailable",
      `lexical query rejected by Postgres: ${this.lastError}. ` +
        `Run migration 20260908000000_restore_kb_chunk_fts.`
    );

    const now = Date.now();
    if (this.schemaFailureCount === 1 || now - this.lastSchemaLogAt > LOG_THROTTLE_MS) {
      this.lastSchemaLogAt = now;
      this.logUnavailable();
    }
  }

  /** A lexical query failed for a transient reason. Warn, count, keep serving. */
  recordQueryFailure(error: unknown): void {
    this.queryFailureCount += 1;
    this.lastError = this.describe(error);

    const now = Date.now();
    if (this.queryFailureCount === 1 || now - this.lastQueryLogAt > LOG_THROTTLE_MS) {
      this.lastQueryLogAt = now;
      this.logger.warn({
        event: "kb_fts_query_failed",
        message: `Lexical retrieval query failed (transient): ${this.lastError}`,
        queryFailureCount: this.queryFailureCount,
      });
    }
  }

  /**
   * A lexical query completed without throwing.
   *
   * Execution success is NOT evidence that the schema is repaired. A plain,
   * unmaintained `content_tsv` column — what `prisma migrate diff` emits, and
   * precisely what the restore migration exists to repair — satisfies this
   * query, returns zero rows, and throws nothing. Clearing an `unavailable`
   * verdict on that basis would report a dead lexical arm as healthy, which is
   * the exact masking this service exists to prevent.
   *
   * So a success never sets `ok` directly. It only schedules a re-probe, which
   * checks how the column is maintained (trigger or generation expression) and
   * is the sole authority on the verdict. Throttled and never awaited, so the retrieval
   * path is not slowed.
   */
  recordQuerySuccess(): void {
    // Hot path: nothing to reconsider unless we are currently carrying a
    // negative or unproven verdict.
    if (this.status !== "unavailable" && this.status !== "unknown") return;

    const now = Date.now();
    if (
      this.reprobeInFlight ||
      now - this.lastReprobeAt < KbFtsHealthService.REPROBE_THROTTLE_MS
    ) {
      return;
    }

    this.reprobeInFlight = true;
    this.lastReprobeAt = now;

    void this.probe()
      .then((health) => {
        if (health.status === "ok") {
          this.logger.log({
            event: "kb_fts_recovered",
            message: "Lexical retrieval arm is answering again — schema re-probe confirms it",
          });
        }
      })
      .catch(() => {
        // probe() sets and logs its own verdict on failure; nothing to add.
      })
      .finally(() => {
        this.reprobeInFlight = false;
      });
  }

  getHealth(): KbFtsHealth {
    return {
      status: this.status,
      detail: this.detail,
      checkedAt: this.checkedAt,
      schemaFailureCount: this.schemaFailureCount,
      queryFailureCount: this.queryFailureCount,
      lastError: this.lastError,
    };
  }

  /** True when the lexical arm is known to be contributing nothing. */
  isUnavailable(): boolean {
    return this.status === "unavailable";
  }

  private set(status: KbFtsStatus, detail: string): void {
    this.status = status;
    this.detail = detail;
    this.checkedAt = new Date().toISOString();
  }

  private logUnavailable(): void {
    this.logger.error({
      event: "kb_fts_unavailable",
      message:
        `LEXICAL RETRIEVAL IS DEAD — hybrid search is running vector-only, which silently ` +
        `discards 45% of the scoring weight on long queries and 20% on short ones. ${this.detail}`,
      table: KB_FTS_TABLE,
      column: KB_FTS_COLUMN,
      index: KB_FTS_INDEX,
      expectedConfig: KB_FTS_CONFIG,
      schemaFailureCount: this.schemaFailureCount,
      remediation: KB_FTS_OWNERSHIP_NOTE,
    });
  }

  private describe(error: unknown): string {
    if (error && typeof error === "object") {
      const err = error as { message?: unknown; code?: unknown; meta?: { code?: unknown } };
      const code = (typeof err.code === "string" && err.code) || (typeof err.meta?.code === "string" && err.meta.code) || null;
      const message = typeof err.message === "string" ? err.message.split("\n")[0] : String(error);
      return code ? `[${code}] ${message}` : message;
    }
    return String(error);
  }
}
