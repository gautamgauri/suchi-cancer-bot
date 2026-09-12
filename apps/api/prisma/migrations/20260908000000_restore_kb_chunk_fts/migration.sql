-- Restore full-text search on KbChunk (issue #92) — EXPRESSION INDEX, no column.
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
-- TWO ABANDONED DESIGNS (2026-09-12)
--   1. STORED generated column: Postgres rewrites the whole table under an ACCESS
--      EXCLUSIVE lock and rebuilds every index incl. the pgvector HNSW one. On
--      suchi-db (db-f1-micro, ~49k rows of 1.4 KB text + 768-d vectors) it ran
--      15+ minutes with all retrieval queued behind it. Terminated; nothing kept.
--   2. Plain column + trigger + batched backfill: non-blocking, but every updated
--      row is too large for a HOT update, so it re-enters all four indexes incl.
--      the HNSW one — measured 190 ms/row = ~2.5 h of writes. Stopped at 12k rows;
--      column, trigger and function were dropped again (catalog-only).
--
-- THIS DESIGN
--   Index the expression instead:  GIN (to_tsvector('simple', content)).
--   No column, no trigger, no backfill, no per-row writes, no shadow state to
--   drift, nothing Prisma has to represent (it cannot; see ownership note in
--   src/modules/rag/kb-fts.sql.ts). The query uses the identical expression so
--   the planner uses the index; without the index the query still returns
--   correct rows via a sequential scan.
--
-- SIZE GUARD
--   A plain CREATE INDEX takes a SHARE lock (blocks writes) and scans the table.
--   Fine for <= 5000 rows (dev, CI, the PGlite test). On a production-sized table
--   this file RAISES unless the index already exists and is valid — production
--   builds it with CREATE INDEX CONCURRENTLY via scripts/sql/kb_fts_safe_rollout.py,
--   which then marks this migration applied. Everything is one DO block: on Prisma
--   5 (no implicit transaction) that is what makes a raise commit nothing at all.
--   Safe to re-run: every statement is conditional.

SET lock_timeout = '5s';

DO $do$
DECLARE
  row_count bigint;
  idx_ok    boolean;
BEGIN
  -- Any leftover from the two abandoned designs: catalog-only drops, no rewrite.
  DROP TRIGGER IF EXISTS kbchunk_content_tsv_trg ON "KbChunk";
  DROP FUNCTION IF EXISTS kbchunk_content_tsv_maintain();
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = to_regclass('"KbChunk"') AND attname = 'content_tsv' AND NOT attisdropped) THEN
    -- The old index (if any) is over the column; it goes with it.
    DROP INDEX IF EXISTS kb_chunk_content_tsv_idx;
    ALTER TABLE "KbChunk" DROP COLUMN content_tsv;
  END IF;

  SELECT count(*) INTO row_count FROM "KbChunk";

  SELECT COALESCE(bool_and(i.indisvalid AND i.indisready), false)
    INTO idx_ok
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'kb_chunk_content_tsv_idx'
    AND pg_get_indexdef(i.indexrelid) LIKE '%to_tsvector(''simple''::regconfig, content)%';

  IF idx_ok THEN
    RAISE NOTICE 'kb_chunk_content_tsv_idx already present and valid — nothing to do.';
  ELSIF row_count <= 5000 THEN
    -- Small table: a plain build takes milliseconds. Replace an invalid/mismatched one.
    DROP INDEX IF EXISTS kb_chunk_content_tsv_idx;
    CREATE INDEX kb_chunk_content_tsv_idx ON "KbChunk" USING GIN (to_tsvector('simple', content));
  ELSE
    RAISE EXCEPTION USING
      MESSAGE = format('KbChunk has %s rows: refusing to build the FTS index inside a migration (SHARE lock + full scan). Run scripts/sql/kb_fts_safe_rollout.py --execute, which builds kb_chunk_content_tsv_idx CONCURRENTLY, verifies it, and then marks this migration applied.', row_count),
      HINT = 'docs/OPERATIONS_RUNBOOK.md §4a';
  END IF;
END
$do$;
