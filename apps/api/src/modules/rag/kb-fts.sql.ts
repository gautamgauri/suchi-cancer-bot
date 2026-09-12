/**
 * Lexical (full-text-search) arm of hybrid retrieval — single source of truth.
 *
 * WHY THIS FILE EXISTS (issue #92): the FTS SQL used to be an inline tagged
 * template inside `RagService.fullTextSearchWithMetadata`. It referenced
 * `KbChunk.content_tsv`, a generated column that lived only in raw migration
 * SQL. When migration 20260606000000 dropped that column, nothing in the
 * TypeScript build, the Prisma schema or the test suite could notice, and the
 * query failed silently for three months.
 *
 * DESIGN (since 2026-09-12): there is NO stored tsvector column any more. The
 * lexical arm indexes the EXPRESSION `to_tsvector('simple', content)` with a GIN
 * index and queries by the same expression. Postgres uses an expression index
 * only when the query's expression is textually identical to the index's, so
 * `KB_FTS_EXPRESSION` is the one place that text lives.
 *
 * Why no column: a STORED generated column rewrites the whole table (15-minute
 * outage, 2026-09-12 10:48 UTC), and a plain column with a trigger costs a
 * write per row that must also update the pgvector HNSW index (measured
 * 190 ms/row = 2.5 h of writes for the backfill). The expression index needs
 * one concurrent build and no row writes, and there is no shadow state to drift.
 *
 * Because the query computes the expression itself, it still WORKS without the
 * index — it just sequentially scans. So the lexical arm can only be "dead" if
 * the table is missing; a missing or invalid index is "degraded", never a silent zero.
 *
 * Keeping the SQL and the identifiers here means the boot-time probe
 * (`KbFtsHealthService`) checks the very objects the query needs, and
 * `kb-fts.spec.ts` executes this exact statement against a real Postgres.
 */

/** Table carrying the searchable text. */
export const KB_FTS_TABLE = "KbChunk";

/** GIN expression index. Created by raw migration SQL only — see KB_FTS_OWNERSHIP_NOTE. */
export const KB_FTS_INDEX = "kb_chunk_content_tsv_idx";

/**
 * Postgres text-search configuration. 'simple' (not 'english') is deliberate:
 * it tokenises without language-specific stemming, so Hindi/Hinglish KB content
 * is searchable too (migration 20260218000000_fts_simple_config).
 */
export const KB_FTS_CONFIG = "simple";

/**
 * The indexed expression, with `c.` as the table alias used by the query. The
 * migration indexes `to_tsvector('simple', content)`; pg_get_indexdef renders
 * that as `to_tsvector('simple'::regconfig, content)` — see KB_FTS_INDEXDEF_MARKER.
 */
export const KB_FTS_EXPRESSION = `to_tsvector('${KB_FTS_CONFIG}', c.content)`;

/** How pg_get_indexdef renders the indexed expression; the probe checks for it. */
export const KB_FTS_INDEXDEF_MARKER = `to_tsvector('${KB_FTS_CONFIG}'::regconfig, content)`;

/** Name of the legacy column some databases may still carry; the probe reports it so it gets dropped. */
export const KB_FTS_LEGACY_COLUMN = "content_tsv";

export const KB_FTS_OWNERSHIP_NOTE =
  `Lexical search on "${KB_FTS_TABLE}" is an EXPRESSION index: ${KB_FTS_INDEX} = GIN ` +
  `(to_tsvector('${KB_FTS_CONFIG}', content)), created by raw migration SQL ` +
  `(20260908000000_restore_kb_chunk_fts) — on production with CREATE INDEX CONCURRENTLY via ` +
  `scripts/sql/kb_fts_safe_rollout.py. There is deliberately NO tsvector column: a STORED ` +
  `generated column rewrites the table (2026-09-12 outage) and a trigger-maintained column ` +
  `costs a write per row through the pgvector HNSW index. Prisma cannot express an expression ` +
  `index, so a schema diff will propose dropping it — never accept that; kb-fts.spec.ts pins ` +
  `the migration history.`;

/**
 * The lexical retrieval query.
 *
 * $1 = user query text (fed to websearch_to_tsquery, so phrases and AND/OR work)
 * $2 = row limit
 *
 * Uses KB_FTS_EXPRESSION in both the predicate and the rank so the planner can
 * use the expression index for the predicate.
 */
export const KB_FTS_SEARCH_SQL = `
  SELECT
    c.id,
    c."docId",
    c.content,
    ts_rank_cd(${KB_FTS_EXPRESSION}, query) AS "lexRank",
    d.title,
    d.url,
    d."sourceType",
    d.source,
    d.citation,
    d."lastReviewed",
    d."isTrustedSource"
  FROM "${KB_FTS_TABLE}" c
  INNER JOIN "KbDocument" d ON c."docId" = d.id,
  websearch_to_tsquery('${KB_FTS_CONFIG}', $1) query
  WHERE d.status = 'active'
    AND ${KB_FTS_EXPRESSION} @@ query
  ORDER BY ts_rank_cd(${KB_FTS_EXPRESSION}, query) DESC
  LIMIT $2::int
`;

/**
 * Schema probe: is the table there, is the expression index there, is it VALID
 * (an interrupted CREATE INDEX CONCURRENTLY leaves an invalid index the planner
 * ignores), and is it over the expression the query uses? Also reports whether a
 * legacy `content_tsv` column is still present so it can be dropped.
 */
export const KB_FTS_PROBE_SQL = `
  SELECT
    to_regclass('"${KB_FTS_TABLE}"') IS NOT NULL AS "tablePresent",
    (SELECT indexdef FROM pg_indexes WHERE indexname = '${KB_FTS_INDEX}') AS "indexDef",
    COALESCE((
      SELECT i.indisvalid AND i.indisready
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = '${KB_FTS_INDEX}'
    ), false) AS "indexValid",
    EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('"${KB_FTS_TABLE}"')
        AND attname = '${KB_FTS_LEGACY_COLUMN}'
        AND NOT attisdropped
    ) AS "legacyColumnPresent"
`;

export interface KbFtsProbeRow {
  tablePresent: boolean;
  /** pg_get_indexdef output, or null when the index is missing. */
  indexDef: string | null;
  /** pg_index.indisvalid AND indisready — false for an interrupted concurrent build. */
  indexValid: boolean;
  /** A stored tsvector column from the abandoned designs is still present. */
  legacyColumnPresent: boolean;
}

/**
 * Postgres error classes that mean "the schema does not match the query" rather
 * than "this particular query had a bad day":
 *   42P01 undefined_table, 42703 undefined_column, 42883 undefined_function,
 *   42P17 invalid_object_definition, 3F000 invalid_schema_name,
 *   42704 undefined_object (e.g. a text-search config that does not exist).
 * These are permanent until someone runs a migration, so they must escalate.
 */
export const PG_SCHEMA_ERROR_CODES = ["42P01", "42703", "42883", "42P17", "42704", "3F000"] as const;

/**
 * True when the error means the FTS objects are missing/misshapen.
 *
 * Prisma surfaces raw-query failures as PrismaClientKnownRequestError P2010 with
 * `meta.code` holding the Postgres SQLSTATE; other drivers (and PGlite, used by
 * the regression test) put it on `error.code`. Both are checked, plus a message
 * fallback so a driver that only gives us prose still escalates.
 */
export function isFtsSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  const codes = [err.code, err.meta?.code].filter((c): c is string => typeof c === "string");
  if (codes.some((c) => (PG_SCHEMA_ERROR_CODES as readonly string[]).includes(c))) {
    return true;
  }

  const message = typeof err.message === "string" ? err.message : "";
  return (
    /column\s+.?(c\.)?content\s+does not exist/i.test(message) ||
    /relation\s+.?KbChunk.?\s+does not exist/i.test(message) ||
    /function\s+(websearch_to_tsquery|to_tsvector).*does not exist/i.test(message) ||
    /text search configuration\s+.?simple.?\s+does not exist/i.test(message)
  );
}
