-- AlterTable: Add full-text search support to KbChunk
-- This adds a generated tsvector column and GIN index for fast full-text search

-- Add generated tsvector column (DB-level, not in Prisma schema)
-- This column is automatically populated from the content column
ALTER TABLE "KbChunk" 
ADD COLUMN content_tsv tsvector 
GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Add GIN index for fast full-text search queries
-- This enables efficient ts_rank_cd and @@ operator queries
CREATE INDEX kb_chunk_content_tsv_idx ON "KbChunk" USING GIN (content_tsv);
