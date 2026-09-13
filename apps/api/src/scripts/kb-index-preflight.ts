/**
 * KB index integrity preflight for `ingest-kb.ts` — issue #86.
 *
 * BACKGROUND
 *   ingest-kb.ts upserts chunks on the deterministic id `docId::chunk::N`
 *   (`generateChunkId`). An earlier run wrote Prisma `@default(uuid())` ids
 *   instead. Those rows are unreachable by the upsert, so every later run
 *   inserted a *second*, byte-identical copy of each chunk rather than
 *   overwriting: 25,065 extra rows, 34% of the index. Nothing failed; the cost
 *   was paid silently in retrieval quality (91% of eval queries were answered
 *   from ~4.1 distinct chunks instead of 6).
 *
 * WHY A SCRIPT-SIDE CHECK WHEN THE DB NOW HAS @@unique([docId, chunkIndex])
 *   The unique index catches the exact shape that caused the 2026 incident —
 *   two rows at one position — and is the real guard. It cannot see the
 *   *precursor*: a row whose id is not `docId::chunk::N` but which sits alone
 *   at its position (a doc ingested only by the legacy run, or a chunk whose
 *   position no longer exists in the current chunking). Those rows are still
 *   invisible to the upsert, still served by retrieval, and are exactly what
 *   turns into duplicates the moment the chunker's output shifts. Refusing to
 *   ingest on top of them keeps the repair a deliberate, verified act instead
 *   of something a routine `npm run kb:ingest` papers over.
 *
 * This module is intentionally free of Prisma and I/O so it can be unit-tested:
 * the caller runs KB_INDEX_INTEGRITY_SQL and hands the row to `assess`.
 */

/**
 * The cheap always-on integrity signal — query (A) of
 * scripts/sql/kb_duplicate_cleanup.sql, identical to the one behind
 * OpsMetricsService.kbIndexIntegrity and `npm run ops:metrics`. Counts only;
 * it never hashes `content`, so genuine in-document repeats are not flagged.
 */
export const KB_INDEX_INTEGRITY_SQL = `
  SELECT
    count(*)::int AS total_rows,
    (count(*) FILTER (WHERE id NOT LIKE '%::chunk::%'))::int AS non_deterministic_id_rows,
    (count(*) - count(DISTINCT ("docId", "chunkIndex")))::int AS duplicate_position_rows
  FROM "KbChunk"
`;

/** One row of {@link KB_INDEX_INTEGRITY_SQL}. Postgres aggregates may arrive as bigint. */
export type KbIndexIntegrityRow = {
  total_rows: number | bigint;
  non_deterministic_id_rows: number | bigint;
  duplicate_position_rows: number | bigint;
};

export type KbIndexPreflight = {
  /** True when the index is in the shape ingest-kb.ts can safely upsert over. */
  ok: boolean;
  totalRows: number;
  nonDeterministicIdRows: number;
  duplicatePositionRows: number;
  /** Operator-facing explanation; empty string when `ok`. */
  reason: string;
};

const REMEDIATION =
  "Do NOT ingest on top of this. Run the dry-run and DELETE in " +
  "scripts/sql/kb_duplicate_cleanup.sql (issue #86), then VACUUM (ANALYZE) \"KbChunk\", " +
  "and apply migration 20260913000000_kb_chunk_unique_position. " +
  "`npm run ops:metrics` (kb_duplicate_rows) reports the same figures.";

/**
 * Decide whether an ingest run may proceed against the observed index state.
 *
 * Healthy is exactly zero on both counters. A missing row (empty result set)
 * is treated as an empty table, which is healthy — a first ingest into a fresh
 * database must not be blocked.
 */
export function assessKbIndexIntegrity(row: KbIndexIntegrityRow | undefined | null): KbIndexPreflight {
  const totalRows = Number(row?.total_rows ?? 0);
  const nonDeterministicIdRows = Number(row?.non_deterministic_id_rows ?? 0);
  const duplicatePositionRows = Number(row?.duplicate_position_rows ?? 0);

  const problems: string[] = [];
  if (nonDeterministicIdRows > 0) {
    problems.push(
      `${nonDeterministicIdRows} of ${totalRows} KbChunk row(s) have an id that is not the ` +
        "deterministic `docId::chunk::N` shape this script upserts on — an ingest run would " +
        "insert alongside them instead of replacing them"
    );
  }
  if (duplicatePositionRows > 0) {
    problems.push(
      `${duplicatePositionRows} KbChunk row(s) sit beyond the first at their (docId, chunkIndex) ` +
        "— the index already holds duplicates"
    );
  }

  if (problems.length === 0) {
    return { ok: true, totalRows, nonDeterministicIdRows, duplicatePositionRows, reason: "" };
  }

  return {
    ok: false,
    totalRows,
    nonDeterministicIdRows,
    duplicatePositionRows,
    reason: `KB index integrity check failed: ${problems.join("; ")}. ${REMEDIATION}`,
  };
}
