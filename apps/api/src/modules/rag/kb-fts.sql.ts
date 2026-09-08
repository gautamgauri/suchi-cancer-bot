/**
 * Lexical (full-text-search) arm of hybrid retrieval — single source of truth.
 *
 * WHY THIS FILE EXISTS (issue #92): the FTS SQL used to be an inline tagged
 * template inside `RagService.fullTextSearchWithMetadata`. It referenced
 * `KbChunk.content_tsv`, a generated column that lives only in raw migration
 * SQL. When migration 20260606000000 dropped that column, nothing in the
 * TypeScript build, the Prisma schema or the test suite could notice, and the
 * query failed silently for three months.
 *
 * Keeping the SQL and the schema identifiers here means:
 *   - the boot-time probe (`KbFtsHealthService`) checks the very objects the
 *     query needs, not a hand-copied guess at them, and
 *   - `kb-fts.spec.ts` executes this exact statement against a real Postgres.
 *
 * If you change the text-search config here you MUST ship a migration that
 * rebuilds `content_tsv` with the same config — `to_tsvector` and
 * `websearch_to_tsquery` must agree or `@@` silently matches nothing.
 */

/** Table carrying the FTS column. */
export const KB_FTS_TABLE = "KbChunk";

/** Generated tsvector column. Defined in raw migration SQL only — see KB_FTS_OWNERSHIP_NOTE. */
export const KB_FTS_COLUMN = "content_tsv";

/** GIN index over the tsvector column. */
export const KB_FTS_INDEX = "kb_chunk_content_tsv_idx";

/**
 * Postgres text-search configuration. 'simple' (not 'english') is deliberate:
 * it tokenises without language-specific stemming, so Hindi/Hinglish KB content
 * is searchable too (migration 20260218000000_fts_simple_config).
 */
export const KB_FTS_CONFIG = "simple";

export const KB_FTS_OWNERSHIP_NOTE =
  `"${KB_FTS_TABLE}"."${KB_FTS_COLUMN}" is a STORED GENERATED column created by raw ` +
  `migration SQL (20260908000000_restore_kb_chunk_fts). Prisma cannot express generated ` +
  `columns, so schema.prisma declares it as Unsupported("tsvector") purely to stop a ` +
  `schema diff from dropping it again. Never "clean it up" out of either place.`;

/**
 * The lexical retrieval query.
 *
 * $1 = user query text (fed to websearch_to_tsquery, so phrases and AND/OR work)
 * $2 = row limit
 *
 * Kept structurally identical to the pre-#92 inline statement so the fix is a
 * restoration, not a retrieval-behaviour change.
 */
export const KB_FTS_SEARCH_SQL = `
  SELECT
    c.id,
    c."docId",
    c.content,
    ts_rank_cd(c.${KB_FTS_COLUMN}, query) AS "lexRank",
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
    AND c.${KB_FTS_COLUMN} @@ query
  ORDER BY ts_rank_cd(c.${KB_FTS_COLUMN}, query) DESC
  LIMIT $2::int
`;

/**
 * Schema probe: reports whether the objects `KB_FTS_SEARCH_SQL` depends on exist
 * AND are shaped correctly. Existence alone is not enough — `prisma migrate diff`
 * emits `content_tsv tsvector` *without* the GENERATED clause, which would leave a
 * column that is always NULL and an FTS arm that returns zero rows forever without
 * ever raising an error. Hence the `attgenerated` / generation-expression checks.
 */
export const KB_FTS_PROBE_SQL = `
  SELECT
    to_regclass('"${KB_FTS_TABLE}"') IS NOT NULL AS "tablePresent",
    (a.attname IS NOT NULL) AS "columnPresent",
    COALESCE(a.attgenerated = 's', false) AS "columnGenerated",
    pg_get_expr(d.adbin, d.adrelid) AS "generationExpr",
    EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = '${KB_FTS_INDEX}'
    ) AS "indexPresent"
  FROM (SELECT 1) probe
  LEFT JOIN pg_attribute a
    ON a.attrelid = to_regclass('"${KB_FTS_TABLE}"')
   AND a.attname = '${KB_FTS_COLUMN}'
   AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
`;

export interface KbFtsProbeRow {
  tablePresent: boolean;
  columnPresent: boolean;
  columnGenerated: boolean;
  generationExpr: string | null;
  indexPresent: boolean;
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
    new RegExp(`column\\s+.?(c\\.)?${KB_FTS_COLUMN}.?\\s+does not exist`, "i").test(message) ||
    /relation\s+.?KbChunk.?\s+does not exist/i.test(message) ||
    /function\s+websearch_to_tsquery.*does not exist/i.test(message)
  );
}
