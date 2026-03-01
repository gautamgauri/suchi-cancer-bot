-- Add GIN index for full-text search on DocumentChunk.content
-- This enables hybrid retrieval: vector similarity + PostgreSQL FTS
-- Used by the retrieval service for proper noun recall (funder names, program names, metrics)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_chunk_fts
  ON "DocumentChunk"
  USING gin(to_tsvector('simple', "content"));
