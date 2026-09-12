-- =============================================================================
-- KB reference-list chunk audit  (GitHub issue #129) — READ-ONLY
-- =============================================================================
--
-- Every NCI PDQ section ends with a `###### References` block: numbered entries
-- with `[[PUBMED Abstract]](url)` links. The ingest chunker indexes those blocks
-- like prose, and their paper titles embed close to the questions they cite —
-- for #126 the two top-ranked chunks were reference lists.
--
-- This approximates the retrieval-time filter in
-- apps/api/src/modules/rag/reference-chunk-filter.ts (rule "pubmed-density":
-- >= 2 PubMed links AND < 60% prose after stripping links/URLs) so the share of
-- the index that is reference noise can be measured before and after the
-- ingest-time fix (strip References before chunking, with the #86 re-index).
--
-- Run through the Cloud SQL proxy (docs/OPERATIONS_RUNBOOK.md §1). Nothing here
-- writes.

WITH scored AS (
  SELECT
    c.id,
    c."docId",
    length(c.content) AS total,
    (length(c.content) - length(replace(c.content, '[[PUBMED Abstract]]', ''))) / length('[[PUBMED Abstract]]') AS pubmed_links,
    length(
      regexp_replace(
        regexp_replace(
          regexp_replace(c.content, '\[[^\]]*\]\((https?://|#)[^)]*\)', ' ', 'g'),
          'https?://[^[:space:])"'']+', ' ', 'g'),
        -- scheme-less URL fragments from chunks cut inside a link (mirrors URL_FRAGMENT in the filter)
        '[^[:space:]]*(nih\.gov|\.fcgi\?|list_uids=|dopt=Abstract|\.(gov|org|com|edu|net)/|\.pdf)[^[:space:]]*', ' ', 'g')
    )::numeric / greatest(length(c.content), 1) AS prose_ratio
  FROM "KbChunk" c
)
SELECT
  count(*)                                                   AS chunks_total,
  count(*) FILTER (WHERE pubmed_links >= 2 AND prose_ratio < 0.6) AS reference_dominant,
  round(100.0 * count(*) FILTER (WHERE pubmed_links >= 2 AND prose_ratio < 0.6) / count(*), 1) AS pct_reference_dominant,
  count(DISTINCT "docId") FILTER (WHERE pubmed_links >= 2 AND prose_ratio < 0.6) AS docs_affected,
  count(*) FILTER (WHERE pubmed_links >= 1)                  AS chunks_with_any_pubmed_link
FROM scored;

-- Per source type, so the ingest fix can be scoped (PDQ vs NCI patient pages vs local docs).
WITH scored AS (
  SELECT
    d."sourceType",
    (length(c.content) - length(replace(c.content, '[[PUBMED Abstract]]', ''))) / length('[[PUBMED Abstract]]') AS pubmed_links,
    length(
      regexp_replace(
        regexp_replace(
          regexp_replace(c.content, '\[[^\]]*\]\((https?://|#)[^)]*\)', ' ', 'g'),
          'https?://[^[:space:])"'']+', ' ', 'g'),
        -- scheme-less URL fragments from chunks cut inside a link (mirrors URL_FRAGMENT in the filter)
        '[^[:space:]]*(nih\.gov|\.fcgi\?|list_uids=|dopt=Abstract|\.(gov|org|com|edu|net)/|\.pdf)[^[:space:]]*', ' ', 'g')
    )::numeric / greatest(length(c.content), 1) AS prose_ratio
  FROM "KbChunk" c JOIN "KbDocument" d ON d.id = c."docId"
)
SELECT "sourceType",
       count(*) AS chunks,
       count(*) FILTER (WHERE pubmed_links >= 2 AND prose_ratio < 0.6) AS reference_dominant
FROM scored
GROUP BY 1 ORDER BY 3 DESC;
