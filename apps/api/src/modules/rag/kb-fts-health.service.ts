import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  KB_FTS_CONFIG,
  KB_FTS_INDEX,
  KB_FTS_INDEXDEF_MARKER,
  KB_FTS_LEGACY_COLUMN,
  KB_FTS_OWNERSHIP_NOTE,
  KB_FTS_PROBE_SQL,
  KB_FTS_TABLE,
  KbFtsProbeRow,
} from "./kb-fts.sql";

/**
 * Health of the lexical (FTS) arm of hybrid retrieval.
 *
 * The arm queries the EXPRESSION to_tsvector('simple', content), so it keeps
 * returning correct rows even with no index — only slower. Hence:
 *
 * - `ok`            — table present, expression GIN index present, VALID and over the expected expression.
 * - `degraded`      — correct but slow: index missing, INVALID (interrupted CREATE INDEX
 *                     CONCURRENTLY) or over a different expression/config (planner will not use it).
 * - `unavailable`   — the table the query needs is missing, or queries fail with a schema
 *                     error. The lexical arm contributes nothing.
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
 * Deliberate non-goal: this does NOT abort boot when something is missing.
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

      const legacyNote = row.legacyColumnPresent
        ? ` A legacy "${KB_FTS_LEGACY_COLUMN}" column is still present and unused — drop it (catalog-only) with migration 20260908000000_restore_kb_chunk_fts.`
        : "";

      if (!row.indexDef) {
        this.set(
          "degraded",
          `expression index ${KB_FTS_INDEX} is missing — lexical search still returns correct rows ` +
            `but computes to_tsvector over every chunk (sequential scan). Build it: ` +
            `scripts/sql/kb_fts_safe_rollout.py (production) or migration 20260908000000_restore_kb_chunk_fts.` +
            legacyNote
        );
        this.logger.warn({ event: "kb_fts_index_missing", message: this.detail, index: KB_FTS_INDEX });
        return this.getHealth();
      }

      if (!row.indexDef.includes(KB_FTS_INDEXDEF_MARKER) || !/USING gin/i.test(row.indexDef)) {
        this.set(
          "degraded",
          `${KB_FTS_INDEX} exists but is not GIN over ${KB_FTS_INDEXDEF_MARKER} (actual: ` +
            `${row.indexDef.slice(0, 160)}). Queries use websearch_to_tsquery('${KB_FTS_CONFIG}', …) ` +
            `against that exact expression, so the planner will not use this index and a mismatched ` +
            `config matches far fewer rows (and no Hindi/Hinglish at all).` +
            legacyNote
        );
        this.logger.error({
          event: "kb_fts_config_mismatch",
          message: this.detail,
          expectedConfig: KB_FTS_CONFIG,
          indexDef: row.indexDef.slice(0, 300),
        });
        return this.getHealth();
      }

      if (!row.indexValid) {
        this.set(
          "degraded",
          `${KB_FTS_INDEX} exists but is INVALID — an interrupted CREATE INDEX CONCURRENTLY leaves this ` +
            `behind and the planner ignores it (sequential scans). DROP INDEX CONCURRENTLY ${KB_FTS_INDEX} ` +
            `and rebuild it CONCURRENTLY (scripts/sql/kb_fts_safe_rollout.py does both).` +
            legacyNote
        );
        this.logger.error({ event: "kb_fts_index_invalid", message: this.detail, index: KB_FTS_INDEX });
        return this.getHealth();
      }

      this.set("ok", `${KB_FTS_INDEX} present and valid over to_tsvector('${KB_FTS_CONFIG}', content)${legacyNote}`);
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
   * Execution success is NOT evidence that the schema is healthy: with an
   * expression query, "no index" and "indexed" produce the same rows, only at
   * different speeds. So a success never sets `ok` directly. It only schedules a
   * re-probe, which inspects the index and is the sole authority on the verdict.
   * Throttled and never awaited, so the retrieval path is not slowed.
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
