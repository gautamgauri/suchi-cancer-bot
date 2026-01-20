# Retrieval Engineer Agent Instructions

**Role:** Retrieval & Search Infrastructure Specialist  
**Current Assignment:** Trust-First RAG v2 - Phase 1  
**Handoff Document:** `docs/ops/handoffs/2026-01-20-retrieval-engineer-trust-first-rag-v2.md`

---

## Your Mission

Implement hybrid retrieval (vector + full-text search) with trust-aware reranking to ensure medical queries surface authoritative content in top results.

---

## Step-by-Step Instructions

### STEP 1: Read Your Handoff Document
```bash
# Open and read carefully
code docs/ops/handoffs/2026-01-20-retrieval-engineer-trust-first-rag-v2.md
```

**Key sections to understand:**
- Context: Current RagService implementation
- Tasks 1-4: What you need to build
- Acceptance Criteria: How success is measured

### STEP 2: Create Database Migration for Full-Text Search

**File:** `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_fts_to_kbchunk/migration.sql`

1. Create new migration:
```bash
cd apps/api
npx prisma migrate dev --name add_fts_to_kbchunk --create-only
```

2. Edit the generated migration file to add:
```sql
-- Add generated tsvector column (DB-level, not in Prisma schema)
ALTER TABLE "KbChunk" 
ADD COLUMN content_tsv tsvector 
GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Add GIN index for fast FTS queries
CREATE INDEX kb_chunk_content_tsv_idx ON "KbChunk" USING GIN (content_tsv);
```

3. Apply migration in dev:
```bash
npx prisma migrate dev
```

4. Verify migration:
```sql
-- Check column exists
\d "KbChunk"

-- Check index exists
\di kb_chunk_content_tsv_idx
```

### STEP 3: Implement Full-Text Search Method

**File:** `apps/api/src/modules/rag/rag.service.ts`

Add this private method (around line 310, after `vectorSearchWithMetadata`):

```typescript
/**
 * Full-text search using Postgres tsvector
 * Returns chunks with lexical ranking scores
 */
private async fullTextSearchWithMetadata(
  query: string, 
  topK: number
): Promise<EvidenceChunk[]> {
  // Use websearch_to_tsquery for better query parsing
  const results = await this.prisma.$queryRaw<Array<{
    id: string;
    docId: string;
    content: string;
    lexRank: number;
    title: string;
    url: string | null;
    sourceType: string | null;
    source: string | null;
    citation: string | null;
    lastReviewed: Date | null;
    isTrustedSource: boolean;
  }>>`
    SELECT 
      c.id,
      c."docId",
      c.content,
      ts_rank_cd(c.content_tsv, query) AS "lexRank",
      d.title,
      d.url,
      d."sourceType",
      d.source,
      d.citation,
      d."lastReviewed",
      d."isTrustedSource"
    FROM "KbChunk" c
    INNER JOIN "KbDocument" d ON c."docId" = d.id,
    websearch_to_tsquery('english', ${query}) query
    WHERE d.status = 'active'
      AND c.content_tsv @@ query
    ORDER BY ts_rank_cd(c.content_tsv, query) DESC
    LIMIT ${topK * 2}
  `;

  if (results.length === 0) {
    return [];
  }

  // Calculate max lexRank for normalization (guard against zero)
  const maxLexRank = Math.max(...results.map(r => r.lexRank), 0.0001);

  return results.map(r => ({
    chunkId: r.id,
    docId: r.docId,
    content: r.content,
    similarity: r.lexRank / maxLexRank, // Normalized lexical similarity
    document: {
      title: r.title,
      url: r.url || undefined,
      sourceType: r.sourceType,
      source: r.source,
      citation: r.citation,
      lastReviewed: r.lastReviewed || undefined,
      isTrustedSource: r.isTrustedSource
    }
  }));
}
```

### STEP 4: Implement Hybrid Search Method

**File:** `apps/api/src/modules/rag/rag.service.ts`

Add this private method (after `fullTextSearchWithMetadata`):

```typescript
/**
 * Hybrid search combining vector similarity and full-text search
 * Scoring: 60% vector + 40% lexical, then trust-aware reranking
 */
private async hybridSearchWithMetadata(
  query: string,
  topK: number,
  cancerType?: string | null
): Promise<EvidenceChunk[]> {
  // Parallel retrieval: vector + FTS
  const [vectorChunks, ftsChunks] = await Promise.all([
    this.vectorSearchWithMetadata(query, topK * 2).catch(err => {
      this.logger.warn(`Vector search failed: ${err.message}`);
      return [];
    }),
    this.fullTextSearchWithMetadata(query, topK * 2).catch(err => {
      this.logger.warn(`FTS failed: ${err.message}`);
      return [];
    })
  ]);

  if (vectorChunks.length === 0 && ftsChunks.length === 0) {
    return [];
  }

  // Merge and score
  const chunkMap = new Map<string, {
    chunk: EvidenceChunk;
    vecSim: number;
    lexSim: number;
  }>();

  // Process vector results
  for (const chunk of vectorChunks) {
    const vecSim = chunk.similarity || 0;
    chunkMap.set(chunk.chunkId, {
      chunk,
      vecSim,
      lexSim: 0 // Will be filled if FTS also found this chunk
    });
  }

  // Process FTS results
  for (const chunk of ftsChunks) {
    const lexSim = chunk.similarity || 0; // Already normalized
    const existing = chunkMap.get(chunk.chunkId);
    if (existing) {
      existing.lexSim = lexSim;
    } else {
      chunkMap.set(chunk.chunkId, {
        chunk,
        vecSim: 0,
        lexSim
      });
    }
  }

  // Calculate hybrid scores: 0.6 * vecSim + 0.4 * lexSim
  const scored = Array.from(chunkMap.values()).map(item => ({
    chunk: item.chunk,
    finalScore: 0.6 * item.vecSim + 0.4 * item.lexSim,
    vecSim: item.vecSim,
    lexSim: item.lexSim
  }));

  // Sort by finalScore descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Update similarity field with hybrid score
  const hybridChunks = scored.map(s => ({
    ...s.chunk,
    similarity: s.finalScore
  }));

  // Apply existing trust-aware reranking
  const reranked = this.rerankByTrustedSource(hybridChunks, query);

  this.logger.debug(`Hybrid search: ${vectorChunks.length} vector + ${ftsChunks.length} FTS = ${chunkMap.size} unique chunks`);

  // Return top-K
  return reranked.slice(0, topK);
}
```

### STEP 5: Wire Hybrid Search as Primary Path

**File:** `apps/api/src/modules/rag/rag.service.ts`

Update the `retrieveWithMetadata` method (around line 26):

Find this section:
```typescript
// Step 3: Try vector search with rewritten query
const vectorResults = await this.vectorSearchWithMetadata(rewrittenQuery, topK);
if (vectorResults.length > 0) {
  return vectorResults;
}
```

Replace with:
```typescript
// Step 3: PRIMARY PATH - Hybrid search (vector + FTS)
const hybridResults = await this.hybridSearchWithMetadata(rewrittenQuery, topK, cancerType);
if (hybridResults.length > 0) {
  this.logger.debug(`Hybrid search returned ${hybridResults.length} results`);
  return hybridResults;
}

// Fallback: Vector only (if FTS fails)
this.logger.warn("Hybrid search failed, trying vector only");
const vectorResults = await this.vectorSearchWithMetadata(rewrittenQuery, topK);
if (vectorResults.length > 0) {
  return vectorResults;
}
```

### STEP 6: Test Your Implementation

1. **Start the API:**
```bash
cd apps/api
npm run dev
```

2. **Test hybrid retrieval manually:**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-hybrid-001",
    "userText": "What are the symptoms of breast cancer?",
    "channel": "test",
    "locale": "en-US"
  }'
```

3. **Check logs for:**
```
Hybrid search returned X results
```

4. **Enable trace logging to verify trust reranking:**
```bash
RAG_TRACE_RERANK=true npm run dev
```

### STEP 7: Coordinate with Tests Agent

Once your implementation is complete:
1. Notify **@tests-eval-author** that hybrid search is ready
2. Coordinate on debug mode implementation (if needed)
3. Help troubleshoot any eval failures

---

## Success Checklist

Before marking your work complete, verify:

- [ ] Migration applied successfully (content_tsv column + index exists)
- [ ] `fullTextSearchWithMetadata()` returns chunks with normalized scores
- [ ] `hybridSearchWithMetadata()` merges vector + FTS with 60/40 weighting
- [ ] `retrieveWithMetadata()` uses hybrid as primary path
- [ ] Trust-aware reranking still works (check logs)
- [ ] Manual test query returns results
- [ ] No performance degradation (<200ms for typical queries)
- [ ] Code compiles without TypeScript errors
- [ ] No new linter errors introduced

---

## If You Get Stuck

**Common Issues:**

1. **Migration fails:** Check Postgres version (need >=9.6 for `websearch_to_tsquery`)
2. **TypeScript errors:** Ensure `EvidenceChunk` type is imported correctly
3. **No FTS results:** Verify `content_tsv` column populated (check with SQL query)
4. **Slow queries:** Check that GIN index was created successfully

**Get Help:**
- Review handoff document for more context
- Check existing `vectorSearchWithMetadata` implementation for patterns
- Ask orchestrator for clarification

---

## When Complete

Update TODO status:
```typescript
// Mark these as completed:
// - db-fts-migration
// - rag-fts-method
// - rag-hybrid-method
// - rag-wire-hybrid
```

Notify orchestrator and hand off to **@tests-eval-author** for evaluation testing.
