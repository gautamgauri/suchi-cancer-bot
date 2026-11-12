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
 * PRIVACY CONTRACT (pinned by comms-metrics.service.spec.ts):
 *  - The response holds numbers, dates, channel names and fixed keys only.
 *    No message text, user queries, session ids, contact identifiers, user
 *    context, cancer type, city, region or country — the SQL below does not
 *    even read those columns.
 *  - No value read from the database is echoed as a string: channel values
 *    are mapped onto the fixed COMMS_CHANNELS list (anything else becomes
 *    "other"), and day keys are matched against the requested date list.
 *  - Small-cell suppression: every per-day count from 1 to
 *    SMALL_CELL_SUPPRESSION_MAX inclusive is returned as
 *    `{ count: null, suppressed: true }`. Zero is reported exactly. Range
 *    totals are exact (owner decision) — note that an exact total plus the
 *    other cells can reveal a single suppressed cell by subtraction; there is
 *    no complementary suppression.
 *  - Eval traffic (Session.isEval) is excluded from every session-linked count.
 *
 * Days are calendar days in COMMS_METRICS_TIMEZONE (IST). Counts are only as
 * old as the data: RetentionService deletes non-eval conversation data after
 * 90 days, so a range reaching further back under-reports — the consumer must
 * snapshot, not re-query history.
 *
 * READ-ONLY: this service issues no writes and no DDL.
 */

/** Per-day counts from 1 up to and including this value are suppressed. */
export const SMALL_CELL_SUPPRESSION_MAX = 4;

/** Longest accepted range, inclusive of both ends. */
export const COMMS_METRICS_MAX_RANGE_DAYS = 366;

/** Day boundaries are local calendar days for SCCF (India). */
export const COMMS_METRICS_TIMEZONE = "Asia/Kolkata";
/** IST is a fixed +05:30 with no DST, so a constant offset is exact. */
const COMMS_METRICS_UTC_OFFSET_MINUTES = 330;

/** Session.channel values accepted by the sessions/chat DTOs, plus a catch-all. */
export const COMMS_CHANNELS = ["web", "app", "whatsapp", "voice", "other"] as const;
export type CommsChannel = (typeof COMMS_CHANNELS)[number];

export type CommsCell =
  | { count: number; suppressed: false }
  | { count: null; suppressed: true };

export type ChannelCells = Record<CommsChannel, CommsCell>;
export type ChannelTotals = Record<CommsChannel | "all", number>;

export interface CommsMetricsDay {
  date: string;
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
    feedback: { up: number; down: number };
    safetyEvents: number;
    /**
     * WhatsApp contacts whose MOST RECENT inbound message falls in the range.
     * WhatsAppContact keeps only lastActiveAt, so a contact active in the range
     * and again after `to` is not counted; exact only when `to` is today.
     */
    whatsappContactsLastActiveInRange: number;
  };
}

export interface CommsMetricsRange {
  from: string;
  to: string;
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

/**
 * Validates `from`/`to` query params and resolves the IST day window.
 * Throws a structured 400 (BadRequestException) on any bad input.
 */
export function parseCommsMetricsRange(from: unknown, to: unknown): CommsMetricsRange {
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
  const days = Math.round((parsed.to - parsed.from) / DAY_MS) + 1;
  if (days > COMMS_METRICS_MAX_RANGE_DAYS) {
    throw badRequest(
      "COMMS_METRICS_RANGE_TOO_LONG",
      `The range may span at most ${COMMS_METRICS_MAX_RANGE_DAYS} days.`,
      { maxDays: COMMS_METRICS_MAX_RANGE_DAYS },
    );
  }

  const offsetMs = COMMS_METRICS_UTC_OFFSET_MINUTES * 60 * 1000;
  const dates: string[] = [];
  for (let ms = parsed.from; ms <= parsed.to; ms += DAY_MS) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    startUtc: new Date(parsed.from - offsetMs),
    endUtcExclusive: new Date(parsed.to + DAY_MS - offsetMs),
    dates,
  };
}

/** The single place a per-day count becomes a reportable cell. */
export function suppressCell(n: number): CommsCell {
  return n >= 1 && n <= SMALL_CELL_SUPPRESSION_MAX
    ? { count: null, suppressed: true }
    : { count: n, suppressed: false };
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
  const t: ChannelTotals = { ...zeroChannels(), all: 0 };
  for (const counts of perDay.values()) {
    for (const c of COMMS_CHANNELS) {
      t[c] += counts[c];
      t.all += counts[c];
    }
  }
  return t;
}

type DayChannelRow = { day: string; channel: string | null; n: number };
type FeedbackDayRow = { day: string; up: number; down: number };

@Injectable()
export class CommsMetricsService {
  private readonly logger = new Logger(CommsMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async collect(range: CommsMetricsRange, now: Date = new Date()): Promise<CommsMetrics> {
    const { startUtc, endUtcExclusive } = range;
    const tz = COMMS_METRICS_TIMEZONE;

    // Every query reads timestamps, Session.channel / isEval, Message.role and
    // Feedback.rating only. Prisma DateTime columns are UTC `timestamp(3)`.
    const [sessionRows, turnRows, feedbackRows, safetyEvents, waContacts] = await Promise.all([
      this.prisma.$queryRaw<DayChannelRow[]>`
        SELECT to_char(timezone(${tz}::text, s."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
               s.channel AS channel,
               count(*)::int AS n
        FROM "Session" s
        WHERE s."createdAt" >= ${startUtc} AND s."createdAt" < ${endUtcExclusive}
          AND s."isEval" = false
        GROUP BY 1, 2
      `,
      this.prisma.$queryRaw<DayChannelRow[]>`
        SELECT to_char(timezone(${tz}::text, m."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
               s.channel AS channel,
               count(*)::int AS n
        FROM "Message" m
        JOIN "Session" s ON s.id = m."sessionId"
        WHERE m."createdAt" >= ${startUtc} AND m."createdAt" < ${endUtcExclusive}
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
        WHERE f."createdAt" >= ${startUtc} AND f."createdAt" < ${endUtcExclusive}
          AND s."isEval" = false
        GROUP BY 1
      `,
      this.prisma.safetyEvent.count({
        where: { createdAt: { gte: startUtc, lt: endUtcExclusive }, session: { isEval: false } },
      }),
      this.prisma.whatsAppContact.count({
        where: { lastActiveAt: { gte: startUtc, lt: endUtcExclusive } },
      }),
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

    const days: CommsMetricsDay[] = range.dates.map((date) => {
      const fb = feedbackByDay.get(date)!;
      return {
        date,
        sessions: channelCells(sessionsByDay.get(date)!),
        chatTurns: channelCells(turnsByDay.get(date)!),
        feedback: { up: suppressCell(fb.up), down: suppressCell(fb.down) },
      };
    });

    let up = 0;
    let down = 0;
    for (const fb of feedbackByDay.values()) {
      up += fb.up;
      down += fb.down;
    }

    const totals = {
      sessions: channelTotals(sessionsByDay),
      chatTurns: channelTotals(turnsByDay),
      feedback: { up, down },
      safetyEvents: Number(safetyEvents) || 0,
      whatsappContactsLastActiveInRange: Number(waContacts) || 0,
    };

    this.logger.log(
      `comms-metrics: ${range.from}..${range.to} sessions=${totals.sessions.all} ` +
        `chatTurns=${totals.chatTurns.all} feedback=${up}/${down} safety=${totals.safetyEvents}`,
    );

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
}
