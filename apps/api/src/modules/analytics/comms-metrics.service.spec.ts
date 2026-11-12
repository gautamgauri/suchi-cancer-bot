/**
 * Unit tests for CommsMetricsService + parseCommsMetricsRange — the privacy-safe
 * comms metrics feed (GET /v1/admin/comms-metrics).
 *
 * Contract pinned here:
 *  - the serialized response contains only known keys, and its only strings
 *    are dates, the generatedAt timestamp, channel names and the timezone
 *  - no database string (an odd channel value, a stray day key) is echoed
 *  - per-day counts 1..SMALL_CELL_SUPPRESSION_MAX are null + suppressed:true;
 *    0 and >= threshold+1 are exact; range totals are exact
 *  - the SQL reads no text / identity / clinical / geo column and excludes eval
 *  - date input is validated and bounded with structured 400s
 *
 * PrismaService is mocked — no DB. All data is synthetic counts.
 */

import { BadRequestException } from "@nestjs/common";
import {
  COMMS_CHANNELS,
  COMMS_METRICS_MAX_RANGE_DAYS,
  COMMS_METRICS_TIMEZONE,
  CommsMetricsService,
  SMALL_CELL_SUPPRESSION_MAX,
  parseCommsMetricsRange,
  suppressCell,
} from "./comms-metrics.service";
import { AdminController } from "../admin/admin.controller";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";

const NOW = new Date("2026-11-12T06:00:00.000Z");
/** A string that must never surface in a response. */
const SENTINEL = "SENTINEL_NOT_A_CHANNEL";

type Row = Record<string, unknown>;
interface Fixture {
  sessions?: Row[];
  turns?: Row[];
  feedback?: Row[];
  safety?: number;
  waContacts?: number;
}

function makePrisma(f: Fixture = {}) {
  const sqlSeen: string[] = [];
  const queryRaw = jest.fn().mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    sqlSeen.push(sql);
    if (sql.includes('FROM "Feedback"')) return Promise.resolve(f.feedback ?? []);
    if (sql.includes('FROM "Message"')) return Promise.resolve(f.turns ?? []);
    if (sql.includes('FROM "Session"')) return Promise.resolve(f.sessions ?? []);
    return Promise.reject(new Error(`unexpected SQL: ${sql}`));
  });
  return {
    sqlSeen,
    prisma: {
      $queryRaw: queryRaw,
      safetyEvent: { count: jest.fn().mockResolvedValue(f.safety ?? 0) },
      whatsAppContact: { count: jest.fn().mockResolvedValue(f.waContacts ?? 0) },
    },
  };
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
    { day: "2026-11-01", channel: "whatsapp", n: 2 },
    { day: "2026-11-03", channel: "voice", n: 6 },
  ],
  feedback: [
    { day: "2026-11-01", up: 9, down: 1 },
    { day: "2026-11-03", up: 0, down: 5 },
  ],
  safety: 3,
  waContacts: 2,
};

// ─── Privacy walk ──────────────────────────────────────────────────────────

const ALLOWED_KEYS = new Set<string>([
  "from", "to", "timezone", "generatedAt", "suppression", "minCount", "maxCount",
  "days", "date", "sessions", "chatTurns", "feedback", "up", "down",
  "count", "suppressed", "totals", "all", "safetyEvents",
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
    return key === "suppressed" ? [] : [`${path}: boolean outside 'suppressed'`];
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

describe("CommsMetricsService — privacy contract", () => {
  it("serialized response contains only known keys (channel names among them), counts, dates and the timezone", async () => {
    const { service } = makeService(RICH_FIXTURE);
    const res = await service.collect(parseCommsMetricsRange("2026-11-01", "2026-11-03"), NOW);
    const serialized = JSON.parse(JSON.stringify(res));

    expect(privacyViolations(serialized)).toEqual([]);
    expect(JSON.stringify(res)).not.toContain(SENTINEL);
  });

  it("the walker itself catches a leaked text field, unknown key and stray string", () => {
    expect(privacyViolations({ days: [{ date: "2026-11-01", userQuery: "x" }] })).not.toEqual([]);
    expect(privacyViolations({ totals: { all: "12" } })).not.toEqual([]);
    expect(privacyViolations({ from: "not-a-date" })).not.toEqual([]);
    expect(privacyViolations({ timezone: "web" })).not.toEqual([]);
  });

  it("holds over a maximum-length range with dense synthetic data", async () => {
    const range = parseCommsMetricsRange("2025-11-12", "2026-11-12");
    expect(range.dates).toHaveLength(COMMS_METRICS_MAX_RANGE_DAYS);
    const sessions = range.dates.flatMap((day, i) =>
      COMMS_CHANNELS.map((channel, j) => ({ day, channel, n: (i + j) % 9 })),
    );
    const { service } = makeService({ sessions, turns: sessions, safety: 17, waContacts: 8 });
    const res = await service.collect(range, NOW);
    expect(privacyViolations(JSON.parse(JSON.stringify(res)))).toEqual([]);
  });

  it("SQL reads no text, identity, clinical or geography column and always excludes eval traffic", async () => {
    const { service, sqlSeen, prisma } = makeService(RICH_FIXTURE);
    await service.collect(parseCommsMetricsRange("2026-11-01", "2026-11-03"), NOW);

    expect(sqlSeen).toHaveLength(3);
    const forbidden = [
      /\w\."?text"?\b/i, /"text"/i, /userQuery/i, // Message.text (the `::text` cast is fine)
      /comment/i, /reason/i, /detail/i, /payload/i,
      /cancerType/i, /userContext/i, /emotionalState/i, /userRole/i, /userType/i,
      /\bcity\b/i, /\bregion\b/i, /\bcountry\b/i, /locale/i, /waId/i,
      /SELECT[^]*\bs\.id\b[^]*FROM/i, // no session id in a select list
    ];
    for (const sql of sqlSeen) {
      for (const re of forbidden) expect(sql).not.toMatch(re);
      expect(sql).toMatch(/"isEval" = false/);
    }
    expect(prisma.safetyEvent.count).toHaveBeenCalledWith({
      where: { createdAt: expect.any(Object), session: { isEval: false } },
    });
  });
});

describe("CommsMetricsService — counts and suppression", () => {
  it("threshold is a named constant of 4: 0 exact, 1..4 suppressed, 5 exact", () => {
    expect(SMALL_CELL_SUPPRESSION_MAX).toBe(4);
    expect(suppressCell(0)).toEqual({ count: 0, suppressed: false });
    for (let n = 1; n <= SMALL_CELL_SUPPRESSION_MAX; n++) {
      expect(suppressCell(n)).toEqual({ count: null, suppressed: true });
    }
    expect(suppressCell(SMALL_CELL_SUPPRESSION_MAX + 1)).toEqual({ count: 5, suppressed: false });
  });

  it("returns zero-filled per-day cells with suppression and exact range totals", async () => {
    const { service } = makeService(RICH_FIXTURE);
    const res = await service.collect(parseCommsMetricsRange("2026-11-01", "2026-11-03"), NOW);

    expect(res.from).toBe("2026-11-01");
    expect(res.to).toBe("2026-11-03");
    expect(res.timezone).toBe("Asia/Kolkata");
    expect(res.generatedAt).toBe(NOW.toISOString());
    expect(res.suppression).toEqual({ minCount: 1, maxCount: 4 });
    expect(res.days.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);

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
    expect(d2.sessions.web).toEqual({ count: 5, suppressed: false });
    expect(d2.sessions.app).toEqual({ count: null, suppressed: true });
    expect(d3.sessions.web).toEqual({ count: 0, suppressed: false });

    expect(d1.chatTurns.web).toEqual({ count: 40, suppressed: false });
    expect(d1.chatTurns.whatsapp).toEqual({ count: null, suppressed: true });
    expect(d3.chatTurns.voice).toEqual({ count: 6, suppressed: false });

    expect(d1.feedback).toEqual({ up: { count: 9, suppressed: false }, down: { count: null, suppressed: true } });
    expect(d2.feedback).toEqual({ up: { count: 0, suppressed: false }, down: { count: 0, suppressed: false } });
    expect(d3.feedback.down).toEqual({ count: 5, suppressed: false });

    // Totals are exact, include suppressed cells, and drop the out-of-range day row.
    expect(res.totals.sessions).toEqual({ web: 17, app: 4, whatsapp: 3, voice: 0, other: 8, all: 32 });
    expect(res.totals.chatTurns).toEqual({ web: 40, app: 0, whatsapp: 2, voice: 6, other: 0, all: 48 });
    expect(res.totals.feedback).toEqual({ up: 9, down: 6 });
    expect(res.totals.safetyEvents).toBe(3);
    expect(res.totals.whatsappContactsLastActiveInRange).toBe(2);
  });

  it("queries the IST day window: from 00:00 IST inclusive to the day after `to` 00:00 IST exclusive", async () => {
    const { service, prisma } = makeService();
    await service.collect(parseCommsMetricsRange("2026-11-01", "2026-11-03"), NOW);

    const window = {
      gte: new Date("2026-10-31T18:30:00.000Z"),
      lt: new Date("2026-11-03T18:30:00.000Z"),
    };
    expect(prisma.whatsAppContact.count).toHaveBeenCalledWith({ where: { lastActiveAt: window } });
    expect(prisma.safetyEvent.count).toHaveBeenCalledWith({
      where: { createdAt: window, session: { isEval: false } },
    });
    for (const call of prisma.$queryRaw.mock.calls) {
      const values = call.slice(1);
      expect(values).toContain("Asia/Kolkata");
      expect(values).toContainEqual(window.gte);
      expect(values).toContainEqual(window.lt);
    }
  });

  it("issues no writes", async () => {
    const { service, prisma } = makeService(RICH_FIXTURE);
    await service.collect(parseCommsMetricsRange("2026-11-01", "2026-11-01"), NOW);
    expect(Object.keys(prisma).sort()).toEqual(["$queryRaw", "safetyEvent", "whatsAppContact"]);
    for (const sql of prisma.$queryRaw.mock.calls.map((c: [TemplateStringsArray]) => c[0].join("?"))) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    }
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
    ["2025-11-11", "2026-11-12", "COMMS_METRICS_RANGE_TOO_LONG"],
  ])("from=%p to=%p -> %s", (from, to, code) => {
    expect(codeOf(() => parseCommsMetricsRange(from, to)).code).toBe(code);
  });

  it("never reflects the offending input back in the error body", () => {
    const hostile = "<script>2026-11-01";
    const { body } = codeOf(() => parseCommsMetricsRange(hostile, "2026-11-03"));
    expect(JSON.stringify(body)).not.toContain(hostile);
    expect(body.field).toBe("from");
  });

  it("accepts a single day and exactly the maximum span", () => {
    expect(parseCommsMetricsRange("2026-11-12", "2026-11-12").dates).toEqual(["2026-11-12"]);
    const max = parseCommsMetricsRange("2025-11-12", "2026-11-12");
    expect(max.dates).toHaveLength(COMMS_METRICS_MAX_RANGE_DAYS);
    expect(max.from).toBe("2025-11-12");
    expect(max.to).toBe("2026-11-12");
  });

  it("handles leap days", () => {
    expect(parseCommsMetricsRange("2028-02-28", "2028-03-01").dates).toEqual([
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
    await expect(controller.getCommsMetrics("2026-11-03", "2026-11-01")).rejects.toBeInstanceOf(BadRequestException);
    expect(collect).not.toHaveBeenCalled();
  });

  it("passes the resolved IST range to the service", async () => {
    const { controller, collect } = makeController();
    await controller.getCommsMetrics("2026-11-01", "2026-11-02");
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-11-01", to: "2026-11-02", dates: ["2026-11-01", "2026-11-02"] }),
    );
  });
});
