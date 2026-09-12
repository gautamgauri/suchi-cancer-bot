-- Restore full-text search on KbChunk (issue #92).
--
-- HISTORY
--   20260120163141_add_fts_to_kbchunk  added `content_tsv` as a STORED generated
--                                      column over to_tsvector('english', content)
--                                      plus the GIN index kb_chunk_content_tsv_idx.
--   20260218000000_fts_simple_config   rebuilt the same column with the 'simple'
--                                      text-search config so Hindi/Hinglish content
--                                      tokenises too (no language-specific stemming).
--   20260606000000_phase2_...          DROPPED the index and the column. That drop was
--                                      collateral from a schema-diff: `content_tsv` is a
--                                      generated column Prisma cannot represent, so the
--                                      diff emitted a DROP for it. The lexical arm of
--                                      hybrid retrieval (RagService.fullTextSearchWithMetadata)
--                                      kept querying c.content_tsv and has been failing
--                                      silently — inside a catch that returned [] — ever
--                                      since, costing long queries 45% and short queries
--                                      20% of their retrieval scoring weight.
--
-- This migration restores the 2026-02-18 definition exactly: a STORED generated column
-- over to_tsvector('simple', content), matching websearch_to_tsquery('simple', ...) in
-- src/modules/rag/kb-fts.sql.ts, plus the GIN index the query plan needs.
--
-- Safe to re-run. The DO block rebuilds the column when it exists in any shape other
-- than "STORED generated, 'simple' config" — which covers three real states:
--   * the 2026-01-20 'english' generated column (a DB that never got 20260218), and
--   * a plain, never-populated `content_tsv tsvector` column, which is what
--     `prisma migrate diff` emits from schema.prisma (Prisma cannot express GENERATED),
--     i.e. what a freshly `db push`-ed database would have.
-- Rebuilding is cheap: the column is derived from `content`, so nothing is lost.

DO $$
DECLARE
  needs_rebuild boolean;
BEGIN
  SELECT NOT (
      a.attgenerated = 's'
      AND pg_get_expr(d.adbin, d.adrelid) LIKE '%''simple''%'
    )
    INTO needs_rebuild
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE a.attrelid = to_regclass('"KbChunk"')
    AND a.attname = 'content_tsv'
    AND NOT a.attisdropped;

  IF needs_rebuild THEN
    RAISE NOTICE 'KbChunk.content_tsv exists but is not a STORED generated tsvector over the ''simple'' config — rebuilding it.';
    DROP INDEX IF EXISTS kb_chunk_content_tsv_idx;
    ALTER TABLE "KbChunk" DROP COLUMN content_tsv;
  END IF;
END$$;

ALTER TABLE "KbChunk"
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX IF NOT EXISTS kb_chunk_content_tsv_idx ON "KbChunk" USING GIN (content_tsv);
