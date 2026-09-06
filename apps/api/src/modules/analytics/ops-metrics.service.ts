import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Ops Center instrumentation metrics (GitHub issues #61, #62, #64) plus the
 * KB index integrity guard from issue #86.
 *
 * These are the three Suchi figures the Bodh AI Ops scorecard renders as
 * "unavailable" because no collector exists. They are deliberately thin:
 * three read-only aggregate counts, no new tables, no scheduler, no
 * time-series storage. At current traffic (~10 real human users in 30 days
 * against ~700 eval-runner requests) anything heavier would be
 * instrumentation theatre.
 *
 * Rule inherited from the Ops Center: a metric with no collector reads
 * "unavailable", never 0. So every value here is a real measurement, and the
 * caveats that limit its meaning travel with it rather than being dropped.
 *
 * Eval traffic is excluded everywhere via Session.isEval.
 * READ-ONLY: this service issues no writes and no DDL.
 */

export interface OpsMetrics {
  generatedAt: string;
  windows: { activeUsersDays: number; safetyEventsDays: number };
  /** #61 active_users_7d */
  activeUsers7d: {
    value: number;
    basis: { nonEvalSessions: number; distinctWhatsappContacts: number };
    caveat: string;
  };
  /** #62 review_queue_size */
  reviewQueueSize: {
    value: number;
    basis: { flaggedTotal: number };
  };
  /** #64 safety_events_30d */
  safetyEvents30d: {
    value: number;
    byType: Array<{ type: string; count: number }>;
  };
  /**
   * #86 kb_duplicate_rows — KbChunk rows that share a (docId, chunkIndex) with
   * another row. Healthy is exactly 0. A non-zero value means an ingest run
   * wrote alongside an earlier run instead of upserting over it (Jan 2026:
   * 25,065 such rows, 34% of the index, from a uuid-id run followed by a
   * deterministic-id run).
   */
  kbIndexIntegrity: {
    value: number;
    basis: { totalRows: number; nonDeterministicIdRows: number };
    healthy: boolean;
    caveat: string;
  };
}

/**
 * One sequential pass over KbChunk (~74k rows). Deliberately avoids hashing
 * `content`: the byte-identical-content check is the expensive offline audit
 * (scripts/sql/kb_duplicate_cleanup.sql); this is the cheap always-on signal.
 * Prisma returns bigint for aggregates, so every value is cast to int in SQL.
 */
type KbIntegrityRow = {
  total_rows: number;
  non_deterministic_id_rows: number;
  duplicate_position_rows: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class OpsMetricsService {
  private readonly logger = new Logger(OpsMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async collect(now: Date = new Date()): Promise<OpsMetrics> {
    const since7d = new Date(now.getTime() - 7 * DAY_MS);
    const since30d = new Date(now.getTime() - 30 * DAY_MS);

    const [
      nonEvalSessions,
      distinctWhatsappContacts,
      unreviewedFlagged,
      flaggedTotal,
      safetyTotal,
      safetyByType,
      kbIntegrityRows,
    ] = await Promise.all([
      // #61 — sessions started in the window, excluding eval traffic.
      this.prisma.session.count({
        where: { createdAt: { gte: since7d }, isEval: false },
      }),
      // #61 — the one channel with a durable per-person identifier.
      this.prisma.whatsAppContact.count({
        where: { lastActiveAt: { gte: since7d } },
      }),
      // #62 — flagged for human review and not yet reviewed.
      this.prisma.session.count({
        where: { reviewFlagged: true, reviewedAt: null, isEval: false },
      }),
      this.prisma.session.count({
        where: { reviewFlagged: true, isEval: false },
      }),
      // #64 — safety events in the window, metadata only (no message text).
      this.prisma.safetyEvent.count({
        where: { createdAt: { gte: since30d }, session: { isEval: false } },
      }),
      this.prisma.safetyEvent.groupBy({
        by: ["type"],
        where: { createdAt: { gte: since30d }, session: { isEval: false } },
        _count: { _all: true },
      }),
      // #86 — duplicate KB chunk rows. ingest-kb.ts upserts on the deterministic id
      // `docId::chunk::N`, so a healthy index has one row per (docId, chunkIndex)
      // and no row with any other id shape.
      this.prisma.$queryRaw<KbIntegrityRow[]>`
        SELECT
          count(*)::int AS total_rows,
          (count(*) FILTER (WHERE id NOT LIKE '%::chunk::%'))::int AS non_deterministic_id_rows,
          (count(*) - count(DISTINCT ("docId", "chunkIndex")))::int AS duplicate_position_rows
        FROM "KbChunk"
      `,
    ]);

    const byType = ((safetyByType ?? []) as Array<{ type: string; _count: { _all: number } }>)
      .map((row) => ({ type: row.type, count: row._count._all }))
      .sort((a, b) => b.count - a.count);

    const kb = (kbIntegrityRows as KbIntegrityRow[])[0] ?? {
      total_rows: 0,
      non_deterministic_id_rows: 0,
      duplicate_position_rows: 0,
    };
    const duplicatePositionRows = Number(kb.duplicate_position_rows);
    const nonDeterministicIdRows = Number(kb.non_deterministic_id_rows);
    const kbHealthy = duplicatePositionRows === 0 && nonDeterministicIdRows === 0;

    this.logger.log(
      `ops-metrics: sessions7d=${nonEvalSessions} waContacts7d=${distinctWhatsappContacts} ` +
        `reviewQueue=${unreviewedFlagged} safety30d=${safetyTotal} ` +
        `kbDuplicateRows=${duplicatePositionRows} kbNonDeterministicIds=${nonDeterministicIdRows}`,
    );
    if (!kbHealthy) {
      this.logger.warn(
        `ops-metrics: KB index has ${duplicatePositionRows} duplicate (docId, chunkIndex) rows and ` +
          `${nonDeterministicIdRows} non-deterministic-id rows — see issue #86 and ` +
          `scripts/sql/kb_duplicate_cleanup.sql`,
      );
    }

    return {
      generatedAt: now.toISOString(),
      windows: { activeUsersDays: 7, safetyEventsDays: 30 },
      activeUsers7d: {
        value: nonEvalSessions,
        basis: { nonEvalSessions, distinctWhatsappContacts },
        caveat:
          "Sessions, not distinct humans: web/PWA visitors carry no durable identity, " +
          "so one person across two visits counts twice. distinctWhatsappContacts is the " +
          "only true per-person count. Eval traffic (Session.isEval) is excluded.",
      },
      reviewQueueSize: {
        value: unreviewedFlagged,
        basis: { flaggedTotal },
      },
      safetyEvents30d: {
        value: safetyTotal,
        byType,
      },
      kbIndexIntegrity: {
        value: duplicatePositionRows,
        basis: { totalRows: Number(kb.total_rows), nonDeterministicIdRows },
        healthy: kbHealthy,
        caveat:
          "Counts rows beyond the first per (docId, chunkIndex) and rows whose id is not the " +
          "deterministic `docId::chunk::N` shape ingest-kb.ts upserts on. Both must be 0 after " +
          "any ingest. Does not hash content, so genuine in-document repeats are not counted.",
      },
    };
  }
}
