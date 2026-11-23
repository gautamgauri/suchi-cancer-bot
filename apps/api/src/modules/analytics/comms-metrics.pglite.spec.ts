/**
 * Real-SQL tests for CommsMetricsService against an in-process-isolated
 * Postgres (PGlite, via the rag/__test-utils__ child-process client).
 *
 * The tables come from the real Prisma datamodel (`prisma migrate diff
 * --from-empty`), so column types match production (`timestamp(3)` holding
 * naive UTC). All rows are synthetic; free-text columns hold a sentinel that
 * must never surface.
 *
 * Pinned here:
 *  - IST day boundaries: 18:29:59.999Z belongs to the previous IST day,
 *    18:30:00.000Z to the next; the window's first and last instants are in,
 *    the instants just outside are out
 *  - the result is identical whether the DB session TimeZone is UTC or
 *    Asia/Kolkata (or anything else)
 *  - eval sessions, assistant messages and out-of-window rows are excluded;
 *    feedback splits up/down
 *  - the rows the SQL returns carry only day/channel/count columns
 */

import { execFileSync } from "child_process";
import * as path from "path";
import { PgliteDatabase, PgliteProcess } from "../rag/__test-utils__/pglite-client";
import { CommsMetrics, CommsMetricsService, parseCommsMetricsRange } from "./comms-metrics.service";

const API_ROOT = path.resolve(__dirname, "../../..");
const SCHEMA_PATH = path.join(API_ROOT, "prisma", "schema.prisma");

/** 2026-11-12 11:30 IST — the test range is complete (not partial). */
const NOW = new Date("2026-11-12T06:00:00.000Z");
const SENTINEL = "SENTINEL_FREE_TEXT";

// Naive-UTC literals, the storage form Prisma writes into timestamp(3).
const FIRST_INSTANT = "2026-10-31 18:30:00.000"; // 2026-11-01 00:00:00.000 IST — in
const JUST_BEFORE = "2026-10-31 18:29:59.999"; // 2026-10-31 23:59:59.999 IST — out
const LAST_INSTANT = "2026-11-02 18:29:59.999"; // 2026-11-02 23:59:59.999 IST — in
const JUST_AFTER = "2026-11-02 18:30:00.000"; // 2026-11-03 00:00:00.000 IST — out
const NOV1_MORNING = "2026-11-01 04:00:00.000"; // 2026-11-01 09:30 IST
const NOV2_MORNING = "2026-11-02 04:00:00.000"; // 2026-11-02 09:30 IST

function baselineDdlFromSchema(): string {
  const ddl = execFileSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", SCHEMA_PATH, "--script"],
    {
      cwd: API_ROOT,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused" },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  // pgvector is not built into PGlite and nothing here touches embeddings.
  return ddl.replace(/vector\(768\)/g, "text");
}

let idSeq = 0;
const nextId = (prefix: string) => `${prefix}-${++idSeq}`;

async function seed(db: PgliteDatabase): Promise<void> {
  const session = async (id: string, channel: string, createdAt: string, isEval = false) =>
    db.query(
      `INSERT INTO "Session" (id, "createdAt", channel, "isEval", "cancerType", city, region, country, "userContext")
       VALUES ($1, $2::timestamp, $3, $4, $5, $5, $5, $5, $5)`,
      [id, createdAt, channel, isEval, SENTINEL],
    );
  const message = async (sessionId: string, role: string, createdAt: string) =>
    db.query(`INSERT INTO "Message" (id, "sessionId", "createdAt", role, text) VALUES ($1, $2, $3::timestamp, $4, $5)`, [
      nextId("msg"), sessionId, createdAt, role, SENTINEL,
    ]);
  const feedback = async (sessionId: string, rating: string, createdAt: string) =>
    db.query(
      `INSERT INTO "Feedback" (id, "sessionId", "createdAt", rating, reason, comment) VALUES ($1, $2, $3::timestamp, $4, $5, $5)`,
      [nextId("fb"), sessionId, createdAt, rating, SENTINEL],
    );
  const safety = async (sessionId: string, createdAt: string) =>
    db.query(
      `INSERT INTO "SafetyEvent" (id, "sessionId", "createdAt", type, detail) VALUES ($1, $2, $3::timestamp, 'synthetic', $4)`,
      [nextId("se"), sessionId, createdAt, SENTINEL],
    );
  const contact = async (sessionId: string, lastActiveAt: string) =>
    db.query(`INSERT INTO "WhatsAppContact" ("waId", "sessionId", "lastActiveAt") VALUES ($1, $2, $3::timestamp)`, [
      nextId("wa-synthetic"), sessionId, lastActiveAt,
    ]);
  const times = async (n: number, fn: () => Promise<unknown>) => {
    for (let i = 0; i < n; i++) await fn();
  };

  // Sessions: web Nov 1 = 5 (at the window's first instant), web Nov 2 = 5 (at
  // its last instant), whatsapp Nov 2 = 2; boundary-adjacent and eval rows out.
  for (let i = 1; i <= 5; i++) await session(`web-first-${i}`, "web", FIRST_INSTANT);
  for (let i = 1; i <= 5; i++) await session(`web-last-${i}`, "web", LAST_INSTANT);
  await session("web-just-before", "web", JUST_BEFORE);
  await session("web-just-after", "web", JUST_AFTER);
  for (let i = 1; i <= 3; i++) await session(`eval-${i}`, "web", NOV1_MORNING, true);
  await session("wa-1", "whatsapp", NOV2_MORNING);
  await session("wa-2", "whatsapp", NOV2_MORNING);

  // Chat turns: 6 user (Nov 1) + 5 user at the last instant (Nov 2) count;
  // assistant, eval-session and out-of-window messages do not.
  await times(6, () => message("web-first-1", "user", NOV1_MORNING));
  await times(4, () => message("web-first-1", "assistant", NOV1_MORNING));
  await times(5, () => message("eval-1", "user", NOV1_MORNING));
  await times(5, () => message("web-last-1", "user", LAST_INSTANT));
  await times(5, () => message("web-last-1", "user", JUST_AFTER));
  await times(5, () => message("web-first-2", "user", JUST_BEFORE));

  // Feedback: Nov 1 up = 5, down = 2; eval and out-of-window feedback ignored.
  await times(5, () => feedback("web-first-1", "up", NOV1_MORNING));
  await times(2, () => feedback("web-first-1", "down", NOV1_MORNING));
  await times(5, () => feedback("eval-1", "up", NOV1_MORNING));
  await times(5, () => feedback("web-last-1", "up", JUST_AFTER));

  // Safety events: 6 count; eval and out-of-window ones do not.
  await times(6, () => safety("web-first-1", NOV1_MORNING));
  await times(4, () => safety("eval-1", NOV1_MORNING));
  await times(5, () => safety("web-first-1", JUST_BEFORE));

  // WhatsApp contacts: 5 on non-eval sessions + 1 whose session row is gone
  // count; one on an eval session and one after the window do not.
  await times(5, () => contact("wa-1", LAST_INSTANT));
  await contact("session-removed-by-retention", LAST_INSTANT);
  await contact("eval-1", LAST_INSTANT);
  await contact("wa-2", JUST_AFTER);
}

/** A PrismaService stand-in that runs the service's real tagged-template SQL. */
function prismaOn(db: PgliteDatabase, rowsSeen: Array<Record<string, unknown>>) {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), "");
      const rows = await db.query(sql, values);
      rowsSeen.push(...rows);
      return rows;
    },
  };
}

const EXPECTED_TOTALS: CommsMetrics["totals"] = {
  sessions: {
    web: { count: 10, suppressed: false },
    app: { count: 0, suppressed: false },
    whatsapp: { count: null, suppressed: true, min: 1, max: 4 },
    voice: { count: 0, suppressed: false },
    other: { count: 0, suppressed: false },
    all: { count: null, suppressed: true, min: 11, max: 14 },
  },
  chatTurns: {
    web: { count: 11, suppressed: false },
    app: { count: 0, suppressed: false },
    whatsapp: { count: 0, suppressed: false },
    voice: { count: 0, suppressed: false },
    other: { count: 0, suppressed: false },
    all: { count: 11, suppressed: false },
  },
  feedback: {
    up: { count: 5, suppressed: false },
    down: { count: null, suppressed: true, min: 1, max: 4 },
  },
  safetyEvents: { count: 6, suppressed: false },
  whatsappContactsLastActiveInRange: { count: 6, suppressed: false },
};

describe("CommsMetricsService against real Postgres (PGlite)", () => {
  jest.setTimeout(240_000);

  let proc: PgliteProcess;
  let db: PgliteDatabase;

  beforeAll(async () => {
    proc = PgliteProcess.start();
    db = await proc.createDatabase();
    await db.exec(baselineDdlFromSchema());
    await seed(db);
  });

  afterAll(async () => {
    await proc?.stop();
  });

  it("the datamodel stores createdAt/lastActiveAt as naive timestamp(3) — the premise of the UTC casts", async () => {
    const cols = await db.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE column_name IN ('createdAt', 'lastActiveAt')
         AND table_name IN ('Session', 'Message', 'Feedback', 'SafetyEvent', 'WhatsAppContact')`,
    );
    expect(cols).toHaveLength(6); // WhatsAppContact has both
    for (const c of cols) expect(c.data_type).toBe("timestamp without time zone");
  });

  it.each(["UTC", "Asia/Kolkata", "America/Los_Angeles"])(
    "IST day boundaries, eval/role/rating filters and totals hold with session TimeZone %s",
    async (tz) => {
      await db.exec(`SET TIME ZONE '${tz}'`);
      const rowsSeen: Array<Record<string, unknown>> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new CommsMetricsService(prismaOn(db, rowsSeen) as any);
      const res = await service.collect(parseCommsMetricsRange("2026-11-01", "2026-11-02", NOW), NOW);

      expect(res.days.map((d) => [d.date, d.partial])).toEqual([["2026-11-01", false], ["2026-11-02", false]]);
      const [nov1, nov2] = res.days;
      expect(nov1.sessions.web).toEqual({ count: 5, suppressed: false }); // first instant is in
      expect(nov2.sessions.web).toEqual({ count: 5, suppressed: false }); // last instant is in
      expect(nov2.sessions.whatsapp).toEqual({ count: null, suppressed: true });
      expect(nov1.chatTurns.web).toEqual({ count: 6, suppressed: false });
      expect(nov2.chatTurns.web).toEqual({ count: 5, suppressed: false });
      expect(nov1.feedback).toEqual({ up: { count: 5, suppressed: false }, down: { count: null, suppressed: true } });
      expect(nov2.feedback).toEqual({ up: { count: 0, suppressed: false }, down: { count: 0, suppressed: false } });
      expect(res.totals).toEqual(EXPECTED_TOTALS);

      // What the SQL hands back is day keys, channel names and counts only.
      expect(rowsSeen.length).toBeGreaterThan(0);
      for (const row of rowsSeen) {
        for (const k of Object.keys(row)) expect(["day", "channel", "n", "up", "down"]).toContain(k);
      }
      const out = JSON.stringify(res);
      for (const leak of [SENTINEL, "wa-synthetic", "web-first", "eval-", "session-removed"]) {
        expect(out).not.toContain(leak);
      }
    },
  );

  it("the day just outside each end lands in its own IST day when the range widens", async () => {
    await db.exec(`SET TIME ZONE 'Asia/Kolkata'`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new CommsMetricsService(prismaOn(db, []) as any);
    const res = await service.collect(parseCommsMetricsRange("2026-10-31", "2026-11-03", NOW), NOW);
    // web: Oct 31 = 1 (just-before), Nov 3 = 1 (just-after) — suppressed, but present.
    expect(res.days.map((d) => d.sessions.web)).toEqual([
      { count: null, suppressed: true },
      { count: 5, suppressed: false },
      { count: 5, suppressed: false },
      { count: null, suppressed: true },
    ]);
    expect(res.totals.sessions.web).toEqual({ count: null, suppressed: true, min: 12, max: 18 });
  });
});
