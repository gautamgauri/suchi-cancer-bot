-- Restore full-text search on KbChunk (issue #92) — NON-BLOCKING implementation.
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
-- INCIDENT 2026-09-12 (why this file is NOT a GENERATED column any more)
--   The first version of this migration re-added `content_tsv` as
--   `GENERATED ALWAYS AS (...) STORED`. On Postgres that is a full table rewrite
--   under an ACCESS EXCLUSIVE lock, and the rewrite rebuilds EVERY index on the
--   table — including the pgvector HNSW index on `embedding`. On production
--   (suchi-db, db-f1-micro, ~74k rows of 1.4 KB text + 768-d vectors) it ran
--   for 15+ minutes; all retrieval queries queued behind the lock, the
--   connection pool filled, /v1/health stopped answering and chat turns timed
--   out. The statement was terminated; nothing was changed. Never run a
--   rewriting ALTER on "KbChunk" again.
--
-- WHAT THIS FILE DOES INSTEAD
--   1. Adds `content_tsv` as a PLAIN, nullable tsvector with no default — a
--      catalog-only change, no rewrite, milliseconds.
--   2. Installs a BEFORE INSERT OR UPDATE OF content trigger that keeps the
--      column current, so rows written while the backfill runs are covered.
--   3. Backfills and builds the GIN index ONLY on small tables (<= 5000 rows:
--      dev databases, CI, the PGlite regression test). On a production-sized
--      table it deliberately stops with a NOTICE: the backfill must run in
--      small committed batches and the index must be built CONCURRENTLY
--      (which cannot run inside a transaction). That procedure is
--      `scripts/sql/kb_fts_safe_rollout.py`, documented in
--      docs/OPERATIONS_RUNBOOK.md §4a; it ends with
--      `prisma migrate resolve --applied 20260908000000_restore_kb_chunk_fts`.
--
--   A database that still carries the legacy GENERATED column (never ran
--   20260606) is left exactly as it is: Postgres maintains that shape itself and
--   the boot probe (KbFtsHealthService) accepts either shape.
--
-- Safe to re-run. Every statement is conditional or IF NOT EXISTS.

SET lock_timeout = '5s';

-- Trigger function: same expression, same 'simple' config, as the query in
-- src/modules/rag/kb-fts.sql.ts (websearch_to_tsquery('simple', ...)).
CREATE OR REPLACE FUNCTION kbchunk_content_tsv_maintain() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.content_tsv := to_tsvector('simple', NEW.content);
  RETURN NEW;
END
$fn$;

DO $$
DECLARE
  col_generated "char";   -- attgenerated: 's' = STORED generated, '' = plain, NULL = column absent
  row_count     bigint;
BEGIN
  SELECT a.attgenerated
    INTO col_generated
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('"KbChunk"')
    AND a.attname = 'content_tsv'
    AND NOT a.attisdropped;

  IF col_generated IS NULL THEN
    -- Plain, nullable, no default: metadata-only, no table rewrite.
    ALTER TABLE "KbChunk" ADD COLUMN IF NOT EXISTS content_tsv tsvector;
    col_generated := '';
  END IF;

  SELECT count(*) INTO row_count FROM "KbChunk";

  IF col_generated = 's' THEN
    RAISE NOTICE 'KbChunk.content_tsv is a legacy STORED generated column — leaving it (Postgres maintains it); no trigger installed.';
    DROP TRIGGER IF EXISTS kbchunk_content_tsv_trg ON "KbChunk";
  ELSE
    -- Trigger BEFORE the backfill, so nothing written during the backfill is missed.
    DROP TRIGGER IF EXISTS kbchunk_content_tsv_trg ON "KbChunk";
    CREATE TRIGGER kbchunk_content_tsv_trg
      BEFORE INSERT OR UPDATE OF content ON "KbChunk"
      FOR EACH ROW EXECUTE FUNCTION kbchunk_content_tsv_maintain();

    IF row_count <= 5000 THEN
      UPDATE "KbChunk"
         SET content_tsv = to_tsvector('simple', content)
       WHERE content_tsv IS NULL;
    ELSE
      RAISE NOTICE 'KbChunk has % rows: backfill deliberately NOT run here. Run scripts/sql/kb_fts_safe_rollout.py (batched backfill, then CREATE INDEX CONCURRENTLY, then prisma migrate resolve).', row_count;
    END IF;
  END IF;

  IF row_count <= 5000 THEN
    -- Small table: a plain (SHARE-locking) build takes milliseconds.
    CREATE INDEX IF NOT EXISTS kb_chunk_content_tsv_idx ON "KbChunk" USING GIN (content_tsv);
  ELSE
    RAISE NOTICE 'GIN index kb_chunk_content_tsv_idx deliberately NOT built here on a % row table — build it with CREATE INDEX CONCURRENTLY after the backfill (scripts/sql/kb_fts_safe_rollout.py).', row_count;
  END IF;
END$$;
