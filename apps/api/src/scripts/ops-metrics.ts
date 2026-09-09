/**
 * Ops Center collector — emits the four Suchi figures the Bodh AI Ops scorecard
 * cannot currently produce (GitHub issues #61, #62, #63, #64), plus the KB
 * duplicate-row guard from issue #86.
 *
 * Usage:
 *   cd apps/api && npm run ops:metrics            # human-readable + JSON block
 *   cd apps/api && npm run ops:metrics -- --json  # JSON block only (pipeable)
 *
 * The DB metrics need a reachable Postgres. Against prod, run the Cloud SQL
 * proxy first and export the prod DATABASE_URL (see CLAUDE.md):
 *   cloud-sql-proxy gen-lang-client-0202543132:us-central1:suchi-db \
 *     --credentials-file ~/.config/gcloud/legacy_credentials/<sa>/adc.json --port 5432
 *   export DATABASE_URL="$(gcloud secrets versions access latest --secret=database-url)"
 *
 * `tier1_eval_status` comes from the GitHub Actions REST API, not the DB. It
 * shares one collector with `OpsMetricsService` (issue #63) — see
 * `modules/analytics/tier1-eval-status.ts` — so the script and
 * `GET /v1/admin/ops-metrics` cannot report different things. It no longer
 * shells out to `gh`, so it needs no CLI and no credentials.
 *
 * Output is shaped for `~/bodh-ai-ops/manual/suchi.json`, which `ops.py
 * collect_usage()` reads directly — that file is the only transport the Ops
 * Center has today (it reads local checkouts and git only, and cannot call an
 * HTTP endpoint). Paste the emitted block in, or:
 *   npm run ops:metrics -- --json > ~/bodh-ai-ops/manual/suchi.json
 *
 * Ops Center rule 2: a metric with no collector reads "unavailable", never 0.
 * Any query that fails is therefore OMITTED from the JSON block rather than
 * emitted as a zero — a missing key returns the metric to "unavailable".
 *
 * READ-ONLY: SELECT/count only. No writes, no DDL, no migrations.
 */

import { PrismaClient } from "@prisma/client";
import { fetchTier1EvalStatus, TIER1_EVAL_WORKFLOW } from "../modules/analytics/tier1-eval-status";

const DAY_MS = 24 * 60 * 60 * 1000;

type Entry = { value: number | string; as_of: string; source: string; by: string };

const isoDate = (d: Date) => d.toISOString().split("T")[0];

/** Prisma errors lead with blank lines; surface the first line that says something. */
const firstLine = (e: unknown) =>
  String((e as Error)?.message ?? e)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "unknown error";

/** #61, #62, #64 — three read-only aggregates, eval traffic excluded. */
async function collectDbMetrics(prisma: PrismaClient, now: Date) {
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  const [sessions7d, waContacts7d, unreviewed, safetyTotal, safetyByType, kbRows] = await Promise.all([
    prisma.session.count({ where: { createdAt: { gte: since7d }, isEval: false } }),
    prisma.whatsAppContact.count({ where: { lastActiveAt: { gte: since7d } } }),
    prisma.session.count({ where: { reviewFlagged: true, reviewedAt: null, isEval: false } }),
    prisma.safetyEvent.count({ where: { createdAt: { gte: since30d }, session: { isEval: false } } }),
    prisma.safetyEvent.groupBy({
      by: ["type"],
      where: { createdAt: { gte: since30d }, session: { isEval: false } },
      _count: { _all: true },
    }),
    // #86 — duplicate KB chunk rows (same query as OpsMetricsService.kbIndexIntegrity).
    prisma.$queryRaw<
      Array<{ total_rows: number; non_deterministic_id_rows: number; duplicate_position_rows: number }>
    >`
      SELECT
        count(*)::int AS total_rows,
        (count(*) FILTER (WHERE id NOT LIKE '%::chunk::%'))::int AS non_deterministic_id_rows,
        (count(*) - count(DISTINCT ("docId", "chunkIndex")))::int AS duplicate_position_rows
      FROM "KbChunk"
    `,
  ]);

  const kb = kbRows[0] ?? { total_rows: 0, non_deterministic_id_rows: 0, duplicate_position_rows: 0 };

  return {
    kbTotalRows: Number(kb.total_rows),
    kbDuplicateRows: Number(kb.duplicate_position_rows),
    kbNonDeterministicIdRows: Number(kb.non_deterministic_id_rows),
    sessions7d,
    waContacts7d,
    unreviewed,
    safetyTotal,
    safetyByType: safetyByType
      .map((r) => ({ type: r.type, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

async function main() {
  const jsonOnly = process.argv.includes("--json");
  const now = new Date();
  const asOf = isoDate(now);
  const by = process.env.USER || "unknown";

  const entries: Record<string, Entry> = {};
  let db: Awaited<ReturnType<typeof collectDbMetrics>> | null = null;

  const prisma = new PrismaClient();
  try {
    db = await collectDbMetrics(prisma, now);
  } catch (e) {
    console.error(`[warn] DB metrics unavailable: ${firstLine(e)}`);
    console.error("[warn] active_users_7d / review_queue_size / safety_events_30d omitted.");
  } finally {
    await prisma.$disconnect();
  }

  if (db) {
    entries.active_users_7d = {
      value: db.sessions7d,
      as_of: asOf,
      source: `Suchi DB: non-eval Session rows created in the last 7d (sessions, not distinct humans; ${db.waContacts7d} distinct WhatsApp contacts active)`,
      by,
    };
    entries.review_queue_size = {
      value: db.unreviewed,
      as_of: asOf,
      source: "Suchi DB: Session where reviewFlagged=true AND reviewedAt IS NULL, non-eval",
      by,
    };
    entries.safety_events_30d = {
      value: db.safetyTotal,
      as_of: asOf,
      source: `Suchi DB: SafetyEvent rows in the last 30d, non-eval (${
        db.safetyByType.map((t) => `${t.type}:${t.count}`).join(", ") || "none"
      })`,
      by,
    };
  }

  if (db) {
    entries.kb_duplicate_rows = {
      value: db.kbDuplicateRows,
      as_of: asOf,
      source: `Suchi DB: KbChunk rows beyond the first per (docId, chunkIndex); ${db.kbNonDeterministicIdRows} rows with a non-deterministic id, ${db.kbTotalRows} rows total. Healthy = 0 (issue #86)`,
      by,
    };
  }

  // #63 — the same collector the API serves, so the two cannot disagree.
  const tier1 = await fetchTier1EvalStatus();
  if (tier1.available && tier1.value) {
    entries.tier1_eval_status = { value: tier1.value, as_of: asOf, source: tier1.source, by };
  } else {
    console.error(`[warn] tier1_eval_status ${tier1.source}`);
  }

  const block = {
    _how_to:
      'Add a key per metric: {"value": 12, "as_of": "2026-08-18", "source": "where you read it", "by": "who"}. Entries older than manual_stale_days are flagged stale, not silently trusted. Delete a key to return the metric to \'unavailable\'.',
    _generated_by: "suchi_repo apps/api: npm run ops:metrics",
    _generated_at: now.toISOString(),
    _metrics_available: [
      "active_users_7d",
      "review_queue_size",
      "tier1_eval_status",
      "safety_events_30d",
      "kb_duplicate_rows",
    ],
    ...entries,
  };

  if (!jsonOnly) {
    console.error("");
    console.error("Suchi — Ops Center metrics");
    console.error("=".repeat(60));
    if (db) {
      console.error(`  active_users_7d     ${db.sessions7d} sessions (${db.waContacts7d} WhatsApp contacts)`);
      console.error(`  review_queue_size   ${db.unreviewed} unreviewed`);
      console.error(`  safety_events_30d   ${db.safetyTotal}`);
      for (const t of db.safetyByType) console.error(`                        ${t.type}: ${t.count}`);
      console.error(
        `  kb_duplicate_rows   ${db.kbDuplicateRows}${db.kbDuplicateRows === 0 && db.kbNonDeterministicIdRows === 0 ? " (healthy)" : ` — UNHEALTHY, ${db.kbNonDeterministicIdRows} legacy-id rows of ${db.kbTotalRows}; see issue #86`}`,
      );
    } else {
      console.error("  active_users_7d     unavailable (no DB)");
      console.error("  review_queue_size   unavailable (no DB)");
      console.error("  safety_events_30d   unavailable (no DB)");
      console.error("  kb_duplicate_rows   unavailable (no DB)");
    }
    console.error(
      `  tier1_eval_status   ${tier1.available ? tier1.value : `unavailable (${TIER1_EVAL_WORKFLOW}: ${tier1.source})`}`,
    );
    console.error("=".repeat(60));
    console.error("Paste the JSON below into ~/bodh-ai-ops/manual/suchi.json");
    console.error("");
  }

  // stdout carries only the JSON, so `-- --json > manual/suchi.json` is safe.
  console.log(JSON.stringify(block, null, 2));

  // Exit non-zero only if nothing at all could be measured.
  if (!db && !tier1.available) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
