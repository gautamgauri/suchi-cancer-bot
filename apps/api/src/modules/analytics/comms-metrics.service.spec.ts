/**
 * Unit tests for CommsMetricsService + parseCommsMetricsRange — the privacy-safe
 * comms metrics feed (GET /v1/admin/comms-metrics).
 *
 * Contract pinned here (the SQL itself runs against real Postgres in
 * comms-metrics.pglite.spec.ts):
 *  - the serialized response contains only known keys, and its only strings
 *    are dates, the generatedAt timestamp and the timezone
 *  - no database string (an odd channel value, a stray day key) is echoed
 *  - per-day counts 1..SMALL_CELL_SUPPRESSION_MAX are null + suppressed:true
 *  - every range total is exact only when none of its day cells is
 *    suppressed (complementary suppression), so from=to and overlapping
 *    ranges cannot recover a suppressed cell
 *  - the SQL selects only day keys, channel and counts, and excludes eval
 *  - date input is validated and bounded with structured 400s; `to` may not
 *    be in the future and the current IST day is marked partial
 *
 * PrismaService is mocked — no DB. All data is synthetic counts.
 */

import { BadRequestException } from "@nestjs/common";
import {
  COMMS_CHANNELS,
  COMMS_METRICS_MAX_RANGE_DAYS,
  COMMS_METRICS_TIMEZONE,
  CommsMetrics,
  CommsMetricsService,
  CommsTotal,
  SMALL_CELL_SUPPRESSION_MAX,
  parseCommsMetricsRange,
  suppressCell,
  suppressTotal,
} from "./comms-metrics.service";
import { AdminController } from "../admin/admin.controller";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";

/** 2026-11-12 11:30 IST. */
const NOW = new Date("2026-11-12T06:00:00.000Z");
/** A string that must never surface in a response. */
const SENTINEL = "SENTINEL_NOT_A_CHANNEL";

const range = (from: string, to: string) => parseCommsMetricsRange(from, to, NOW);

type Row = Record<string, unknown>;
interface Fixture {
  sessions?: Row[];
  turns?: Row[];
  feedback?: Row[];
  safety?: Row[];
  wa?: Row[];
}

function makePrisma(f: Fixture = {}) {
  const sqlSeen: string[] = [];
  const queryRaw = jest.fn().mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    sqlSeen.push(sql);
    const from = /FROM "(\w+)"/.exec(sql)?.[1];
    const rows: Record<string, Row[] | undefined> = {
      Session: f.sessions,
      Message: f.turns,
      Feedback: f.feedback,
      SafetyEvent: f.safety,
      WhatsAppContact: f.wa,
    };
    if (!from || !(from in rows)) return Promise.reject(new Error(`unexpected SQL: ${sql}`));
    return Promise.resolve(rows[from] ?? []);
  });
  return { sqlSeen, prisma: { $queryRaw: queryRaw } };
}

function makeService(f: Fixture = {}) {
  const m = makePrisma(f);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new CommsMetricsService(m.prisma as any), ...m };
}

const RICH_FIXTURE: Fixture = {
  sessions: [
    { day: "2026-11-01", channel: "web", n: 12 },
    { day: "2026-11-01", channel: "whatsapp", n: 3 },
    { day: "2026-11-01", channel: "voice", n: 0 },
    { day: "2026-11-02", channel: "web", n: 5 },
    { day: "2026-11-02", channel: "app", n: 4 },
    { day: "2026-11-02", channel: SENTINEL, n: 7 },
    { day: "2026-11-02", channel: null, n: 1 },
    // A day outside the requested range must be dropped, not echoed.
    { day: SENTINEL, channel: "web", n: 99 },
  ],
  turns: [
    { day: "2026-11-01", channel: "web", n: 40 },
    { day: "2026-11-03", channel: "voice", n: 6 },
  ],
  feedback: [
    { day: "2026-11-01", up: 9, down: 1 },
    { day: "2026-11-03", up: 0, down: 5 },
  ],
  safety: [
    { day: "2026-11-01", n: 6 },
    { day: "2026-11-02", n: 2 },
  ],
  wa: [{ day: "2026-11-03", n: 7 }],
};

// ─── Privacy walk ──────────────────────────────────────────────────────────

const ALLOWED_KEYS = new Set<string>([
  "from", "to", "timezone", "generatedAt", "suppression", "minCount", "maxCount",
  "days", "date", "partial", "sessions", "chatTurns", "feedback", "up", "down",
  "count", "suppressed", "min", "max", "totals", "all", "safetyEvents",
  "whatsappContactsLastActiveInRange",
  ...COMMS_CHANNELS,
]);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Returns a list of violations; empty means the payload is numbers/dates/known keys only. */
function privacyViolations(value: unknown, path = "$", key?: string): string[] {
  if (value === null) return [];
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? [] : [`${path}: non-count number ${value}`];
  }
  if (typeof value === "boolean") {
    return key === "suppressed" || key === "partial" ? [] : [`${path}: boolean outside 'suppressed'/'partial'`];
  }
  if (typeof value === "string") {
    if (DATE_ONLY.test(value) && (key === "date" || key === "from" || key === "to")) return [];
    if (ISO_DATETIME.test(value) && key === "generatedAt") return [];
    if (key === "timezone" && value === COMMS_METRICS_TIMEZONE) return [];
    return [`${path}: disallowed string`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => privacyViolations(v, `${path}[${i}]`, key === "days" ? "day" : key));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(ALLOWED_KEYS.has(k) ? [] : [`${path}: unknown key '${k}'`]),
      ...privacyViolations(v, `${path}.${k}`, k),
    ]);
  }
  return [`${path}: unexpected ${typeof value}`];
}

/** Every per-day number in a response, keyed so the property test can rebuild columns. */
function dayCells(res: CommsMetrics): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const d of res.days) {
    for (const c of COMMS_CHANNELS) {
      out.set(`${d.date}/sessions/${c}`, d.sessions[c].count);
      out.set(`${d.date}/chatTurns/${c}`, d.chatTurns[c].count);
    }
    out.set(`${d.date}/feedback/up`, d.feedback.up.count);
    out.set(`${d.date}/feedback/down`, d.feedback.down.count);
  }
  return out;
}

/** The total the published day cells alone imply — what a response may say and no more. */
function impliedTotal(cells: Array<number | null>): CommsTotal {
  const hidden = cells.filter((c) => c === null).length;
  const exact = cells.reduce<number>((a, c) => a + (c ?? 0), 0);
  return hidden === 0
    ? { count: exact, suppressed: false }
    : { count: null, suppressed: true, min: exact + hidden, max: exact + hidden * SMALL_CELL_SUPPRESSION_MAX };
}

describe("CommsMetricsService — privacy contract", () => {
  it("serialized response contains only known keys (channel names among them), counts, dates, flags and the timezone", async () => {
    const { service } = makeService(RICH_FIXTURE);
    const res = await service.collect(range("2026-11-01", "2026-11-03"), NOW);
    const serialized = JSON.parse(JSON.stringify(res));

    expect(privacyViolations(serialized)).toEqual([]);
    expect(JSON.stringify(res)).not.toContain(SENTINEL);
  });

  it("the walker itself catches a leaked text field, unknown key and stray string or flag", () => {
    expect(privacyViolations({ days: [{ date: "2026-11-01", userQuery: "x" }] })).not.toEqual([]);
    expect(privacyViolations({ totals: { all: "12" } })).not.toEqual([]);
    expect(privacyViolations({ from: "not-a-date" })).not.toEqual([]);
    expect(privacyViolations({ timezone: "web" })).not.toEqual([]);
    expect(privacyViolations({ count: true })).not.toEqual([]);
    expect(privacyViolations({ count: 1.5 })).not.toEqual([]);
  });

  it("holds over a maximum-length range with dense synthetic data", async () => {
    const r = range("2025-11-12", "2026-11-12");
    expect(r.dates).toHaveLength(COMMS_METRICS_MAX_RANGE_DAYS);
    const sessions = r.dates.flatMap((day, i) =>
      COMMS_CHANNELS.map((channel, j) => ({ day, channel, n: (i + j) % 9 })),
    );
    const perDay = r.dates.map((day, i) => ({ day, n: i % 7, up: i % 6, down: i % 3 }));
    const { service } = makeService({ sessions, turns: sessions, feedback: perDay, safety: perDay, wa: perDay });
    const res = await service.collect(r, NOW);
    expect(privacyViolations(JSON.parse(JSON.stringify(res)))).toEqual([]);
  });

  it("SQL selects only a day key, Session.channel and counts — allow-listed columns, eval excluded", async () => {
    const { service, sqlSeen } = makeService(RICH_FIXTURE);
    await service.collect(range("2026-11-01", "2026-11-03"), NOW);

    expect(sqlSeen).toHaveLength(5);
    // Deny by default: every column reference is alias-qualified and on this list.
    const ALLOWED_COLUMNS = new Set(["createdAt", "lastActiveAt", "channel", "isEval", "role", "rating", "id", "sessionId"]);
    // In the select list (what can come back), only these may appear.
    const SELECTABLE = new Set(["createdAt", "lastActiveAt", "channel", "rating"]);
    for (const sql of sqlSeen) {
      const refs = [...sql.matchAll(/\b[a-z]\."?(\w+)"?/g)].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(0);
      for (const col of refs) expect(ALLOWED_COLUMNS).toContain(col);

      const selectList = /SELECT([^]*?)\bFROM\b/.exec(sql)![1];
      for (const [, col] of selectList.matchAll(/\b[a-z]\."?(\w+)"?/g)) expect(SELECTABLE).toContain(col);
      const aliases = [...selectList.matchAll(/\bAS (\w+)/g)].map((m) => m[1]);
      for (const a of aliases) expect(["day", "channel", "n", "up", "down"]).toContain(a);

      expect(sql).toMatch(/s\."isEval" (= false|IS DISTINCT FROM true)/);
    }
  });

  it("WHERE bounds are ISO strings cast through timestamptz to naive UTC (session-TimeZone-proof)", async () => {
    const { service, prisma, sqlSeen } = makeService();
    await service.collect(range("2026-11-01", "2026-11-03"), NOW);
    for (const sql of sqlSeen) {
      expect(sql.match(/\(\?::timestamptz AT TIME ZONE 'UTC'\)/g)).toHaveLength(2);
    }
    for (const call of prisma.$queryRaw.mock.calls) {
      expect(call.slice(1)).toEqual(["Asia/Kolkata", "2026-10-31T18:30:00.000Z", "2026-11-03T18:30:00.000Z"]);
    }
  });

  it("issues no writes", async () => {
    const { service, prisma, sqlSeen } = makeService(RICH_FIXTURE);
    await service.collect(range("2026-11-01", "2026-11-01"), NOW);
    expect(Object.keys(prisma)).toEqual(["$queryRaw"]);
    for (const sql of sqlSeen) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    }
  });
});

describe("CommsMetricsService — suppression", () => {
  it("threshold is a named constant of 4: 0 exact, 1..4 suppressed, 5 exact", () => {
    expect(SMALL_CELL_SUPPRESSION_MAX).toBe(4);
    expect(suppressCell(0)).toEqual({ count: 0, suppressed: false });
    for (let n = 1; n <= SMALL_CELL_SUPPRESSION_MAX; n++) {
      expect(suppressCell(n)).toEqual({ count: null, suppressed: true });
    }
    expect(suppressCell(SMALL_CELL_SUPPRESSION_MAX + 1)).toEqual({ count: 5, suppressed: false });
  });

  it("a total is exact only when no constituent cell is suppressed; otherwise only implied bounds", () => {
    expect(suppressTotal([])).toEqual({ count: 0, suppressed: false });
    expect(suppressTotal([0, 5, 12])).toEqual({ count: 17, suppressed: false });
    for (let n = 1; n <= 4; n++) {
      expect(suppressTotal([n])).toEqual({ count: null, suppressed: true, min: 1, max: 4 });
    }
    expect(suppressTotal([12, 3, 0, 2])).toEqual({ count: null, suppressed: true, min: 14, max: 20 });
  });

  it("a range total of 1..4 is never exact (including safety events and WhatsApp contacts)", async () => {
    const { service } = makeService({
      sessions: [{ day: "2026-11-01", channel: "web", n: 3 }],
      safety: [{ day: "2026-11-01", n: 1 }],
      wa: [{ day: "2026-11-01", n: 4 }],
      feedback: [{ day: "2026-11-01", up: 2, down: 0 }],
    });
    const res = await service.collect(range("2026-11-01", "2026-11-01"), NOW);
    const hidden = { count: null, suppressed: true, min: 1, max: 4 };
    expect(res.totals.sessions.web).toEqual(hidden);
    expect(res.totals.sessions.all).toEqual(hidden);
    expect(res.totals.safetyEvents).toEqual(hidden);
    expect(res.totals.whatsappContactsLastActiveInRange).toEqual(hidden);
    expect(res.totals.feedback.up).toEqual(hidden);
    expect(res.totals.feedback.down).toEqual({ count: 0, suppressed: false });
  });

  it("from=to cannot reveal a suppressed day: the totals say exactly what the cells say", async () => {
    const { service } = makeService(RICH_FIXTURE);
    const res = await service.collect(range("2026-11-01", "2026-11-01"), NOW);
    expect(res.days[0].sessions.whatsapp).toEqual({ count: null, suppressed: true });
    expect(res.totals.sessions.whatsapp).toEqual({ count: null, suppressed: true, min: 1, max: 4 });
    expect(res.totals.feedback.down).toEqual({ count: null, suppressed: true, min: 1, max: 4 });
  });

  it("totals carry no information beyond the published day cells (property over overlapping ranges)", async () => {
    // Deterministic pseudo-random synthetic counts, dense in the 0..8 band.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 9;
    const r = range("2026-10-01", "2026-10-31");
    const sessions = r.dates.flatMap((day) => COMMS_CHANNELS.map((channel) => ({ day, channel, n: rnd() })));
    const feedback = r.dates.map((day) => ({ day, up: rnd(), down: rnd() }));
    const { service } = makeService({ sessions, turns: sessions, feedback });

    const windows: Array<[string, string]> = [
      ["2026-10-01", "2026-10-31"], ["2026-10-01", "2026-10-30"], ["2026-10-02", "2026-10-31"],
      ["2026-10-10", "2026-10-10"], ["2026-10-10", "2026-10-11"], ["2026-10-05", "2026-10-20"],
    ];
    let sawSuppressedTotal = false;
    for (const [from, to] of windows) {
      const res = await service.collect(range(from, to), NOW);
      const cells = dayCells(res);
      const col = (metric: string, key: string) => res.days.map((d) => cells.get(`${d.date}/${metric}/${key}`)!);
      for (const metric of ["sessions", "chatTurns"] as const) {
        for (const c of COMMS_CHANNELS) {
          expect(res.totals[metric][c]).toEqual(impliedTotal(col(metric, c)));
          sawSuppressedTotal ||= res.totals[metric][c].suppressed;
        }
        expect(res.totals[metric].all).toEqual(impliedTotal(COMMS_CHANNELS.flatMap((c) => col(metric, c))));
      }
      expect(res.totals.feedback.up).toEqual(impliedTotal(col("feedback", "up")));
      expect(res.totals.feedback.down).toEqual(impliedTotal(col("feedback", "down")));
    }
    expect(sawSuppressedTotal).toBe(true);
  });
});

describe("CommsMetricsService — counts", () => {
  it("returns zero-filled per-day cells and complementary-suppressed totals", async () => {
    const { service } = makeService(RICH_FIXTURE);
    const res = await service.collect(range("2026-11-01", "2026-11-03"), NOW);

    expect(res.from).toBe("2026-11-01");
    expect(res.to).toBe("2026-11-03");
    expect(res.timezone).toBe("Asia/Kolkata");
    expect(res.generatedAt).toBe(NOW.toISOString());
    expect(res.suppression).toEqual({ minCount: 1, maxCount: 4 });
    expect(res.days.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(res.days.map((d) => d.partial)).toEqual([false, false, false]);

    const [d1, d2, d3] = res.days;
    expect(d1.sessions).toEqual({
      web: { count: 12, suppressed: false },
      app: { count: 0, suppressed: false },
      whatsapp: { count: null, suppressed: true },
      voice: { count: 0, suppressed: false },
      other: { count: 0, suppressed: false },
    });
    // Unknown and null channel values fold into "other" (7 + 1 = 8, reportable).
    expect(d2.sessions.other).toEqual({ count: 8, suppressed: false });
    expect(d2.sessions.app).toEqual({ count: null, suppressed: true });
    expect(d3.sessions.web).toEqual({ count: 0, suppressed: false });
    expect(d1.chatTurns.web).toEqual({ count: 40, suppressed: false });
    expect(d3.chatTurns.voice).toEqual({ count: 6, suppressed: false });
    expect(d1.feedback).toEqual({ up: { count: 9, suppressed: false }, down: { count: null, suppressed: true } });
    expect(d3.feedback.down).toEqual({ count: 5, suppressed: false });

    // The out-of-range SENTINEL day row (n=99) is dropped.
    expect(res.totals.sessions).toEqual({
      web: { count: 17, suppressed: false },
      app: { count: null, suppressed: true, min: 1, max: 4 },
      whatsapp: { count: null, suppressed: true, min: 1, max: 4 },
      voice: { count: 0, suppressed: false },
      other: { count: 8, suppressed: false },
      all: { count: null, suppressed: true, min: 27, max: 33 },
    });
    expect(res.totals.chatTurns.all).toEqual({ count: 46, suppressed: false });
    expect(res.totals.feedback).toEqual({
      up: { count: 9, suppressed: false },
      down: { count: null, suppressed: true, min: 6, max: 9 },
    });
    expect(res.totals.safetyEvents).toEqual({ count: null, suppressed: true, min: 7, max: 10 });
    expect(res.totals.whatsappContactsLastActiveInRange).toEqual({ count: 7, suppressed: false });
  });

  it("marks only the current IST day as partial", async () => {
    const { service } = makeService();
    const res = await service.collect(range("2026-11-11", "2026-11-12"), NOW);
    expect(res.days.map((d) => [d.date, d.partial])).toEqual([["2026-11-11", false], ["2026-11-12", true]]);
  });
});

describe("parseCommsMetricsRange — validation", () => {
  function codeOf(fn: () => unknown): { code?: string; body: Record<string, unknown> } {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as Record<string, unknown>;
      expect(body.statusCode).toBe(400);
      return { code: body.code as string, body };
    }
    throw new Error("expected a BadRequestException");
  }

  it.each([
    [undefined, "2026-11-01", "COMMS_METRICS_MISSING_PARAM"],
    ["2026-11-01", undefined, "COMMS_METRICS_MISSING_PARAM"],
    ["", "2026-11-01", "COMMS_METRICS_MISSING_PARAM"],
    ["2026-11-1", "2026-11-03", "COMMS_METRICS_INVALID_DATE"],
    ["2026/11/01", "2026-11-03", "COMMS_METRICS_INVALID_DATE"],
    ["2026-02-30", "2026-03-03", "COMMS_METRICS_INVALID_DATE"],
    ["0005-01-01", "0005-01-02", "COMMS_METRICS_INVALID_DATE"],
    ["2026-11-01T00:00:00Z", "2026-11-03", "COMMS_METRICS_INVALID_DATE"],
    [["2026-11-01", "2026-11-02"], "2026-11-03", "COMMS_METRICS_INVALID_DATE"],
    ["2026-11-03", "2026-11-01", "COMMS_METRICS_RANGE_INVERTED"],
    ["2026-11-01", "2026-11-13", "COMMS_METRICS_RANGE_IN_FUTURE"],
    ["2025-11-11", "2026-11-12", "COMMS_METRICS_RANGE_TOO_LONG"],
  ])("from=%p to=%p -> %s", (from, to, code) => {
    expect(codeOf(() => parseCommsMetricsRange(from, to, NOW)).code).toBe(code);
  });

  it("'today' is the IST date, not the UTC date", () => {
    // 2026-11-12 19:00Z is already 2026-11-13 00:30 IST.
    const lateUtc = new Date("2026-11-12T19:00:00.000Z");
    expect(parseCommsMetricsRange("2026-11-13", "2026-11-13", lateUtc).currentDate).toBe("2026-11-13");
    // 2026-11-12 18:29Z is still 2026-11-12 23:59 IST.
    const beforeMidnight = new Date("2026-11-12T18:29:00.000Z");
    expect(codeOf(() => parseCommsMetricsRange("2026-11-13", "2026-11-13", beforeMidnight)).code)
      .toBe("COMMS_METRICS_RANGE_IN_FUTURE");
  });

  it("never reflects the offending input back in the error body", () => {
    const hostile = "<script>2026-11-01";
    const { body } = codeOf(() => parseCommsMetricsRange(hostile, "2026-11-03", NOW));
    expect(JSON.stringify(body)).not.toContain(hostile);
    expect(body.field).toBe("from");
  });

  it("accepts a single day and exactly the maximum span", () => {
    expect(range("2026-11-12", "2026-11-12").dates).toEqual(["2026-11-12"]);
    const max = range("2025-11-12", "2026-11-12");
    expect(max.dates).toHaveLength(COMMS_METRICS_MAX_RANGE_DAYS);
    expect(max.from).toBe("2025-11-12");
    expect(max.to).toBe("2026-11-12");
  });

  it("handles leap days", () => {
    const leapNow = new Date("2028-03-05T00:00:00.000Z");
    expect(parseCommsMetricsRange("2028-02-28", "2028-03-01", leapNow).dates).toEqual([
      "2028-02-28", "2028-02-29", "2028-03-01",
    ]);
  });
});

describe("AdminController GET comms-metrics", () => {
  function makeController(collect = jest.fn().mockResolvedValue({ ok: true })) {
    const args = new Array(AdminController.length).fill(undefined);
    // commsMetrics is the last constructor dependency.
    args[args.length - 1] = { collect };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { controller: new (AdminController as any)(...args) as AdminController, collect };
  }

  it("is protected by BasicAuthGuard like the other admin read endpoints", () => {
    const guards = Reflect.getMetadata("__guards__", AdminController.prototype.getCommsMetrics);
    expect(guards).toEqual([BasicAuthGuard]);
  });

  it("validates the range before touching the service", async () => {
    const { controller, collect } = makeController();
    await expect(controller.getCommsMetrics("2026-01-03", "2026-01-01")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getCommsMetrics("2026-01-01", "2999-01-01")).rejects.toBeInstanceOf(BadRequestException);
    expect(collect).not.toHaveBeenCalled();
  });

  it("passes the resolved IST range to the service", async () => {
    const { controller, collect } = makeController();
    await controller.getCommsMetrics("2026-01-01", "2026-01-02");
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-01-01", to: "2026-01-02", dates: ["2026-01-01", "2026-01-02"] }),
    );
  });
});
