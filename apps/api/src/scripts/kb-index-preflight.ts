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
 *   *precursor*: a row whose id is not exactly `docId::chunk::N` but which sits
 *   alone at its position (a doc ingested only by the legacy run, a chunk whose
 *   position no longer exists in the current chunking, or an id that names a
 *   different doc or a different index than the row it sits on). Those rows are still
 *   invisible to the upsert, still served by retrieval, and are exactly what
 *   turns into duplicates the moment the chunker's output shifts. Refusing to
 *   ingest on top of them keeps the repair a deliberate, verified act instead
 *   of something a routine `npm run kb:ingest` papers over.
 *
 * This module is intentionally free of Prisma and I/O so it can be unit-tested:
 * the caller runs KB_INDEX_INTEGRITY_SQL and hands the row to `assess`.
 */

/** How many offending ids the refusal message names. */
export const ID_SAMPLE_LIMIT = 5;

/**
 * The SQL predicate for "this row is NOT at the id ingest-kb.ts upserts on".
 *
 * It is an exact comparison against `generateChunkId`'s output, not a
 * `LIKE '%::chunk::%'` substring test. The substring form answers a weaker
 * question — "does this id contain the separator?" — and so passes rows the
 * upsert can never reach: a legacy `legacy::chunk::x` (non-numeric suffix), an
 * id carrying a *different* doc's name, or one whose numeric suffix has drifted
 * from its own `chunkIndex`. Every one of those is invisible to the upsert in
 * exactly the way a uuid id is, so counting them as healthy lets ingestion walk
 * into a bare 23505 unique-violation instead of the actionable refusal below.
 */
export const NON_DETERMINISTIC_ID_PREDICATE = `id IS DISTINCT FROM ("docId" || '::chunk::' || "chunkIndex")`;

/**
 * The cheap always-on integrity signal — query (A) of
 * scripts/sql/kb_duplicate_cleanup.sql, identical to the one behind
 * OpsMetricsService.kbIndexIntegrity and `npm run ops:metrics`. Counts only;
 * it never hashes `content`, so genuine in-document repeats are not flagged.
 *
 * The sample ids come from their own LIMITed subquery rather than a sliced
 * `array_agg`, so a table in the January-2026 state (25,065 offenders) does not
 * materialise 25,065 strings just to print five.
 */
export const KB_INDEX_INTEGRITY_SQL = `
  SELECT
    c.total_rows,
    c.non_deterministic_id_rows,
    c.duplicate_position_rows,
    COALESCE(s.non_deterministic_id_samples, ARRAY[]::text[]) AS non_deterministic_id_samples
  FROM (
    SELECT
      count(*)::int AS total_rows,
      (count(*) FILTER (WHERE ${NON_DETERMINISTIC_ID_PREDICATE}))::int AS non_deterministic_id_rows,
      (count(*) - count(DISTINCT ("docId", "chunkIndex")))::int AS duplicate_position_rows
    FROM "KbChunk"
  ) c
  LEFT JOIN LATERAL (
    SELECT array_agg(t.id) AS non_deterministic_id_samples
    FROM (
      SELECT id FROM "KbChunk"
      WHERE ${NON_DETERMINISTIC_ID_PREDICATE}
      ORDER BY id
      LIMIT ${ID_SAMPLE_LIMIT}
    ) t
  ) s ON true
`;

/** One row of {@link KB_INDEX_INTEGRITY_SQL}. Postgres aggregates may arrive as bigint. */
export type KbIndexIntegrityRow = {
  total_rows: number | bigint;
  non_deterministic_id_rows: number | bigint;
  duplicate_position_rows: number | bigint;
  /** Up to {@link ID_SAMPLE_LIMIT} offending ids, for the operator to grep on. */
  non_deterministic_id_samples?: string[] | null;
};

export type KbIndexPreflight = {
  /** True when the index is in the shape ingest-kb.ts can safely upsert over. */
  ok: boolean;
  totalRows: number;
  nonDeterministicIdRows: number;
  duplicatePositionRows: number;
  /** Up to {@link ID_SAMPLE_LIMIT} offending ids; empty when there are none. */
  nonDeterministicIdSamples: string[];
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
  const nonDeterministicIdSamples = (row?.non_deterministic_id_samples ?? [])
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .slice(0, ID_SAMPLE_LIMIT);

  const problems: string[] = [];
  if (nonDeterministicIdRows > 0) {
    // Name the offenders. "25065 rows have the wrong id" sends an operator to a
    // GROUP BY on a f1-micro; "legacy::chunk::x, doc-other::chunk::3" tells them
    // at a glance whether this is the uuid legacy run, a renamed doc, or a
    // chunkIndex that drifted from its id.
    const samples = nonDeterministicIdSamples.length
      ? ` (e.g. ${nonDeterministicIdSamples.join(", ")}` +
        (nonDeterministicIdRows > nonDeterministicIdSamples.length
          ? `, +${nonDeterministicIdRows - nonDeterministicIdSamples.length} more)`
          : ")")
      : "";
    problems.push(
      `${nonDeterministicIdRows} of ${totalRows} KbChunk row(s) have an id that is not exactly the ` +
        "deterministic `docId::chunk::N` this script upserts on — an ingest run would " +
        `insert alongside them instead of replacing them${samples}`
    );
  }
  if (duplicatePositionRows > 0) {
    problems.push(
      `${duplicatePositionRows} KbChunk row(s) sit beyond the first at their (docId, chunkIndex) ` +
        "— the index already holds duplicates"
    );
  }

  if (problems.length === 0) {
    return {
      ok: true,
      totalRows,
      nonDeterministicIdRows,
      duplicatePositionRows,
      nonDeterministicIdSamples,
      reason: "",
    };
  }

  return {
    ok: false,
    totalRows,
    nonDeterministicIdRows,
    duplicatePositionRows,
    nonDeterministicIdSamples,
    reason: `KB index integrity check failed: ${problems.join("; ")}. ${REMEDIATION}`,
  };
}
