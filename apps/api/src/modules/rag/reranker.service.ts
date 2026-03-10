import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

type RerankerProvider = 'voyage' | 'cohere' | 'jina' | 'none';

/**
 * Extended chunk with pre-trust-boost scores for gating decisions
 */
export interface ScoredChunk extends EvidenceChunk {
  vecSim?: number;  // Raw vector similarity (0-1)
  lexSim?: number;  // Raw lexical/FTS similarity (0-1)
}

/**
 * Gating decision result
 */
interface GatingDecision {
  shouldRerank: boolean;
  reason: string;
  scores: {
    h1: number; h3: number; h6: number;
    v1: number; l1: number;
    gap3: number; gap6: number;
  };
}

/**
 * Cross-encoder reranking service with multiple provider support
 *
 * Providers (in order of cost-effectiveness):
 * 1. Voyage: $0.05/1M tokens (~$0.54/1k queries) - RECOMMENDED
 * 2. Jina: 10M free tokens, then paid - good for multilingual
 * 3. Cohere: $2/1k searches - highest quality, higher cost
 *
 * Config:
 *   RERANKER_PROVIDER=voyage|cohere|jina|none
 *   VOYAGE_API_KEY=... (for voyage)
 *   COHERE_API_KEY=... (for cohere)
 *   JINA_API_KEY=... (for jina)
 */
@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly provider: RerankerProvider;
  private readonly voyageApiKey: string | undefined;
  private readonly cohereApiKey: string | undefined;
  private readonly jinaApiKey: string | undefined;
  private readonly RERANK_TIMEOUT_MS = 8000; // 8 second timeout for reranking

  constructor(private readonly configService: ConfigService) {
    this.voyageApiKey = this.configService.get<string>("VOYAGE_API_KEY");
    this.cohereApiKey = this.configService.get<string>("COHERE_API_KEY");
    this.jinaApiKey = this.configService.get<string>("JINA_API_KEY");

    // Determine provider from config or auto-detect from available keys
    const configuredProvider = this.configService.get<string>("RERANKER_PROVIDER")?.toLowerCase();

    if (configuredProvider === 'none' || configuredProvider === 'disabled') {
      this.provider = 'none';
    } else if (configuredProvider === 'voyage' && this.voyageApiKey) {
      this.provider = 'voyage';
    } else if (configuredProvider === 'cohere' && this.cohereApiKey) {
      this.provider = 'cohere';
    } else if (configuredProvider === 'jina' && this.jinaApiKey) {
      this.provider = 'jina';
    } else if (this.voyageApiKey) {
      // Auto-detect: prefer Voyage (cheapest)
      this.provider = 'voyage';
    } else if (this.jinaApiKey) {
      this.provider = 'jina';
    } else if (this.cohereApiKey) {
      this.provider = 'cohere';
    } else {
      this.provider = 'none';
    }

    if (this.provider !== 'none') {
      this.logger.log(`Reranker initialized with provider: ${this.provider}`);
    } else {
      this.logger.warn('No reranker API key configured - reranking disabled');
    }
  }

  isEnabled(): boolean {
    return this.provider !== 'none';
  }

  getProvider(): string {
    return this.provider;
  }

  // ============= INTENT-BASED GATING =============

  // Always rerank these high-stakes intents
  private readonly ALWAYS_RERANK_INTENTS = new Set([
    'RED_FLAG_URGENT',
    'SYMPTOMATIC_PATIENT',
    'POST_DIAGNOSIS_OR_SUSPECTED',
  ]);

  // Usually skip these low-stakes intents
  private readonly LOW_STAKES_INTENTS = new Set([
    'GREETING',
    'CLARIFICATION',
  ]);

  /**
   * Determine if reranking should be applied based on scores and intent
   * Gate on PRE-trust-boost scores to avoid masking ambiguity
   *
   * @param chunks Chunks with vecSim/lexSim scores (pre-trust-boost)
   * @param intent User intent type
   */
  shouldRerank(chunks: ScoredChunk[], intent?: string): GatingDecision {
    // Extract top-6 scores (use hybrid similarity, but also capture vec/lex)
    const top6 = chunks.slice(0, 6);
    const h1 = top6[0]?.similarity || 0;
    const h3 = top6[2]?.similarity || 0;
    const h6 = top6[5]?.similarity || 0;
    const v1 = top6[0]?.vecSim ?? h1;  // Fallback to hybrid if not available
    const l1 = top6[0]?.lexSim ?? 0;
    const gap3 = h1 - h3;
    const gap6 = h1 - h6;

    const scores = { h1, h3, h6, v1, l1, gap3, gap6 };

    // === ALWAYS RERANK: High-stakes intents ===
    if (intent && this.ALWAYS_RERANK_INTENTS.has(intent)) {
      return { shouldRerank: true, reason: `high_stakes_intent:${intent}`, scores };
    }

    // === SKIP FAST-PATH: Exact match / slam dunk ===
    // Strong lexical match + clear separation + strong overall + semantic support
    if (l1 >= 0.85 && (gap3 >= 0.12 || gap6 >= 0.18) && h1 >= 0.75 && v1 >= 0.72) {
      return { shouldRerank: false, reason: 'exact_match_slam_dunk', scores };
    }

    // === LOW-STAKES INTENTS: Usually skip ===
    if (intent && this.LOW_STAKES_INTENTS.has(intent)) {
      // Only rerank if retrieval looks weak
      if (h1 < 0.55 && l1 < 0.40) {
        return { shouldRerank: true, reason: 'low_intent_weak_retrieval', scores };
      }
      return { shouldRerank: false, reason: `low_stakes_intent:${intent}`, scores };
    }

    // === MEDIUM INTENTS (CAREGIVER, INFORMATIONAL_GENERAL, etc.) ===
    // Rerank if any trigger fires:

    // Trigger A: Score ambiguity (most important)
    if (gap6 <= 0.07 || gap3 <= 0.04) {
      return { shouldRerank: true, reason: 'score_ambiguity', scores };
    }

    // Trigger B: Not strong enough top result
    if (h1 < 0.62) {
      return { shouldRerank: true, reason: 'weak_top_result', scores };
    }

    // Trigger C: Semantic-heavy query (lexical weak)
    if (l1 < 0.45) {
      return { shouldRerank: true, reason: 'low_lexical_match', scores };
    }

    // Trigger D: Near-duplicate clustering (all scores very close)
    if (gap6 <= 0.05) {
      return { shouldRerank: true, reason: 'clustered_results', scores };
    }

    // Default: Skip rerank (good separation, strong results)
    return { shouldRerank: false, reason: 'good_separation', scores };
  }

  /**
   * Rerank chunks using configured provider with intent-based gating
   */
  async rerank(
    query: string,
    chunks: ScoredChunk[],
    topK: number = 6,
    intent?: string
  ): Promise<EvidenceChunk[]> {
    if (!this.isEnabled()) {
      return chunks.slice(0, topK);
    }

    if (chunks.length === 0) {
      return [];
    }

    if (chunks.length <= topK) {
      return chunks;
    }

    // Apply gating logic
    const gating = this.shouldRerank(chunks, intent);

    if (!gating.shouldRerank) {
      this.logger.log({
        event: 'rerank_skipped',
        reason: gating.reason,
        intent,
        ...gating.scores
      });
      return chunks.slice(0, topK);
    }

    this.logger.debug({
      event: 'rerank_triggered',
      reason: gating.reason,
      intent,
      ...gating.scores
    });

    switch (this.provider) {
      case 'voyage':
        return this.rerankWithVoyage(query, chunks, topK);
      case 'cohere':
        return this.rerankWithCohere(query, chunks, topK);
      case 'jina':
        return this.rerankWithJina(query, chunks, topK);
      default:
        return chunks.slice(0, topK);
    }
  }

  /**
   * Voyage Rerank - RECOMMENDED (cheapest at ~$0.05/1M tokens)
   * https://docs.voyageai.com/reference/reranker-api
   */
  private async rerankWithVoyage(
    query: string,
    chunks: EvidenceChunk[],
    topK: number
  ): Promise<EvidenceChunk[]> {
    try {
      const startTime = Date.now();

      // Truncate docs to ~400 tokens to control costs
      const MAX_CHARS = 1600;
      const documents = chunks.map(chunk =>
        chunk.content.length > MAX_CHARS
          ? chunk.content.substring(0, MAX_CHARS) + '...'
          : chunk.content
      );

      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.RERANK_TIMEOUT_MS);

      const response = await fetch("https://api.voyageai.com/v1/rerank", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.voyageApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "rerank-2",  // Voyage's latest reranker
          query,
          documents,
          top_k: topK,
          return_documents: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Voyage rerank error: ${response.status} - ${errorText}`);
        return chunks.slice(0, topK);
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      // Estimate token usage for cost tracking
      const estimatedTokens = documents.reduce((sum, d) => sum + Math.ceil(d.length / 4), 0) + query.length / 4;
      const estimatedCost = (estimatedTokens / 1_000_000) * 0.05;

      const rerankedChunks = data.data.map((result: { index: number; relevance_score: number }) => ({
        ...chunks[result.index],
        similarity: result.relevance_score
      }));

      this.logger.log({
        event: 'rerank_voyage',
        query: query.substring(0, 50),
        inputCount: chunks.length,
        outputCount: rerankedChunks.length,
        latencyMs,
        estimatedTokens: Math.round(estimatedTokens),
        estimatedCostUsd: estimatedCost.toFixed(6)
      });

      return rerankedChunks;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.warn(`Voyage rerank timeout after ${this.RERANK_TIMEOUT_MS}ms - falling back to unsorted`);
      } else {
        this.logger.error(`Voyage rerank error: ${error.message}`, error.stack);
      }
      return chunks.slice(0, topK);
    }
  }

  /**
   * Cohere Rerank - High quality, $2/1k searches
   */
  private async rerankWithCohere(
    query: string,
    chunks: EvidenceChunk[],
    topK: number
  ): Promise<EvidenceChunk[]> {
    try {
      const startTime = Date.now();

      const MAX_CHARS = 1600;
      const documents = chunks.map(chunk =>
        chunk.content.length > MAX_CHARS
          ? chunk.content.substring(0, MAX_CHARS) + '...'
          : chunk.content
      );

      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.RERANK_TIMEOUT_MS);

      const response = await fetch("https://api.cohere.ai/v1/rerank", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.cohereApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "rerank-english-v3.0",
          query,
          documents,
          top_n: topK,
          return_documents: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Cohere rerank error: ${response.status} - ${errorText}`);
        return chunks.slice(0, topK);
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      const searchUnits = Math.ceil(chunks.length / 100);
      const estimatedCost = searchUnits * 0.002;

      const rerankedChunks = data.results.map((result: { index: number; relevance_score: number }) => ({
        ...chunks[result.index],
        similarity: result.relevance_score
      }));

      this.logger.log({
        event: 'rerank_cohere',
        query: query.substring(0, 50),
        inputCount: chunks.length,
        outputCount: rerankedChunks.length,
        latencyMs,
        searchUnits,
        estimatedCostUsd: estimatedCost.toFixed(4)
      });

      return rerankedChunks;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.warn(`Cohere rerank timeout after ${this.RERANK_TIMEOUT_MS}ms - falling back to unsorted`);
      } else {
        this.logger.error(`Cohere rerank error: ${error.message}`, error.stack);
      }
      return chunks.slice(0, topK);
    }
  }

  /**
   * Jina Rerank - Good for multilingual, 10M free tokens
   * https://jina.ai/reranker/
   */
  private async rerankWithJina(
    query: string,
    chunks: EvidenceChunk[],
    topK: number
  ): Promise<EvidenceChunk[]> {
    try {
      const startTime = Date.now();

      const MAX_CHARS = 1600;
      const documents = chunks.map(chunk =>
        chunk.content.length > MAX_CHARS
          ? chunk.content.substring(0, MAX_CHARS) + '...'
          : chunk.content
      );

      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.RERANK_TIMEOUT_MS);

      const response = await fetch("https://api.jina.ai/v1/rerank", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.jinaApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "jina-reranker-v2-base-multilingual",
          query,
          documents,
          top_n: topK
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Jina rerank error: ${response.status} - ${errorText}`);
        return chunks.slice(0, topK);
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      const rerankedChunks = data.results.map((result: { index: number; relevance_score: number }) => ({
        ...chunks[result.index],
        similarity: result.relevance_score
      }));

      this.logger.log({
        event: 'rerank_jina',
        query: query.substring(0, 50),
        inputCount: chunks.length,
        outputCount: rerankedChunks.length,
        latencyMs
      });

      return rerankedChunks;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.warn(`Jina rerank timeout after ${this.RERANK_TIMEOUT_MS}ms - falling back to unsorted`);
      } else {
        this.logger.error(`Jina rerank error: ${error.message}`, error.stack);
      }
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
          const delay = 100 * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.warn(`Reranker failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
    return chunks.slice(0, topK);
  }
}
