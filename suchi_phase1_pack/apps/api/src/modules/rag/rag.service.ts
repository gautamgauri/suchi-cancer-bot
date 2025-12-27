import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmbeddingsService } from "../embeddings/embeddings.service";
import { SynonymService } from "./synonym-service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

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
   */
  async retrieveWithMetadata(query: string, topK = 6): Promise<EvidenceChunk[]> {
    try {
      // Expand query with synonyms if available
      const expandedTerms = this.synonyms.expandQuery(query);
      if (expandedTerms.length > 1) {
        this.logger.debug(`Query expanded from "${query}" to ${expandedTerms.length} terms`);
      }

      // Try vector search first
      const vectorResults = await this.vectorSearchWithMetadata(query, topK);
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
      LIMIT ${topK}
    `;

    return results.map((r) => ({
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
  }

  private async vectorSearch(query: string, topK: number): Promise<Array<{ docId: string; chunkId: string; content: string }>> {
    const results = await this.vectorSearchWithMetadata(query, topK);
    return results.map(r => ({ docId: r.docId, chunkId: r.chunkId, content: r.content }));
  }

  private async keywordSearchWithMetadata(query: string, topK: number): Promise<EvidenceChunk[]> {
    const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 4).slice(0, 8);
    if (!tokens.length) return [];

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
      take: topK,
      orderBy: { createdAt: "desc" }
    });

    return chunks.map((c) => ({
      chunkId: c.id,
      docId: c.docId,
      content: c.content,
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
  }

  private async keywordSearch(query: string, topK: number): Promise<Array<{ docId: string; chunkId: string; content: string }>> {
    const results = await this.keywordSearchWithMetadata(query, topK);
    return results.map(r => ({ docId: r.docId, chunkId: r.chunkId, content: r.content }));
  }
}
