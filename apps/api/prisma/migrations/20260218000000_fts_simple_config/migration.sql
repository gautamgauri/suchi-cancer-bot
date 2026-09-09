-- Switch FTS from 'english' to 'simple' config for multilingual support (Hindi + English)
-- The 'simple' config tokenizes on whitespace/punctuation without language-specific stemming,
-- which works for all languages. Vector search handles semantic matching.

-- Drop existing generated column and index
DROP INDEX IF EXISTS kb_chunk_content_tsv_idx;
ALTER TABLE "KbChunk" DROP COLUMN IF EXISTS content_tsv;

-- Recreate with 'simple' config (language-agnostic tokenization)
ALTER TABLE "KbChunk"
ADD COLUMN content_tsv tsvector
GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX kb_chunk_content_tsv_idx ON "KbChunk" USING GIN (content_tsv);
