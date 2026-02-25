-- Switch embedding provider from OpenAI (1536-d) to Google Gemini (768-d).
-- Steps:
-- 1. Drop HNSW indexes (cannot ALTER column type with index)
-- 2. Clear all existing embeddings (they're OpenAI 1536-d, incompatible with Google 768-d)
-- 3. Change column type from vector(1536) to vector(768)
-- 4. Rebuild HNSW indexes
-- 5. Clear legacy JSON vector columns too (will be re-populated by embedPendingChunks)

-- 1. Drop existing HNSW indexes
DROP INDEX IF EXISTS "idx_chunk_embedding_hnsw";
DROP INDEX IF EXISTS "idx_method_card_chunk_embedding_hnsw";
DROP INDEX IF EXISTS "idx_pattern_card_chunk_embedding_hnsw";
DROP INDEX IF EXISTS "idx_comparable_case_chunk_embedding_hnsw";

-- 2. Clear all existing embedding data (incompatible dimensions)
-- Delete ChunkEmbedding rows so embedPendingChunks will re-process them
DELETE FROM "ChunkEmbedding";
DELETE FROM "MethodCardChunkEmbedding" WHERE TRUE;
DELETE FROM "PatternCardChunkEmbedding" WHERE TRUE;
DELETE FROM "ComparableCaseChunkEmbedding" WHERE TRUE;

-- 3. Change column dimensions from 1536 to 768
ALTER TABLE "ChunkEmbedding" ALTER COLUMN "embedding" TYPE vector(768) USING NULL;
ALTER TABLE "MethodCardChunkEmbedding" ALTER COLUMN "embedding" TYPE vector(768) USING NULL;
ALTER TABLE "PatternCardChunkEmbedding" ALTER COLUMN "embedding" TYPE vector(768) USING NULL;
ALTER TABLE "ComparableCaseChunkEmbedding" ALTER COLUMN "embedding" TYPE vector(768) USING NULL;

-- 4. Rebuild HNSW indexes with same parameters
CREATE INDEX "idx_chunk_embedding_hnsw"
ON "ChunkEmbedding" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX "idx_method_card_chunk_embedding_hnsw"
ON "MethodCardChunkEmbedding" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX "idx_pattern_card_chunk_embedding_hnsw"
ON "PatternCardChunkEmbedding" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX "idx_comparable_case_chunk_embedding_hnsw"
ON "ComparableCaseChunkEmbedding" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
