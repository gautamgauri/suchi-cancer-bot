import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmbeddingsService } from "../embeddings/embeddings.service";
import { SynonymService } from "./synonym-service";
import { QueryExpanderService } from "./query-expander.service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";
import { isTrustedSource, getSourceConfig, TRUSTED_SOURCES } from "../../config/trusted-sources.config";
import { QueryTypeClassifier } from "./query-type.classifier";

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
    private readonly synonyms: SynonymService,
    private readonly queryExpander: QueryExpanderService
  ) {}

  /**
   * Retrieve chunks with full document metadata for citations
   * @param query Original user query
   * @param topK Number of chunks to retrieve
   * @param cancerType Optional cancer type for query enhancement
   * @param queryType Optional pre-classified query type (to avoid re-classification)
   */
  async retrieveWithMetadata(query: string, topK = 6, cancerType?: string | null, queryType?: string, intent?: string): Promise<EvidenceChunk[]> {
    try {
      // Step 1: Query rewrite using QueryTypeClassifier + cancer terms
      const rewrittenQuery = this.rewriteQuery(query, cancerType, queryType);
      if (rewrittenQuery !== query) {
        this.logger.debug(`Query rewritten from "${query}" to "${rewrittenQuery}"`);
      }

      // PHASE 3: Step 1.5: Medical term expansion for symptom queries (bloating → abdominal distension)
      let finalQuery = rewrittenQuery;
      // Try expansion for symptom-related queries (uses heuristics if intent not provided)
      const expansion = this.queryExpander.expandQuery(rewrittenQuery, intent || 'INFORMATIONAL_GENERAL');
      if (expansion.expanded.length > 1) {
        // Use first expansion (original + first synonym) for hybrid search
        // This gives us both colloquial and medical terms
        finalQuery = expansion.expanded.slice(0, 2).join(" OR ");
        this.logger.log({
          event: 'symptom_query_expansion',
          original: query,
          rewritten: rewrittenQuery,
          expanded: finalQuery,
          synonymsMatched: Array.from(expansion.synonyms.keys()),
        });
      }

      // Step 2: Expand query with general synonyms if available
      const expandedTerms = this.synonyms.expandQuery(finalQuery);
      if (expandedTerms.length > 1) {
        this.logger.debug(`Query expanded from "${finalQuery}" to ${expandedTerms.length} terms`);
      }

      // Step 3: PRIMARY PATH - Hybrid search (vector + FTS)
      const hybridResults = await this.hybridSearchWithMetadata(finalQuery, topK, cancerType);
      if (hybridResults.length > 0) {
        this.logger.debug(`Hybrid search returned ${hybridResults.length} results`);
        return hybridResults;
      }

      // Fallback: Vector only (if FTS fails or not available)
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

  /**
   * Rewrite query using QueryTypeClassifier and cancer type to improve retrieval
   * Adds intent-specific terms and cancer type context
   * @param queryType Optional pre-classified query type (to avoid re-classification)
   */
  private rewriteQuery(query: string, cancerType?: string | null, queryType?: string): string {
    const classifiedQueryType: string = queryType || QueryTypeClassifier.classify(query);
    const lowerQuery = query.toLowerCase();
    
    // Build rewritten query parts
    const parts: string[] = [query]; // Start with original query
    
    // Add cancer type if detected
    if (cancerType) {
      parts.push(cancerType);
    }
    
    // Add intent-specific enhancement terms
    switch (classifiedQueryType) {
      case "treatment":
        if (!lowerQuery.includes("treatment") && !lowerQuery.includes("therapy")) {
          parts.push("treatment options");
        }
        if (cancerType) {
          parts.push(`${cancerType} cancer treatment`);
        }
        break;
      case "screening":
        if (!lowerQuery.includes("screening") && !lowerQuery.includes("screen")) {
          parts.push("screening");
        }
        if (cancerType) {
          parts.push(`${cancerType} cancer screening`);
        }
        break;
      case "sideEffects":
        if (!lowerQuery.includes("side effect")) {
          parts.push("side effects");
        }
        if (cancerType) {
          parts.push(`${cancerType} cancer treatment side effects`);
        }
        break;
      case "symptoms":
        if (!lowerQuery.includes("symptom") && !lowerQuery.includes("sign")) {
          parts.push("symptoms");
          parts.push("warning signs");
        }
        // Always add "signs and symptoms" - this matches NCI PDQ exact phrasing
        parts.push("signs and symptoms");
        if (cancerType) {
          parts.push(`${cancerType} cancer symptoms`);
          parts.push(`${cancerType} cancer signs`);
          parts.push(`signs and symptoms of ${cancerType}`);
        }
        break;
      case "prevention":
        if (!lowerQuery.includes("prevent")) {
          parts.push("prevention");
        }
        if (cancerType) {
          parts.push(`${cancerType} cancer prevention`);
        }
        break;
      case "caregiver":
      case "navigation":
        // For caregiver/navigation queries, add cancer type context if available
        if (cancerType) {
          parts.push(`${cancerType} cancer`);
        }
        break;
      case "general":
        // For general queries, add cancer type context only
        // Avoid generic terms like "information" that can act as semantic noise
        if (cancerType) {
          parts.push(`${cancerType} cancer`);
        }
        break;
    }
    
    // Return rewritten query (join with space, remove duplicates)
    const rewritten = parts.join(" ");
    // Simple deduplication: split, filter unique words (case-insensitive), rejoin
    const words = rewritten.toLowerCase().split(/\s+/);
    const uniqueWords = Array.from(new Set(words));
    return uniqueWords.join(" ");
  }

  /**
   * Retrieve with expansion/retry when results are thin
   * Expands query with diagnostic/screening terms and retries if initial retrieval is insufficient
   * @param query Original query
   * @param topK Number of chunks to retrieve
   * @param cancerType Optional cancer type for targeted expansion
   * @param minChunks Minimum chunks required before considering expansion (default: 3)
   * @param maxRetries Maximum number of retry attempts (default: 2)
   */
  async retrieveWithExpansion(
    query: string,
    topK = 6,
    cancerType?: string | null,
    minChunks = 3,
    maxRetries = 2,
    queryType?: string
  ): Promise<EvidenceChunk[]> {
    // First attempt: original query
    let results = await this.retrieveWithMetadata(query, topK, cancerType, queryType);
    
    // If we have enough chunks, return
    if (results.length >= minChunks) {
      return results;
    }

    this.logger.debug(`Initial retrieval returned ${results.length} chunks, attempting expansion...`);

    // Expansion attempts
    const expansionTerms = [
      // General diagnostic terms
      "diagnosis",
      "diagnostic tests",
      "how is it diagnosed",
      "screening",
      "detection",
      "diagnostic methods"
    ];

    // Cancer-type-specific terms if provided
    if (cancerType) {
      expansionTerms.push(
        `${cancerType} cancer diagnosis`,
        `${cancerType} cancer tests`,
        `${cancerType} cancer screening`,
        `how is ${cancerType} cancer diagnosed`
      );
    }

    // Try expanded queries
    for (let attempt = 0; attempt < maxRetries && results.length < minChunks; attempt++) {
      const expansionTerm = expansionTerms[attempt % expansionTerms.length];
      const expandedQuery = `${query} ${expansionTerm}`;
      
      this.logger.debug(`Retry attempt ${attempt + 1}: expanding query with "${expansionTerm}"`);
      
      const expandedResults = await this.retrieveWithMetadata(expandedQuery, topK, cancerType, queryType);
      
      // Merge results, avoiding duplicates
      const existingKeys = new Set(results.map(r => `${r.docId}:${r.chunkId}`));
      const newResults = expandedResults.filter(r => !existingKeys.has(`${r.docId}:${r.chunkId}`));
      
      results = [...results, ...newResults].slice(0, topK);
      
      if (results.length >= minChunks) {
        this.logger.debug(`Expansion successful: now have ${results.length} chunks`);
        break;
      }
    }

    return results;
  }

  /**
   * Legacy method for backward compatibility
   */
  async retrieve(query: string, topK = 6): Promise<Array<{ docId: string; chunkId: string; content: string }>> {
    try {
      // Expand query with synonyms if available
      const expandedTerms = this.synonyms.expandQuery(query);
      if (expandedTerms.length > 1) {
        this.logger.debug(`Query expanded from "${query}" to ${expandedTerms.length} terms`);
      }

      // Try vector search first (with original query for semantic similarity)
      const vectorResults = await this.vectorSearch(query, topK);
      if (vectorResults.length > 0) {
        return vectorResults;
      }
      
      // Fallback to keyword search (use expanded terms for better recall)
      this.logger.warn("No vector embeddings found, falling back to keyword search");
      const results = await this.keywordSearchWithMetadata(expandedTerms.join(" "), topK);
      return results.map(r => ({ docId: r.docId, chunkId: r.chunkId, content: r.content }));
    } catch (error) {
      this.logger.error(`Error in RAG retrieval: ${error.message}`, error.stack);
      // Fallback to keyword search on error
      const results = await this.keywordSearchWithMetadata(query, topK);
      return results.map(r => ({ docId: r.docId, chunkId: r.chunkId, content: r.content }));
    }
  }

  private async vectorSearchWithMetadata(query: string, topK: number): Promise<EvidenceChunk[]> {
    // Generate query embedding
    const queryEmbedding = await this.embeddings.generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    // Use raw SQL for pgvector similarity search with document metadata
    // Cosine distance: <=> operator (smaller is more similar)
    // Retrieve more than topK to allow reranking
    const retrieveCount = Math.max(topK * 2, 20); // Retrieve 2x for reranking buffer
    
    const results = await this.prisma.$queryRaw<Array<{
      id: string;
      docId: string;
      content: string;
      distance: number;
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
        1 - (c.embedding <=> ${embeddingStr}::vector) AS distance,
        d.title,
        d.url,
        d."sourceType",
        d.source,
        d.citation,
        d."lastReviewed",
        d."isTrustedSource"
      FROM "KbChunk" c
      INNER JOIN "KbDocument" d ON c."docId" = d.id
      WHERE d.status = 'active'
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${embeddingStr}::vector
      LIMIT ${retrieveCount}
    `;

    const chunks = results.map((r) => ({
      chunkId: r.id,
      docId: r.docId,
      content: r.content,
      similarity: r.distance,
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

    // Apply trusted-source reranking
    const reranked = this.rerankByTrustedSource(chunks, query);
    
    // Return topK after reranking
    return reranked.slice(0, topK);
  }

  private async vectorSearch(query: string, topK: number): Promise<Array<{ docId: string; chunkId: string; content: string }>> {
    const results = await this.vectorSearchWithMetadata(query, topK);
    return results.map(r => ({ docId: r.docId, chunkId: r.chunkId, content: r.content }));
  }

  /**
   * Full-text search using Postgres tsvector
   * Returns chunks with lexical ranking scores normalized 0-1
   */
  private async fullTextSearchWithMetadata(
    query: string, 
    topK: number
  ): Promise<EvidenceChunk[]> {
    try {
      // Use websearch_to_tsquery for better query parsing (handles phrases, AND/OR, etc.)
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
      const maxLexRank = Math.max(...results.map(r => r.lexRank), 0.01);

      return results.map(r => ({
        chunkId: r.id,
        docId: r.docId,
        content: r.content,
        similarity: r.lexRank / maxLexRank, // Normalized lexical similarity (0-1)
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
    } catch (error) {
      this.logger.error(`Full-text search error: ${error.message}`, error.stack);
      return [];
    }
  }

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
      this.logger.warn("Both vector and FTS returned no results");
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

    // Calculate hybrid scores: 0.55 * vecSim + 0.45 * lexSim
    const scored = Array.from(chunkMap.values()).map(item => ({
      chunk: item.chunk,
      finalScore: 0.55 * item.vecSim + 0.45 * item.lexSim,
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

    this.logger.debug(
      `Hybrid search: ${vectorChunks.length} vector + ${ftsChunks.length} FTS = ${chunkMap.size} unique chunks, returning top ${topK}`
    );

    // Log top-K metadata for debugging
    const top3Trusted = reranked.slice(0, 3).filter(c => 
      c.document.isTrustedSource || isTrustedSource(c.document.sourceType || '')
    ).length;

    this.logger.log({
      event: 'hybrid_retrieval',
      query: query.substring(0, 50),
      vectorCount: vectorChunks.length,
      ftsCount: ftsChunks.length,
      mergedCount: chunkMap.size,
      top3TrustedCount: top3Trusted,
      topScore: reranked[0]?.similarity || 0,
      top3SourceTypes: reranked.slice(0, 3).map(c => c.document.sourceType)
    });

    // Return top-K
    return reranked.slice(0, topK);
  }

  private async keywordSearchWithMetadata(query: string, topK: number): Promise<EvidenceChunk[]> {
    const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 4).slice(0, 8);
    if (!tokens.length) return [];

    // Retrieve more than topK to allow reranking
    const retrieveCount = Math.max(topK * 2, 20);

    const chunks = await this.prisma.kbChunk.findMany({
      where: {
        document: { status: "active" },
        OR: tokens.map((t) => ({ content: { contains: t, mode: "insensitive" } }))
      },
      include: {
        document: {
          select: {
            title: true,
            url: true,
            sourceType: true,
            source: true,
            citation: true,
            lastReviewed: true,
            isTrustedSource: true
          }
        }
      },
      take: retrieveCount,
      orderBy: { createdAt: "desc" }
    });

    const mappedChunks = chunks.map((c) => ({
      chunkId: c.id,
      docId: c.docId,
      content: c.content,
      similarity: 0.5, // Default similarity for keyword search (no vector similarity available)
      document: {
        title: c.document.title,
        url: c.document.url || undefined,
        sourceType: c.document.sourceType,
        source: c.document.source,
        citation: c.document.citation,
        lastReviewed: c.document.lastReviewed || undefined,
        isTrustedSource: c.document.isTrustedSource
      }
    }));

    // Apply trusted-source reranking
    const reranked = this.rerankByTrustedSource(mappedChunks, query);
    
    // Return topK after reranking
    return reranked.slice(0, topK);
  }

  private async keywordSearch(query: string, topK: number): Promise<Array<{ docId: string; chunkId: string; content: string }>> {
    const results = await this.keywordSearchWithMetadata(query, topK);
    return results.map(r => ({ docId: r.docId, chunkId: r.chunkId, content: r.content }));
  }

  /**
   * Rerank chunks by trusted source priority while preserving similarity-based ordering
   * Deterministic: applies source multiplier/bonus to similarity score
   * - Trusted high priority: +0.15 boost
   * - Trusted medium priority: +0.10 boost
   * - Trusted low priority: +0.05 boost
   * - Unknown/untrusted: no boost
   * Tie-breaker: original order for stability
   */
  private rerankByTrustedSource(chunks: EvidenceChunk[], query: string): EvidenceChunk[] {
    const enableTrace = process.env.RAG_TRACE_RERANK === 'true';
    const beforeOrder = chunks.slice(0, 3).map(c => ({
      docId: c.docId,
      sourceType: c.document.sourceType,
      isTrusted: c.document.isTrustedSource || (c.document.sourceType ? isTrustedSource(c.document.sourceType) : false),
      similarity: c.similarity || 0
    }));

    // Calculate reranked scores
    const reranked = chunks.map((chunk, originalIndex) => {
      const similarity = chunk.similarity || 0;
      let rerankScore = similarity;
      
      const sourceType = chunk.document.sourceType;
      const isTrusted = chunk.document.isTrustedSource || (sourceType ? isTrustedSource(sourceType) : false);
      
      if (isTrusted && sourceType) {
        const config = getSourceConfig(sourceType);
        if (config) {
          // Apply priority-based multiplicative boost
          switch (config.priority) {
            case 'high':
              rerankScore = similarity * 1.50; // 50% boost (was +0.15)
              break;
            case 'medium':
              rerankScore = similarity * 1.25; // 25% boost (was +0.10)
              break;
            case 'low':
              rerankScore = similarity * 1.10; // 10% boost (was +0.05)
              break;
          }
        } else {
          // Trusted but no config (shouldn't happen, but safe fallback)
          rerankScore = similarity * 1.25;
        }
      } else {
        // Penalize untrusted sources slightly
        rerankScore = similarity * 0.95;
      }

      return {
        chunk,
        rerankScore,
        originalIndex,
        originalSimilarity: similarity,
        sourceType,
        isTrusted
      };
    });

    // Sort by rerank score (descending), then by original index for tie-breaking
    reranked.sort((a, b) => {
      if (Math.abs(a.rerankScore - b.rerankScore) > 0.001) {
        return b.rerankScore - a.rerankScore; // Higher score first
      }
      return a.originalIndex - b.originalIndex; // Stable tie-breaker
    });

    const afterOrder = reranked.slice(0, 3).map(r => ({
      docId: r.chunk.docId,
      sourceType: r.sourceType,
      isTrusted: r.isTrusted,
      similarity: r.originalSimilarity,
      rerankScore: r.rerankScore
    }));

    // Trace logging (behind env flag)
    if (enableTrace) {
      this.logger.log(`[RERANK] Query: "${query.substring(0, 50)}..."`);
      this.logger.log(`[RERANK] Before: ${JSON.stringify(beforeOrder)}`);
      this.logger.log(`[RERANK] After: ${JSON.stringify(afterOrder)}`);
      
      // Calculate deltas
      const deltas = afterOrder.map((after, idx) => {
        const before = beforeOrder[idx];
        if (!before) return { moved: 'new', docId: after.docId };
        if (before.docId !== after.docId) {
          return { 
            moved: 'changed', 
            from: before.docId, 
            to: after.docId,
            beforeTrusted: before.isTrusted,
            afterTrusted: after.isTrusted
          };
        }
        return { moved: 'same', docId: after.docId };
      });
      this.logger.log(`[RERANK] Deltas: ${JSON.stringify(deltas)}`);
    }

    return reranked.map(r => r.chunk);
  }
}
