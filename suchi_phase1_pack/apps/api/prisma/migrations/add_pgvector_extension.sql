-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create vector index for efficient similarity search
-- Note: This will be run manually after Prisma migration creates the column
-- Or add via raw SQL after migration
CREATE INDEX IF NOT EXISTS kb_chunk_embedding_idx ON "KbChunk" USING hnsw (embedding vector_cosine_ops);






