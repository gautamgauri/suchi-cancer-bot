import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

/**
 * Cross-encoder reranking service using Cohere Rerank API
 * Significantly improves precision by semantically comparing query-document pairs
 *
 * Flow: After hybrid retrieval returns ~20 candidates, rerank to get top-K most relevant
 */
@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>("COHERE_API_KEY");
    this.model = this.configService.get<string>("COHERE_RERANK_MODEL") || "rerank-english-v3.0";
    this.enabled = this.configService.get<string>("ENABLE_RERANKER") === "true";

    if (this.enabled && !this.apiKey) {
      this.logger.warn("ENABLE_RERANKER is true but COHERE_API_KEY is not set - reranking disabled");
    }
  }

  /**
   * Check if reranking is available and enabled
   */
  isEnabled(): boolean {
    return this.enabled && !!this.apiKey;
  }

  /**
   * Rerank chunks using Cohere's cross-encoder model
   * Returns chunks reordered by semantic relevance to the query
   *
   * Cost: ~$2 per 1,000 searches (1 search = query + up to 100 docs)
   * Our typical usage: 18 candidates = 1 search unit per query
   *
   * @param query Original user query
   * @param chunks Chunks to rerank (typically 15-30 candidates from hybrid search)
   * @param topK Number of chunks to return after reranking
   */
  async rerank(
    query: string,
    chunks: EvidenceChunk[],
    topK: number = 6
  ): Promise<EvidenceChunk[]> {
    if (!this.isEnabled()) {
      return chunks.slice(0, topK);
    }

    if (chunks.length === 0) {
      return [];
    }

    // Don't rerank if we have fewer chunks than topK
    if (chunks.length <= topK) {
      return chunks;
    }

    try {
      const startTime = Date.now();

      // Prepare documents for Cohere API
      const documents = chunks.map(chunk => chunk.content);

      const response = await fetch("https://api.cohere.ai/v1/rerank", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents,
          top_n: topK,
          return_documents: false // We already have the documents
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Cohere rerank API error: ${response.status} - ${errorText}`);
        // Graceful fallback: return original chunks
        return chunks.slice(0, topK);
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      // Map results back to chunks using index
      const rerankedChunks: EvidenceChunk[] = data.results.map((result: { index: number; relevance_score: number }) => {
        const chunk = chunks[result.index];
        return {
          ...chunk,
          // Store original similarity and add rerank score for logging/debugging
          similarity: result.relevance_score, // Cohere score is 0-1
          _originalSimilarity: chunk.similarity
        };
      });

      // Cost tracking: 1 search unit = query + up to 100 docs
      const searchUnits = Math.ceil(chunks.length / 100);
      const estimatedCost = searchUnits * 0.002; // $2 per 1000 searches

      this.logger.log({
        event: 'cross_encoder_rerank',
        query: query.substring(0, 50),
        inputCount: chunks.length,
        outputCount: rerankedChunks.length,
        latencyMs,
        topScore: rerankedChunks[0]?.similarity || 0,
        model: this.model,
        searchUnits,
        estimatedCostUsd: estimatedCost.toFixed(4)
      });

      return rerankedChunks;
    } catch (error) {
      this.logger.error(`Reranker error: ${error.message}`, error.stack);
      // Graceful fallback: return original chunks
      return chunks.slice(0, topK);
    }
  }

  /**
   * Rerank with retry on transient errors
   */
  async rerankWithRetry(
    query: string,
    chunks: EvidenceChunk[],
    topK: number = 6,
    maxRetries: number = 2
  ): Promise<EvidenceChunk[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.rerank(query, chunks, topK);
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms
          const delay = 100 * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.warn(`Reranker failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
    return chunks.slice(0, topK);
  }
}
