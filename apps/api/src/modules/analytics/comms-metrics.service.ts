import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Comms metrics feed — privacy-safe daily usage aggregates for an external
 * system of record (SCCF's communications metrics), served by
 * GET /v1/admin/comms-metrics?from=YYYY-MM-DD&to=YYYY-MM-DD.
 *
 * Why a new endpoint instead of reusing admin/daily-report: daily-report
 * returns `flaggedConversations[].userQuery` (patient/caregiver text) and
 * cancer-type / geo breakdowns, so it must never be used as a feed.
 *
 * PRIVACY CONTRACT (pinned by comms-metrics.service.spec.ts and, against a
 * real Postgres, comms-metrics.pglite.spec.ts):
 *  - The response holds numbers, dates, booleans, channel names and fixed keys
 *    only. No message text, user queries, session ids, contact identifiers,
 *    user context, cancer type, city, region or country — the SQL does not
 *    select those columns.
 *  - No value read from the database is echoed as a string: channel values
 *    map onto the fixed COMMS_CHANNELS list (anything else becomes "other"),
 *    and day keys are matched against the requested date list.
 *  - Small-cell suppression: the unit of release is one IST day (per channel
 *    where there is a channel split). Every such cell from 1 to
 *    SMALL_CELL_SUPPRESSION_MAX inclusive is suppressed; 0 is reported exactly.
 *  - Complementary suppression of totals: a range total is exact ONLY when
 *    none of the day cells it sums is suppressed. Otherwise it is
 *    `{ count: null, suppressed: true, min, max }`, where min/max are exactly
 *    the bounds already implied by the cells (each suppressed cell is 1..4).
 *    Consequently every number in a response is a function of the suppressed
 *    per-day table, and because every query window is a whole number of IST
 *    days, no combination of overlapping ranges recovers a suppressed cell:
 *    `from=to` and range differencing both yield only what the per-day table
 *    already shows. safetyEvents and whatsappContactsLastActiveInRange are
 *    totalled from hidden per-day cells under the same rule, so their
 *    protection equals publishing a suppressed per-day series — a caller who
 *    queries every single day learns exactly those per-day counts (>= 5 or 0).
 *
 * WHAT THIS DOES NOT PROTECT AGAINST — do not overstate it:
 *  - Threshold suppression only hides counts of 1–4. A published 5+ is exact,
 *    and anyone with outside knowledge ("my neighbour used WhatsApp on the
 *    1st") can still learn from it.
 *  - Differencing over TIME: the current IST day is partial and changes
 *    between polls, so a credential holder polling repeatedly can watch it
 *    move (e.g. 7 -> 8 in five minutes). Past days also shrink when
 *    RetentionService deletes data. The `partial` flag marks the moving day;
 *    it does not hide it.
 *  - It is an admin endpoint: anyone holding the Basic-auth credential can
 *    issue as many queries as they like. The guarantees above are about what
 *    those queries can reveal, not about who may run them.
 *
 * Days are calendar days in COMMS_METRICS_TIMEZONE (IST). `to` may not be
 * after the current IST day. Counts are only as old as the data:
 * RetentionService deletes non-eval conversation data after 90 days, so a
 * range reaching further back under-reports — the consumer must snapshot, not
 * re-query history.
 *
 * Eval traffic (Session.isEval) is excluded from every session-linked count.
 * READ-ONLY: this service issues no writes and no DDL.
 */

/** Per-day counts from 1 up to and including this value are suppressed. */
export const SMALL_CELL_SUPPRESSION_MAX = 4;

/** Longest accepted range, inclusive of both ends. */
export const COMMS_METRICS_MAX_RANGE_DAYS = 366;

/** Day boundaries are local calendar days for SCCF (India). */
export const COMMS_METRICS_TIMEZONE = "Asia/Kolkata";
/** IST is a fixed +05:30 with no DST, so a constant offset is exact. */
const COMMS_METRICS_UTC_OFFSET_MS = 330 * 60 * 1000;

/** Session.channel values accepted by the sessions/chat DTOs, plus a catch-all. */
export const COMMS_CHANNELS = ["web", "app", "whatsapp", "voice", "other"] as const;
export type CommsChannel = (typeof COMMS_CHANNELS)[number];

/** A per-day cell. */
export type CommsCell =
  | { count: number; suppressed: false }
  | { count: null; suppressed: true };

/** A range total; when suppressed it carries only bounds implied by its cells. */
export type CommsTotal =
  | { count: number; suppressed: false }
  | { count: null; suppressed: true; min: number; max: number };

export type ChannelCells = Record<CommsChannel, CommsCell>;
export type ChannelTotals = Record<CommsChannel | "all", CommsTotal>;

export interface CommsMetricsDay {
  date: string;
  /** True for the current IST day: counts are still moving; do not store as final. */
  partial: boolean;
  sessions: ChannelCells;
  chatTurns: ChannelCells;
  feedback: { up: CommsCell; down: CommsCell };
}

export interface CommsMetrics {
  from: string;
  to: string;
  timezone: typeof COMMS_METRICS_TIMEZONE;
  generatedAt: string;
  suppression: { minCount: number; maxCount: number };
  days: CommsMetricsDay[];
  totals: {
    sessions: ChannelTotals;
    chatTurns: ChannelTotals;
    feedback: { up: CommsTotal; down: CommsTotal };
    safetyEvents: CommsTotal;
    /**
     * WhatsApp contacts whose MOST RECENT inbound message falls in the range.
     * WhatsAppContact keeps only lastActiveAt, so a contact active in the range
     * and again after `to` is not counted; exact only when `to` is today.
     * Contacts whose current session is an eval session are excluded.
     */
    whatsappContactsLastActiveInRange: CommsTotal;
  };
}

export interface CommsMetricsRange {
  from: string;
  to: string;
  /** The current IST date when the range was validated; that day is partial. */
  currentDate: string;
  /** Inclusive UTC instant of `from` 00:00 IST. */
  startUtc: Date;
  /** Exclusive UTC instant of the day after `to`, 00:00 IST. */
  endUtcExclusive: Date;
  dates: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(code: string, message: string, extra: Record<string, unknown> = {}): BadRequestException {
  // Fixed messages only — the offending input is never reflected back.
  return new BadRequestException({ statusCode: 400, error: "Bad Request", code, message, ...extra });
}

/** Returns UTC-midnight epoch ms for a strict, real YYYY-MM-DD date, or null. */
function parseDay(value: string): number | null {
  if (!DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  // Round-trip rejects 2026-02-30 and the Date.UTC two-digit-year remap.
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

function istDate(instant: Date): string {
  return new Date(instant.getTime() + COMMS_METRICS_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Validates `from`/`to` query params and resolves the IST day window.
 * Throws a structured 400 (BadRequestException) on any bad input.
 */
export function parseCommsMetricsRange(from: unknown, to: unknown, now: Date = new Date()): CommsMetricsRange {
  const parsed: Record<"from" | "to", number> = { from: 0, to: 0 };
  for (const [field, value] of [["from", from], ["to", to]] as const) {
    if (value === undefined || value === null || value === "") {
      throw badRequest("COMMS_METRICS_MISSING_PARAM", `Query parameter '${field}' is required (YYYY-MM-DD).`, { field });
    }
    const ms = typeof value === "string" ? parseDay(value) : null;
    if (ms === null) {
      throw badRequest("COMMS_METRICS_INVALID_DATE", `Query parameter '${field}' must be a real calendar date in YYYY-MM-DD form.`, { field });
    }
    parsed[field] = ms;
  }

  if (parsed.from > parsed.to) {
    throw badRequest("COMMS_METRICS_RANGE_INVERTED", "'from' must be on or before 'to'.");
  }
  const currentDate = istDate(now);
  if (parsed.to > parseDay(currentDate)!) {
    throw badRequest("COMMS_METRICS_RANGE_IN_FUTURE", "'to' may not be after the current date in Asia/Kolkata.", { field: "to" });
  }
  const days = Math.round((parsed.to - parsed.from) / DAY_MS) + 1;
  if (days > COMMS_METRICS_MAX_RANGE_DAYS) {
    throw badRequest(
      "COMMS_METRICS_RANGE_TOO_LONG",
      `The range may span at most ${COMMS_METRICS_MAX_RANGE_DAYS} days.`,
      { maxDays: COMMS_METRICS_MAX_RANGE_DAYS },
    );
  }

  const dates: string[] = [];
  for (let ms = parsed.from; ms <= parsed.to; ms += DAY_MS) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    currentDate,
    startUtc: new Date(parsed.from - COMMS_METRICS_UTC_OFFSET_MS),
    endUtcExclusive: new Date(parsed.to + DAY_MS - COMMS_METRICS_UTC_OFFSET_MS),
    dates,
  };
}

function isSuppressed(n: number): boolean {
  return n >= 1 && n <= SMALL_CELL_SUPPRESSION_MAX;
}

/** The single place a per-day count becomes a reportable cell. */
export function suppressCell(n: number): CommsCell {
  return isSuppressed(n) ? { count: null, suppressed: true } : { count: n, suppressed: false };
}

/**
 * The single place a range total is built from its per-day cells. Exact only
 * if no cell is suppressed (so the total is then 0 or >= threshold + 1, and
 * equals the sum of published cells); otherwise null with the bounds the
 * cells already imply.
 */
export function suppressTotal(cells: number[]): CommsTotal {
  let exact = 0;
  let hidden = 0;
  for (const n of cells) {
    if (isSuppressed(n)) hidden++;
    else exact += n;
  }
  return hidden === 0
    ? { count: exact, suppressed: false }
    : { count: null, suppressed: true, min: exact + hidden, max: exact + hidden * SMALL_CELL_SUPPRESSION_MAX };
}

function toChannel(raw: unknown): CommsChannel {
  return COMMS_CHANNELS.find((c) => c !== "other" && c === raw) ?? "other";
}

function zeroChannels(): Record<CommsChannel, number> {
  return { web: 0, app: 0, whatsapp: 0, voice: 0, other: 0 };
}

function channelCells(counts: Record<CommsChannel, number>): ChannelCells {
  return {
    web: suppressCell(counts.web),
    app: suppressCell(counts.app),
    whatsapp: suppressCell(counts.whatsapp),
    voice: suppressCell(counts.voice),
    other: suppressCell(counts.other),
  };
}

function channelTotals(perDay: Map<string, Record<CommsChannel, number>>): ChannelTotals {
  const days = [...perDay.values()];
  const column = (c: CommsChannel) => days.map((d) => d[c]);
  return {
    web: suppressTotal(column("web")),
    app: suppressTotal(column("app")),
    whatsapp: suppressTotal(column("whatsapp")),
    voice: suppressTotal(column("voice")),
    other: suppressTotal(column("other")),
    // Built from the same day x channel cells, so `all` minus the channel
    // totals cannot reveal a suppressed channel cell either.
    all: suppressTotal(days.flatMap((d) => COMMS_CHANNELS.map((c) => d[c]))),
  };
}

type DayChannelRow = { day: string; channel: string | null; n: number };
type DayRow = { day: string; n: number };
type FeedbackDayRow = { day: string; up: number; down: number };

@Injectable()
export class CommsMetricsService {
  private readonly logger = new Logger(CommsMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async collect(range: CommsMetricsRange, now: Date = new Date()): Promise<CommsMetrics> {
    const tz = COMMS_METRICS_TIMEZONE;
    // Bounds go in as ISO-8601 *strings with a Z offset* cast to timestamptz,
    // then converted to naive UTC — the storage form of Prisma's `timestamp(3)`
    // columns. This makes the window independent of both the DB session
    // TimeZone and of how the driver types a JS Date parameter.
    const start = range.startUtc.toISOString();
    const end = range.endUtcExclusive.toISOString();

    // Every query selects only an IST day key, Session.channel, and counts.
    // Bucketing: `col AT TIME ZONE 'UTC'` (naive UTC -> instant) then
    // timezone('Asia/Kolkata', instant) -> IST wall clock; session-TZ-proof.
    const [sessionRows, turnRows, feedbackRows, safetyRows, waRows] = await Promise.all([
      this.prisma.$queryRaw<DayChannelRow[]>`
        SELECT to_char(timezone(${tz}::text, s."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
               s.channel AS channel,
               count(*)::int AS n
        FROM "Session" s
        WHERE s."createdAt" >= (${start}::timestamptz AT TIME ZONE 'UTC')
          AND s."createdAt" < (${end}::timestamptz AT TIME ZONE 'UTC')
          AND s."isEval" = false
        GROUP BY 1, 2
      `,
      this.prisma.$queryRaw<DayChannelRow[]>`
        SELECT to_char(timezone(${tz}::text, m."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
               s.channel AS channel,
               count(*)::int AS n
        FROM "Message" m
        JOIN "Session" s ON s.id = m."sessionId"
        WHERE m."createdAt" >= (${start}::timestamptz AT TIME ZONE 'UTC')
          AND m."createdAt" < (${end}::timestamptz AT TIME ZONE 'UTC')
          AND m.role = 'user'
          AND s."isEval" = false
        GROUP BY 1, 2
      `,
      this.prisma.$queryRaw<FeedbackDayRow[]>`
        SELECT to_char(timezone(${tz}::text, f."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
               (count(*) FILTER (WHERE f.rating = 'up'))::int AS up,
               (count(*) FILTER (WHERE f.rating = 'down'))::int AS down
        FROM "Feedback" f
        JOIN "Session" s ON s.id = f."sessionId"
        WHERE f."createdAt" >= (${start}::timestamptz AT TIME ZONE 'UTC')
          AND f."createdAt" < (${end}::timestamptz AT TIME ZONE 'UTC')
          AND s."isEval" = false
        GROUP BY 1
      `,
      // Per-day only so the range total can follow the suppression rule; the
      // per-day series itself is not returned.
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(timezone(${tz}::text, e."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
               count(*)::int AS n
        FROM "SafetyEvent" e
        JOIN "Session" s ON s.id = e."sessionId"
        WHERE e."createdAt" >= (${start}::timestamptz AT TIME ZONE 'UTC')
          AND e."createdAt" < (${end}::timestamptz AT TIME ZONE 'UTC')
          AND s."isEval" = false
        GROUP BY 1
      `,
      // WhatsAppContact has no isEval of its own and no Prisma relation; its
      // sessionId is the contact's CURRENT session. Exclude contacts whose
      // current session is eval. LEFT JOIN keeps a contact whose session row
      // is gone (e.g. retention removed a long-lived session) — it is not
      // known to be eval. WhatsApp sessions are created with isEval=false
      // today (whatsapp.service -> sessions.create), so this is defensive.
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(timezone(${tz}::text, c."lastActiveAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
               count(*)::int AS n
        FROM "WhatsAppContact" c
        LEFT JOIN "Session" s ON s.id = c."sessionId"
        WHERE c."lastActiveAt" >= (${start}::timestamptz AT TIME ZONE 'UTC')
          AND c."lastActiveAt" < (${end}::timestamptz AT TIME ZONE 'UTC')
          AND s."isEval" IS DISTINCT FROM true
        GROUP BY 1
      `,
    ]);

    const sessionsByDay = this.bucketByDayChannel(range.dates, sessionRows);
    const turnsByDay = this.bucketByDayChannel(range.dates, turnRows);
    const feedbackByDay = new Map<string, { up: number; down: number }>(
      range.dates.map((d) => [d, { up: 0, down: 0 }]),
    );
    for (const row of (feedbackRows ?? []) as FeedbackDayRow[]) {
      const bucket = feedbackByDay.get(row.day);
      if (!bucket) continue; // never echo an unexpected key
      bucket.up += Number(row.up) || 0;
      bucket.down += Number(row.down) || 0;
    }
    const safetyByDay = this.bucketByDay(range.dates, safetyRows);
    const waByDay = this.bucketByDay(range.dates, waRows);

    const days: CommsMetricsDay[] = range.dates.map((date) => {
      const fb = feedbackByDay.get(date)!;
      return {
        date,
        partial: date === range.currentDate,
        sessions: channelCells(sessionsByDay.get(date)!),
        chatTurns: channelCells(turnsByDay.get(date)!),
        feedback: { up: suppressCell(fb.up), down: suppressCell(fb.down) },
      };
    });

    const feedbackDays = [...feedbackByDay.values()];
    const totals = {
      sessions: channelTotals(sessionsByDay),
      chatTurns: channelTotals(turnsByDay),
      feedback: {
        up: suppressTotal(feedbackDays.map((d) => d.up)),
        down: suppressTotal(feedbackDays.map((d) => d.down)),
      },
      safetyEvents: suppressTotal([...safetyByDay.values()]),
      whatsappContactsLastActiveInRange: suppressTotal([...waByDay.values()]),
    };

    // Aggregate log line only; no per-day values, no identifiers.
    this.logger.log(`comms-metrics: served ${range.from}..${range.to} (${range.dates.length} days)`);

    return {
      from: range.from,
      to: range.to,
      timezone: COMMS_METRICS_TIMEZONE,
      generatedAt: now.toISOString(),
      suppression: { minCount: 1, maxCount: SMALL_CELL_SUPPRESSION_MAX },
      days,
      totals,
    };
  }

  private bucketByDayChannel(dates: string[], rows: DayChannelRow[] | undefined) {
    const byDay = new Map<string, Record<CommsChannel, number>>(dates.map((d) => [d, zeroChannels()]));
    for (const row of rows ?? []) {
      const bucket = byDay.get(row.day);
      if (!bucket) continue; // never echo an unexpected key
      bucket[toChannel(row.channel)] += Number(row.n) || 0;
    }
    return byDay;
  }

  private bucketByDay(dates: string[], rows: DayRow[] | undefined) {
    const byDay = new Map<string, number>(dates.map((d) => [d, 0]));
    for (const row of rows ?? []) {
      if (!byDay.has(row.day)) continue; // never echo an unexpected key
      byDay.set(row.day, byDay.get(row.day)! + (Number(row.n) || 0));
    }
    return byDay;
  }
}
