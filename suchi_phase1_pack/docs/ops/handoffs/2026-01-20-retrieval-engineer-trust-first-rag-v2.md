# Trust-First RAG v2 - Retrieval & Hybrid Search Workstream

**Date:** 2026-01-20  
**Agent:** @retrieval-engineer  
**Scope:** Phase 1 - Hybrid Search (pgvector + Postgres FTS) with trust-aware reranking  
**Priority:** HIGH - Foundation for evidence-based medical responses

---

## Objective

Implement hybrid retrieval combining vector similarity and full-text search with trust-aware reranking to ensure medical queries surface authoritative content in top results.

---

## Context

Currently, `RagService` uses pure vector search with trust-based reranking. This Phase 1 upgrade adds:
- Postgres full-text search (FTS) using generated `tsvector` column
- Hybrid scoring: 60% vector similarity + 40% lexical match
- Existing trust-aware reranking preserved

---

## Tasks

### 1. Database Schema & Migration

**File:** `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_fts_to_kbchunk/migration.sql` (new)

Create migration to add:

```sql
-- Add generated tsvector column (DB-level, not in Prisma schema)
ALTER TABLE "KbChunk" 
ADD COLUMN content_tsv tsvector 
GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Add GIN index for fast FTS queries
CREATE INDEX kb_chunk_content_tsv_idx ON "KbChunk" USING GIN (content_tsv);
```

**Important:**
- Do NOT add `content_tsv` to Prisma schema (it's DB-only)
- Access via `$queryRaw` only
- Test migration on dev DB before committing

### 2. Implement Full-Text Search

**File:** `apps/api/src/modules/rag/rag.service.ts`

Add new private method:

```typescript
private async fullTextSearchWithMetadata(
  query: string, 
  topK: number
): Promise<EvidenceChunk[]> {
  // Use websearch_to_tsquery for better query parsing
  const results = await this.prisma.$queryRaw<Array<{
    id: string;
    docId: string;
    content: string;
    lexRank: number; // ts_rank_cd score
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

  // Calculate max lexRank for normalization (guard against zero)
  const maxLexRank = Math.max(...results.map(r => r.lexRank), 0.0001);

  return results.map(r => ({
    chunkId: r.id,
    docId: r.docId,
    content: r.content,
    similarity: r.lexRank / maxLexRank, // Normalized lexSim placeholder
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

### 3. Implement Hybrid Search

**File:** `apps/api/src/modules/rag/rag.service.ts`

Add new private method:

```typescript
private async hybridSearchWithMetadata(
  query: string,
  topK: number,
  cancerType?: string | null
): Promise<EvidenceChunk[]> {
  // Parallel retrieval: vector + FTS
  const [vectorChunks, ftsChunks] = await Promise.all([
    this.vectorSearchWithMetadata(query, topK * 2),
    this.fullTextSearchWithMetadata(query, topK * 2)
  ]);

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

  // Process FTS results (normalize lexical scores)
  const maxLexRank = Math.max(...ftsChunks.map(c => c.similarity || 0), 0.0001);
  for (const chunk of ftsChunks) {
    const lexSim = (chunk.similarity || 0) / maxLexRank;
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

  // Return top-K
  return reranked.slice(0, topK);
}
```

### 4. Wire Hybrid Search as Primary Path

**File:** `apps/api/src/modules/rag/rag.service.ts`

Update `retrieveWithMetadata`:

```typescript
async retrieveWithMetadata(
  query: string, 
  topK = 6, 
  cancerType?: string | null, 
  queryType?: string
): Promise<EvidenceChunk[]> {
  try {
    // Step 1: Query rewrite (existing)
    const rewrittenQuery = this.rewriteQuery(query, cancerType, queryType);
    if (rewrittenQuery !== query) {
      this.logger.debug(`Query rewritten from "${query}" to "${rewrittenQuery}"`);
    }

    // Step 2: Synonym expansion (existing)
    const expandedTerms = this.synonyms.expandQuery(rewrittenQuery);
    if (expandedTerms.length > 1) {
      this.logger.debug(`Query expanded from "${rewrittenQuery}" to ${expandedTerms.length} terms`);
    }

    // Step 3: PRIMARY PATH - Hybrid search
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
    
    // Final fallback: Keyword search
    this.logger.warn("Vector search failed, falling back to keyword search");
    return this.keywordSearchWithMetadata(expandedTerms.join(" "), topK);
  } catch (error) {
    this.logger.error(`Error in RAG retrieval: ${error.message}`, error.stack);
    // Fallback to keyword search on error
    return this.keywordSearchWithMetadata(query, topK);
  }
}
```

---

## Testing

### Manual Test (via existing API)

```bash
# Test hybrid retrieval with medical query
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-hybrid-001",
    "userText": "What are the symptoms of breast cancer?",
    "channel": "test",
    "locale": "en-US"
  }'

# Check logs for "Hybrid search returned X results"
```

### Verify Trust Reranking Still Works

- Run queries and check that NCI/WHO sources appear in top-3 even if vector scores are slightly lower
- Enable `RAG_TRACE_RERANK=true` to see before/after rankings

---

## Acceptance Criteria

✅ Migration adds `content_tsv` column and GIN index  
✅ `fullTextSearchWithMetadata` returns chunks with normalized lexical scores  
✅ `hybridSearchWithMetadata` merges vec + lex with 60/40 weighting  
✅ `retrieveWithMetadata` uses hybrid as primary path  
✅ Trust-aware reranking still applied after hybrid scoring  
✅ No performance degradation (hybrid should be <200ms for most queries)

---

## Files to Modify

1. **NEW:** `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_fts_to_kbchunk/migration.sql`
2. **EDIT:** `apps/api/src/modules/rag/rag.service.ts` (add 2 methods, update 1 method)

---

## Handoff to Next Agent

Once hybrid search is implemented and tested:
- Handoff to **@tests-eval-author** for eval scenario creation (`eval/hybrid_retrieval_scenarios.json`)
- Coordinate with **@safety-gatekeeper** to ensure evidence gate works with new retrieval

---

## Questions / Blockers

- **Postgres version?** (Need >=9.6 for `websearch_to_tsquery`)
- **Migration timing?** Run in dev first or wait for code review?
- **Performance target?** Current vector search is ~100-150ms; hybrid should stay <200ms

---

## Notes

- Keep existing `vectorSearchWithMetadata` and `keywordSearchWithMetadata` unchanged (used as fallbacks)
- The `rerankByTrustedSource` method already exists and works - just call it after hybrid scoring
- Use `$queryRaw` for all FTS queries (Prisma doesn't support `tsvector` natively)
