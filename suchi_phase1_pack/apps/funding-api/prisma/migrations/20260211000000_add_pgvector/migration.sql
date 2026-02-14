-- pgvector migration: push cosine-similarity search from JS to PostgreSQL
-- Adds native vector(1536) column + HNSW index to all 4 embedding tables

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add native vector columns (nullable, so existing rows are fine)
ALTER TABLE "ChunkEmbedding" ADD COLUMN "embedding" vector(1536);
ALTER TABLE "MethodCardChunkEmbedding" ADD COLUMN "embedding" vector(1536);
ALTER TABLE "PatternCardChunkEmbedding" ADD COLUMN "embedding" vector(1536);
ALTER TABLE "ComparableCaseChunkEmbedding" ADD COLUMN "embedding" vector(1536);

-- 3. Backfill from existing JSON TEXT column → native vector
-- ChunkEmbedding (main table, ~2000+ rows)
UPDATE "ChunkEmbedding"
SET "embedding" = "vector"::vector
WHERE "vector" IS NOT NULL AND "embedding" IS NULL;

-- MethodCardChunkEmbedding
UPDATE "MethodCardChunkEmbedding"
SET "embedding" = "vector"::vector
WHERE "vector" IS NOT NULL AND "embedding" IS NULL;

-- PatternCardChunkEmbedding
UPDATE "PatternCardChunkEmbedding"
SET "embedding" = "vector"::vector
WHERE "vector" IS NOT NULL AND "embedding" IS NULL;

-- ComparableCaseChunkEmbedding
UPDATE "ComparableCaseChunkEmbedding"
SET "embedding" = "vector"::vector
WHERE "vector" IS NOT NULL AND "embedding" IS NULL;

-- 4. Create HNSW indexes for fast approximate nearest-neighbor search
-- Using cosine distance operator class (vector_cosine_ops)
-- m=16, ef_construction=64 are good defaults for datasets <100K vectors
CREATE INDEX "ChunkEmbedding_embedding_hnsw_idx"
ON "ChunkEmbedding" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX "MethodCardChunkEmbedding_embedding_hnsw_idx"
ON "MethodCardChunkEmbedding" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX "PatternCardChunkEmbedding_embedding_hnsw_idx"
ON "PatternCardChunkEmbedding" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX "ComparableCaseChunkEmbedding_embedding_hnsw_idx"
ON "ComparableCaseChunkEmbedding" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
