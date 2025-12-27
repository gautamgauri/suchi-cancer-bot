# Vector RAG Setup Guide

## Overview

This guide explains how to set up pgvector for semantic search in the Suchi Cancer Bot knowledge base.

## Prerequisites

- PostgreSQL 11+ (recommended: PostgreSQL 14+)
- pgvector extension installed
- Google API key for embeddings (can use GEMINI_API_KEY)

## Step 1: Install pgvector Extension

### On Local PostgreSQL:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### On Managed Services:

- **Railway**: Add pgvector from marketplace or use custom build
- **Supabase**: pgvector is pre-installed
- **Neon**: Enable via dashboard or SQL: `CREATE EXTENSION vector;`
- **AWS RDS**: Requires custom parameter group with pgvector library

## Step 2: Run Database Migration

1. **Update Prisma schema** (already done):
   - The `KbChunk` model now includes an `embedding` field of type `vector(768)`

2. **Create migration**:
   ```bash
   cd apps/api
   npx prisma migrate dev --name add_vector_embeddings
   ```

3. **Enable pgvector extension manually** (if not auto-created):
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

4. **Create vector index** (for performance):
   ```sql
   CREATE INDEX kb_chunk_embedding_idx 
   ON "KbChunk" 
   USING hnsw (embedding vector_cosine_ops);
   ```
   
   Or via Prisma migration SQL file:
   ```bash
   # The SQL file is at: apps/api/prisma/migrations/add_pgvector_extension.sql
   ```

## Step 3: Configure Environment Variables

Add to `.env`:

```env
# Embeddings (can use same key as Gemini)
EMBEDDING_API_KEY=your_google_api_key_here
# OR
EMBEDDING_API_KEY=${GEMINI_API_KEY}  # Use Gemini key

# Embedding model
EMBEDDING_MODEL=text-embedding-004  # Google's embedding model
```

## Step 4: Generate Embeddings for Existing Content

If you have existing KB content without embeddings:

1. **Option A: Re-ingest all content** (regenerates embeddings):
   ```bash
   cd apps/api
   npm run kb:ingest  # This will generate embeddings for all chunks
   ```

2. **Option B: Skip embeddings for now** (for faster testing):
   ```bash
   npm run kb:ingest:no-embeddings
   ```

## Step 5: Verify Setup

1. **Check embeddings were generated**:
   ```sql
   SELECT COUNT(*) FROM "KbChunk" WHERE embedding IS NOT NULL;
   ```

2. **Test vector search**:
   ```sql
   -- Get a test embedding first (you'd need to generate one)
   SELECT embedding <=> embedding AS distance
   FROM "KbChunk"
   WHERE embedding IS NOT NULL
   LIMIT 1;
   ```

3. **Test RAG service**:
   - Start the API: `npm run dev`
   - Send a chat query via the frontend
   - Check logs for "vector search" vs "keyword search" messages

## How It Works

### Embedding Generation
- During KB ingestion, each chunk is sent to Google's embedding API
- Embeddings are 768-dimensional vectors (text-embedding-004)
- Stored in PostgreSQL as `vector(768)` type

### Vector Search
- User query is converted to an embedding
- Cosine similarity search finds most relevant chunks
- Falls back to keyword search if no embeddings exist

### Performance
- HNSW index provides fast similarity search (< 100ms for 10K chunks)
- Batch embedding generation respects rate limits
- Embeddings are cached (regenerated only when content changes)

## Troubleshooting

### "Extension vector does not exist"
- Ensure pgvector is installed: `CREATE EXTENSION vector;`
- Check PostgreSQL version (11+ required)

### "Embedding API errors"
- Verify API key is set correctly
- Check rate limits (Google has quotas)
- Use `--skip-embeddings` flag to test without embeddings

### "Vector index not used"
- Ensure index was created: Check with `\d+ "KbChunk"` in psql
- Index name: `kb_chunk_embedding_idx`

### "No embeddings found" warning
- This is normal for new KB content
- Run `npm run kb:ingest` to generate embeddings
- System falls back to keyword search automatically

## Migration from Keyword Search

The system is backward compatible:
1. Existing chunks without embeddings use keyword search
2. New chunks get embeddings automatically
3. Gradually migrate: embeddings are generated on next ingestion
4. No downtime required

## Performance Tuning

### Index Type
- **HNSW** (recommended): Fast, higher build time, good for read-heavy
- **IVFFlat**: Faster build, slightly slower queries

### Index Parameters
```sql
-- HNSW with custom parameters (optional)
CREATE INDEX kb_chunk_embedding_idx 
ON "KbChunk" 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

### Batch Size
- Embedding generation: 5 chunks per batch (configurable in code)
- Adjust delay between batches if hitting rate limits

## Next Steps

- Set up monthly YouTube transcript updates (see `scripts/youtube-transcripts/`)
- Monitor embedding generation costs
- A/B test: Compare vector vs keyword search quality
- Consider hybrid search (combine both methods)


