-- One row per (docId, chunkIndex) on KbChunk — issue #86, prevention layer (§7).
--
-- WHY
--   ingest-kb.ts upserts on the deterministic id `docId::chunk::N`
--   (generateChunkId). A run before that scheme existed wrote Prisma
--   `@default(uuid())` ids instead, so the later deterministic runs could not
--   conflict with those rows and inserted a byte-identical second copy of every
--   chunk they re-processed: 25,065 extra rows, 34% of the index, across 511 of
--   1,439 docs. Nothing errored. The damage showed up only in retrieval — the
--   duplicate embeds identically, scores identically, and lands in the
--   neighbour set next to its twin, so 91% of eval queries built their answer
--   on ~4.1 distinct chunks instead of 6 and 71% lost a whole source document.
--
--   The cleanup (DELETE of the uuid-id rows + VACUUM) ran on prod 2026-09-06:
--   73,802 -> 48,737 rows, 0 non-deterministic ids, 0 duplicate positions,
--   1,439 docs (re-verified 2026-09-13). This migration is the guard that keeps
--   it that way: a recurrence becomes a 23505 unique_violation at ingest time
--   instead of a silent, un-alarming loss of answer quality.
--
-- IDEMPOTENT / SAFE TO RE-RUN
--   Skips when the unique index already exists and is valid, so re-running
--   after a manual psql apply + `prisma migrate resolve --applied` is a no-op.
--
-- PRECONDITION — THIS FILE REFUSES TO RUN ON DIRTY DATA
--   CREATE UNIQUE INDEX on a table that still holds duplicate positions fails
--   with a bare 23505 naming two row ids and nothing else, which in a Cloud
--   Build migration job reads as an unexplained deploy failure. The guard below
--   turns that into a message that names the count and the cleanup script.
--   Everything is one DO block: Prisma 5 does not wrap a migration file in an
--   implicit transaction, so a single block is what guarantees a raise leaves
--   nothing behind.
--
-- LOCKING
--   A plain (non-CONCURRENT) build takes a SHARE lock: it blocks writes to
--   KbChunk, not reads, so retrieval is unaffected. A btree over
--   (text, int) on ~49k rows is seconds even on the db-f1-micro, and the only
--   writer is the hand-run ingest job — unlike the GIN-over-content build in
--   20260908000000, which is why that one had to go out CONCURRENTLY and this
--   one does not. lock_timeout keeps it from queueing behind a long
--   transaction instead of failing fast.
--
-- NOTE ON KbChunk_docId_idx
--   This key's leading column is docId, so the existing non-unique
--   `KbChunk_docId_idx` is now largely redundant (a docId-only lookup can use
--   this index). It is deliberately LEFT IN PLACE — dropping an index that
--   retrieval and the #83 prune path both touch belongs in its own change with
--   its own before/after measurement, not bundled into a safety guard.

SET lock_timeout = '5s';

DO $do$
DECLARE
  dupe_rows    bigint;
  nondet_rows  bigint;
  idx_ok       boolean;
BEGIN
  SELECT COALESCE(bool_and(i.indisvalid AND i.indisready AND i.indisunique), false)
    INTO idx_ok
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'KbChunk_docId_chunkIndex_key';

  IF idx_ok THEN
    RAISE NOTICE 'KbChunk_docId_chunkIndex_key already present and valid — nothing to do.';
    RETURN;
  END IF;

  SELECT count(*) - count(DISTINCT ("docId", "chunkIndex")),
         -- Exact, not a `%::chunk::%` substring test: `legacy::chunk::x` or an
         -- id naming another doc contains the separator but is just as
         -- unreachable by ingest-kb.ts's upsert as a uuid id.
         count(*) FILTER (WHERE id IS DISTINCT FROM ("docId" || '::chunk::' || "chunkIndex"))
    INTO dupe_rows, nondet_rows
  FROM "KbChunk";

  IF dupe_rows > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'KbChunk holds %s row(s) beyond the first per (docId, chunkIndex) (and %s row(s) whose id is not the deterministic docId::chunk::N shape): refusing to create the unique index, which would fail with a bare 23505. Clean the table FIRST: run the dry-run + DELETE in scripts/sql/kb_duplicate_cleanup.sql (issue #86), VACUUM (ANALYZE) "KbChunk", then re-run this migration.',
        dupe_rows, nondet_rows),
      HINT = 'scripts/sql/kb_duplicate_cleanup.sql (issue #86); npm run ops:metrics reports the same counters as kb_duplicate_rows.';
  END IF;

  -- Drop a leftover invalid/non-unique index of the same name before rebuilding.
  DROP INDEX IF EXISTS "KbChunk_docId_chunkIndex_key";
  CREATE UNIQUE INDEX "KbChunk_docId_chunkIndex_key" ON "KbChunk"("docId", "chunkIndex");
END
$do$;
