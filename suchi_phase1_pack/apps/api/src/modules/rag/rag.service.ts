import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmbeddingsService } from "../embeddings/embeddings.service";
import { SynonymService } from "./synonym-service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";
import { isTrustedSource, getSourceConfig, TRUSTED_SOURCES } from "../../config/trusted-sources.config";
import { QueryTypeClassifier } from "./query-type.classifier";

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
    private readonly synonyms: SynonymService
  ) {}

  /**
   * Retrieve chunks with full document metadata for citations
   * @param query Original user query
   * @param topK Number of chunks to retrieve
   * @param cancerType Optional cancer type for query enhancement
   * @param queryType Optional pre-classified query type (to avoid re-classification)
   */
  async retrieveWithMetadata(query: string, topK = 6, cancerType?: string | null, queryType?: string): Promise<EvidenceChunk[]> {
    try {
      // Step 1: Query rewrite using QueryTypeClassifier + cancer terms
      const rewrittenQuery = this.rewriteQuery(query, cancerType, queryType);
      if (rewrittenQuery !== query) {
        this.logger.debug(`Query rewritten from "${query}" to "${rewrittenQuery}"`);
      }

      // Step 2: Expand query with synonyms if available
      const expandedTerms = this.synonyms.expandQuery(rewrittenQuery);
      if (expandedTerms.length > 1) {
        this.logger.debug(`Query expanded from "${rewrittenQuery}" to ${expandedTerms.length} terms`);
      }

      // Step 3: Try vector search with rewritten query
      const vectorResults = await this.vectorSearchWithMetadata(rewrittenQuery, topK);
      if (vectorResults.length > 0) {
        return vectorResults;
      }
      
      // Fallback to keyword search
      this.logger.warn("No vector embeddings found, falling back to keyword search");
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
        if (cancerType) {
          parts.push(`${cancerType} cancer symptoms`);
          parts.push(`${cancerType} cancer signs`);
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
          // Apply priority-based boost
          switch (config.priority) {
            case 'high':
              rerankScore = similarity + 0.15;
              break;
            case 'medium':
              rerankScore = similarity + 0.10;
              break;
            case 'low':
              rerankScore = similarity + 0.05;
              break;
          }
        } else {
          // Trusted but no config (shouldn't happen, but safe fallback)
          rerankScore = similarity + 0.10;
        }
      }
      // Untrusted/unknown sources get no boost

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
