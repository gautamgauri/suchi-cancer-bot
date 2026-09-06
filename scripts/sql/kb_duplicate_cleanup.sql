-- =============================================================================
-- KB chunk duplicate-row audit and cleanup plan  (GitHub issue #86)
-- =============================================================================
--
-- STATE MEASURED 2026-09-06 against suchi-db (read-only):
--   73,802 KbChunk rows, 1,439 docs, all rows embedded.
--   25,065 rows are from a 2025-12-31/2026-01-01 ingest run that wrote rows with
--   UUID ids; the 2026-01-02 run wrote deterministic ids (`docId::chunk::N`),
--   so ingest-kb.ts's `ON CONFLICT ("id")` upsert never matched and a full
--   second copy was inserted for 511 of the 1,433 NCI docs. Every one of those
--   25,065 rows has a deterministic-id twin with the same docId, the same
--   chunkIndex and byte-identical content and embedding.
--   A further 243 same-content rows at DIFFERENT chunkIndex are genuine
--   in-document repetition (NCI PDQ boilerplate such as "### Current Clinical
--   Trials"); they are NOT ingest damage and are left alone here.
--
-- WHICH ROW SURVIVES: the deterministic-id row. Do NOT "keep the lowest
-- chunkIndex / earliest createdAt" (the first proposal in #86): under that rule
-- the UUID row wins the tie on 24,876 groups, and the very next `npm run
-- kb:ingest` would insert the deterministic ids again and recreate every
-- duplicate.
--
-- HOW TO USE:
--   Sections 1-3 are read-only and are what this file is for. Section 4 is the
--   DELETE, left inside a comment block. A human runs it, inside an explicit
--   transaction, only after sections 1-3 report the expected numbers.
--
-- COST NOTE: suchi-db is a db-f1-micro. A GROUP BY over KbChunk took ~3 min
-- under load; expect minutes, not seconds, for sections 2-3 and the DELETE.
-- Nothing here is safe to run from a request path.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cheap health signal (the same query OpsMetricsService.kbIndexIntegrity runs).
--    Healthy index: duplicate_position_rows = 0 AND non_deterministic_id_rows = 0.
--    Measured 2026-09-06: 73802 | 25065 | 25065
-- ---------------------------------------------------------------------------
SELECT
  count(*)::int                                                       AS total_rows,
  (count(*) FILTER (WHERE id NOT LIKE '%::chunk::%'))::int            AS non_deterministic_id_rows,
  (count(*) - count(DISTINCT ("docId", "chunkIndex")))::int           AS duplicate_position_rows
FROM "KbChunk";

-- ---------------------------------------------------------------------------
-- 2. DRY RUN — exactly the rows section 4 would delete.
--    A stale row is: non-deterministic id, in a doc that also has deterministic
--    rows. Expected 2026-09-06: 25065.
-- ---------------------------------------------------------------------------
WITH mixed_docs AS (
  SELECT "docId"
  FROM "KbChunk"
  GROUP BY "docId"
  HAVING bool_or(id LIKE '%::chunk::%') AND bool_or(id NOT LIKE '%::chunk::%')
)
SELECT count(*) AS rows_delete_would_remove
FROM "KbChunk" k
JOIN mixed_docs m ON m."docId" = k."docId"
WHERE k.id NOT LIKE '%::chunk::%';

-- ---------------------------------------------------------------------------
-- 3. SAFETY INVARIANT — every row section 4 would delete has a surviving twin
--    with the same docId, the same chunkIndex and byte-identical content.
--    Both columns MUST be equal (expected 25065 = 25065). If they differ, STOP:
--    some stale row carries content the deterministic run did not re-ingest.
--    (Verified offline 2026-09-06: 25065/25065. Slow on f1-micro.)
-- ---------------------------------------------------------------------------
WITH mixed_docs AS (
  SELECT "docId"
  FROM "KbChunk"
  GROUP BY "docId"
  HAVING bool_or(id LIKE '%::chunk::%') AND bool_or(id NOT LIKE '%::chunk::%')
),
stale AS (
  SELECT k.*
  FROM "KbChunk" k
  JOIN mixed_docs m ON m."docId" = k."docId"
  WHERE k.id NOT LIKE '%::chunk::%'
)
SELECT
  count(*)                                                     AS stale_rows,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM "KbChunk" t
    WHERE t."docId" = stale."docId"
      AND t."chunkIndex" = stale."chunkIndex"
      AND t.id LIKE '%::chunk::%'
      AND t.content = stale.content))                          AS stale_rows_with_identical_twin
FROM stale;

-- Optional: MessageCitation rows that reference a to-be-deleted chunk id.
-- MessageCitation.chunkId is a plain text column with no FK, and nothing in the
-- API resolves a stored chunkId back to KbChunk at read time (citationText is
-- stored on the citation row), so these become inert strings, not errors.
WITH mixed_docs AS (
  SELECT "docId" FROM "KbChunk" GROUP BY "docId"
  HAVING bool_or(id LIKE '%::chunk::%') AND bool_or(id NOT LIKE '%::chunk::%')
)
SELECT count(*) AS citations_pointing_at_stale_rows
FROM "MessageCitation" mc
JOIN "KbChunk" k ON k.id = mc."chunkId"
JOIN mixed_docs m ON m."docId" = k."docId"
WHERE k.id NOT LIKE '%::chunk::%';

-- ---------------------------------------------------------------------------
-- 4. THE DELETE — *** NOT RUN. NOT TO BE RUN BY AN AGENT. ***
--    Human-only, after sections 1-3 match expectations, in one transaction,
--    with the row count checked before COMMIT. Wrapped in a comment so this
--    file can never be piped into psql by accident.
-- ---------------------------------------------------------------------------
/*
BEGIN;

WITH mixed_docs AS (
  SELECT "docId"
  FROM "KbChunk"
  GROUP BY "docId"
  HAVING bool_or(id LIKE '%::chunk::%') AND bool_or(id NOT LIKE '%::chunk::%')
)
DELETE FROM "KbChunk" k
USING mixed_docs m
WHERE m."docId" = k."docId"
  AND k.id NOT LIKE '%::chunk::%';
-- psql prints "DELETE <n>". n MUST equal section 2's count (25065 on 2026-09-06).
-- If it does not: ROLLBACK;

-- Post-check inside the same transaction: both must be 0.
SELECT
  (count(*) FILTER (WHERE id NOT LIKE '%::chunk::%'))::int  AS non_deterministic_id_rows,
  (count(*) - count(DISTINCT ("docId", "chunkIndex")))::int AS duplicate_position_rows
FROM "KbChunk";

COMMIT;   -- or ROLLBACK;

-- Afterwards (autovacuum will get there, but the HNSW index is 182 MB on a
-- 0.6 GB instance, so reclaiming it promptly matters for cache hit rate):
VACUUM (VERBOSE, ANALYZE) "KbChunk";
*/

-- ---------------------------------------------------------------------------
-- 5. What is deliberately NOT cleaned here
--    243 rows: identical content at different chunkIndex within one run —
--    NCI PDQ boilerplate ("### Current Clinical Trials ...", reference lists).
--    They are what the source document says; removing them is a content /
--    chunker decision (filter boilerplate at ingest), not a DB repair.
--    List them with:
-- ---------------------------------------------------------------------------
-- WITH g AS (
--   SELECT "docId", md5(content) h
--   FROM "KbChunk"
--   WHERE id LIKE '%::chunk::%'
--   GROUP BY 1, 2 HAVING count(*) > 1)
-- SELECT k."docId", count(*) copies, array_agg(k."chunkIndex" ORDER BY k."chunkIndex") idxs,
--        left(k.content, 80) snippet
-- FROM "KbChunk" k JOIN g ON g."docId" = k."docId" AND g.h = md5(k.content)
-- GROUP BY k."docId", k.content ORDER BY copies DESC;
