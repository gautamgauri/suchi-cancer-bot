/**
 * Unit tests for OpsMetricsService — Ops Center collectors for issues
 * #61 (active_users_7d), #62 (review_queue_size), #64 (safety_events_30d),
 * and the #86 KB duplicate-row guard (kbIndexIntegrity).
 *
 * Contract:
 *  - every query excludes eval traffic (Session.isEval = false)
 *  - the 7d and 30d windows are computed from the injected `now`
 *  - review queue counts flagged AND not-yet-reviewed sessions only
 *  - safety events are metadata only (type + count, never message text)
 *  - the service issues no writes
 *
 * PrismaService is mocked — no DB. `now` is injected for deterministic windows.
 */

import { OpsMetricsService } from "./ops-metrics.service";

const NOW = new Date("2026-09-05T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const SINCE_7D = new Date(NOW.getTime() - 7 * DAY_MS);
const SINCE_30D = new Date(NOW.getTime() - 30 * DAY_MS);

interface Counts {
  sessions7d?: number;
  waContacts7d?: number;
  unreviewed?: number;
  flaggedTotal?: number;
  safetyTotal?: number;
  safetyByType?: Array<{ type: string; _count: { _all: number } }>;
  kb?: { total_rows: number; non_deterministic_id_rows: number; duplicate_position_rows: number };
}

function makePrisma(c: Counts = {}) {
  const sessionCount = jest.fn().mockImplementation(({ where }) => {
    if (where.reviewFlagged === true && where.reviewedAt === null) {
      return Promise.resolve(c.unreviewed ?? 0);
    }
    if (where.reviewFlagged === true) {
      return Promise.resolve(c.flaggedTotal ?? 0);
    }
    return Promise.resolve(c.sessions7d ?? 0);
  });

  return {
    session: { count: sessionCount },
    whatsAppContact: { count: jest.fn().mockResolvedValue(c.waContacts7d ?? 0) },
    safetyEvent: {
      count: jest.fn().mockResolvedValue(c.safetyTotal ?? 0),
      groupBy: jest.fn().mockResolvedValue(c.safetyByType ?? []),
    },
    // #86 — the single-row aggregate over KbChunk. Prisma hands back what the
    // SQL casts to int; the healthy shape is all zeros except total_rows.
    $queryRaw: jest.fn().mockResolvedValue([
      c.kb ?? { total_rows: 0, non_deterministic_id_rows: 0, duplicate_position_rows: 0 },
    ]),
  };
}

function makeService(c: Counts = {}) {
  const prisma = makePrisma(c);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new OpsMetricsService(prisma as any);
  return { service, prisma };
}

describe("OpsMetricsService", () => {
  it("collects all three Ops Center metrics", async () => {
    const { service } = makeService({
      sessions7d: 4,
      waContacts7d: 2,
      unreviewed: 3,
      flaggedTotal: 11,
      safetyTotal: 6,
      safetyByType: [
        { type: "emergency", _count: { _all: 1 } },
        { type: "hard_refusal", _count: { _all: 5 } },
      ],
    });

    const m = await service.collect(NOW);

    expect(m.generatedAt).toBe(NOW.toISOString());
    expect(m.windows).toEqual({ activeUsersDays: 7, safetyEventsDays: 30 });
    expect(m.activeUsers7d.value).toBe(4);
    expect(m.activeUsers7d.basis).toEqual({ nonEvalSessions: 4, distinctWhatsappContacts: 2 });
    expect(m.reviewQueueSize.value).toBe(3);
    expect(m.reviewQueueSize.basis.flaggedTotal).toBe(11);
    expect(m.safetyEvents30d.value).toBe(6);
  });

  it("reports zero honestly rather than omitting a metric", async () => {
    const { service } = makeService();

    const m = await service.collect(NOW);

    expect(m.activeUsers7d.value).toBe(0);
    expect(m.reviewQueueSize.value).toBe(0);
    expect(m.safetyEvents30d.value).toBe(0);
    expect(m.safetyEvents30d.byType).toEqual([]);
  });

  it("excludes eval traffic from every query", async () => {
    const { service, prisma } = makeService();

    await service.collect(NOW);

    for (const call of prisma.session.count.mock.calls) {
      expect(call[0].where.isEval).toBe(false);
    }
    expect(prisma.safetyEvent.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ session: { isEval: false } }) }),
    );
    expect(prisma.safetyEvent.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ session: { isEval: false } }) }),
    );
  });

  it("computes the 7d and 30d windows from the injected now", async () => {
    const { service, prisma } = makeService();

    await service.collect(NOW);

    const activeUsersCall = prisma.session.count.mock.calls.find(
      (call) => call[0].where.createdAt !== undefined,
    );
    expect(activeUsersCall?.[0].where.createdAt.gte).toEqual(SINCE_7D);
    expect(prisma.whatsAppContact.count).toHaveBeenCalledWith({
      where: { lastActiveAt: { gte: SINCE_7D } },
    });
    expect(prisma.safetyEvent.count.mock.calls[0][0].where.createdAt.gte).toEqual(SINCE_30D);
  });

  it("counts only unreviewed sessions for the review queue", async () => {
    const { service, prisma } = makeService({ unreviewed: 3, flaggedTotal: 11 });

    const m = await service.collect(NOW);

    expect(prisma.session.count).toHaveBeenCalledWith({
      where: { reviewFlagged: true, reviewedAt: null, isEval: false },
    });
    // The queue is the unreviewed subset, never the flagged total.
    expect(m.reviewQueueSize.value).toBe(3);
    expect(m.reviewQueueSize.value).not.toBe(m.reviewQueueSize.basis.flaggedTotal);
  });

  it("returns safety events as type metadata only, sorted by frequency", async () => {
    const { service } = makeService({
      safetyTotal: 8,
      safetyByType: [
        { type: "emergency", _count: { _all: 2 } },
        { type: "hard_refusal", _count: { _all: 5 } },
        { type: "safe_redirect", _count: { _all: 1 } },
      ],
    });

    const m = await service.collect(NOW);

    expect(m.safetyEvents30d.byType).toEqual([
      { type: "hard_refusal", count: 5 },
      { type: "emergency", count: 2 },
      { type: "safe_redirect", count: 1 },
    ]);
    // No message text, detail, or session id leaves the collector.
    for (const row of m.safetyEvents30d.byType) {
      expect(Object.keys(row).sort()).toEqual(["count", "type"]);
    }
  });

  it("labels active users as sessions, not distinct humans", async () => {
    const { service } = makeService({ sessions7d: 4, waContacts7d: 2 });

    const m = await service.collect(NOW);

    expect(m.activeUsers7d.caveat).toMatch(/not distinct humans/i);
    expect(m.activeUsers7d.basis.distinctWhatsappContacts).toBe(2);
  });

  it("reports KB duplicate rows and flags the index unhealthy (#86)", async () => {
    // The exact production state measured on 2026-09-06.
    const { service, prisma } = makeService({
      kb: { total_rows: 73802, non_deterministic_id_rows: 25065, duplicate_position_rows: 25065 },
    });

    const m = await service.collect(NOW);

    expect(m.kbIndexIntegrity.value).toBe(25065);
    expect(m.kbIndexIntegrity.basis).toEqual({ totalRows: 73802, nonDeterministicIdRows: 25065 });
    expect(m.kbIndexIntegrity.healthy).toBe(false);
    expect(m.kbIndexIntegrity.caveat).toMatch(/docId::chunk::N/);
    // A single aggregate query, no per-row fetch and no content hashing.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = String(prisma.$queryRaw.mock.calls[0][0]);
    expect(sql).toMatch(/FROM "KbChunk"/);
    expect(sql).not.toMatch(/md5|content\b/);
  });

  it("marks the KB index healthy only when both duplicate signals are zero (#86)", async () => {
    const clean = await makeService({
      kb: { total_rows: 48737, non_deterministic_id_rows: 0, duplicate_position_rows: 0 },
    }).service.collect(NOW);
    expect(clean.kbIndexIntegrity.healthy).toBe(true);
    expect(clean.kbIndexIntegrity.value).toBe(0);

    // A stray legacy-id row with no positional twin is still unhealthy: the next
    // ingest cannot upsert over it, so it is a duplicate waiting to happen.
    const legacyId = await makeService({
      kb: { total_rows: 48738, non_deterministic_id_rows: 1, duplicate_position_rows: 0 },
    }).service.collect(NOW);
    expect(legacyId.kbIndexIntegrity.healthy).toBe(false);
  });

  it("coerces bigint aggregates to numbers (#86)", async () => {
    const { service } = makeService({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      kb: { total_rows: BigInt(10) as any, non_deterministic_id_rows: BigInt(2) as any, duplicate_position_rows: BigInt(2) as any },
    });

    const m = await service.collect(NOW);

    expect(m.kbIndexIntegrity.value).toBe(2);
    expect(m.kbIndexIntegrity.basis.totalRows).toBe(10);
    expect(typeof m.kbIndexIntegrity.value).toBe("number");
  });

  it("is read-only — exposes no write methods to Prisma", async () => {
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new OpsMetricsService(prisma as any);

    await service.collect(NOW);

    // The mock defines only count/groupBy/$queryRaw; any write attempt would throw.
    expect(Object.keys(prisma.session)).toEqual(["count"]);
    expect(Object.keys(prisma.safetyEvent).sort()).toEqual(["count", "groupBy"]);
    // And the one raw query is a SELECT, not $executeRaw.
    expect(String(prisma.$queryRaw.mock.calls[0][0]).trim()).toMatch(/^SELECT/);
  });
});
