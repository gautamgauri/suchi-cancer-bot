/**
 * Cross-encoder reranker for Funding Bot evidence retrieval.
 * Ported from Suchi Cancer Bot's reranker.service.ts with section-type gating
 * instead of intent-based gating.
 *
 * Provider priority: Voyage AI → Jina → disabled (graceful degradation).
 * Cost: ~$0.002 per proposal (10 sections × 20 chunks × ~400 tokens).
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RetrievalChunkDto } from "./retrieval.service";

// --- Section-type gating ---

/** High-evidence sections where reranking precision is critical */
const ALWAYS_RERANK_SECTIONS = new Set([
  "budget",
  "objectives",
  "monitoring",
  "results",
  "need",
]);

/** Narrative-heavy sections where raw vector order is usually fine */
const SKIP_RERANK_SECTIONS = new Set([
  "team",
  "sustainability",
  "communication",
  "cover_letter",
  "experience",
]);

// Sections not in either set use conditional gating (score ambiguity check)

// --- Provider types ---

type RerankerProvider = "voyage" | "jina" | "none";

interface RerankResult {
  chunks: RetrievalChunkDto[];
  reranked: boolean;
  provider: RerankerProvider;
  latencyMs: number;
  reason: string;
}

interface ProviderConfig {
  apiKey: string;
  model: string;
  endpoint: string;
  costPer1MTokens: number;
}

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly provider: RerankerProvider;
  private readonly providerConfig: ProviderConfig | null;
  private readonly timeout: number;

  constructor(private readonly configService: ConfigService) {
    this.timeout = 8000; // 8s timeout per rerank request

    // Auto-detect provider from available API keys
    const voyageKey = this.configService.get<string>("VOYAGE_API_KEY");
    const jinaKey = this.configService.get<string>("JINA_API_KEY");

    if (voyageKey) {
      this.provider = "voyage";
      this.providerConfig = {
        apiKey: voyageKey,
        model: this.configService.get<string>("VOYAGE_RERANK_MODEL") || "rerank-2",
        endpoint: "https://api.voyageai.com/v1/rerank",
        costPer1MTokens: 0.05,
      };
      this.logger.log("Reranker: Voyage AI enabled");
    } else if (jinaKey) {
      this.provider = "jina";
      this.providerConfig = {
        apiKey: jinaKey,
        model: this.configService.get<string>("JINA_RERANK_MODEL") || "jina-reranker-v2-base-multilingual",
        endpoint: "https://api.jina.ai/v1/rerank",
        costPer1MTokens: 0.02,
      };
      this.logger.log("Reranker: Jina AI enabled");
    } else {
      this.provider = "none";
      this.providerConfig = null;
      this.logger.warn("Reranker: no API key found (VOYAGE_API_KEY or JINA_API_KEY). Reranking disabled.");
    }
  }

  /**
   * Conditionally rerank chunks based on section type and score distribution.
   * Returns the same chunks (possibly reordered) with updated scores.
   */
  async rerank(
    query: string,
    chunks: RetrievalChunkDto[],
    sectionName: string,
  ): Promise<RerankResult> {
    if (this.provider === "none" || !this.providerConfig) {
      return { chunks, reranked: false, provider: "none", latencyMs: 0, reason: "no_provider" };
    }

    if (chunks.length <= 1) {
      return { chunks, reranked: false, provider: this.provider, latencyMs: 0, reason: "too_few_chunks" };
    }

    // Section-type gating decision
    const sectionLower = this.normalizeSectionName(sectionName);
    const gatingDecision = this.shouldRerank(sectionLower, chunks);

    if (!gatingDecision.shouldRerank) {
      return {
        chunks,
        reranked: false,
        provider: this.provider,
        latencyMs: 0,
        reason: gatingDecision.reason,
      };
    }

    // Execute reranking
    const startMs = Date.now();
    try {
      const rerankedChunks = await this.callReranker(query, chunks);
      const latencyMs = Date.now() - startMs;

      this.logger.log({
        message: "Rerank complete",
        section: sectionName,
        provider: this.provider,
        chunksIn: chunks.length,
        latencyMs,
        reason: gatingDecision.reason,
        topScoreBefore: chunks[0]?.score?.toFixed(3),
        topScoreAfter: rerankedChunks[0]?.score?.toFixed(3),
      });

      return {
        chunks: rerankedChunks,
        reranked: true,
        provider: this.provider,
        latencyMs,
        reason: gatingDecision.reason,
      };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      this.logger.error(`Rerank failed (${this.provider}): ${(err as Error).message}`);
      // Graceful degradation: return original order on failure
      return {
        chunks,
        reranked: false,
        provider: this.provider,
        latencyMs,
        reason: `error: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Gating logic: decide whether to rerank based on section type and score distribution.
   */
  private shouldRerank(
    sectionLower: string,
    chunks: RetrievalChunkDto[],
  ): { shouldRerank: boolean; reason: string } {
    // Always rerank high-evidence sections
    if (ALWAYS_RERANK_SECTIONS.has(sectionLower)) {
      return { shouldRerank: true, reason: `always_rerank:${sectionLower}` };
    }

    // Skip narrative-heavy sections
    if (SKIP_RERANK_SECTIONS.has(sectionLower)) {
      return { shouldRerank: false, reason: `skip_section:${sectionLower}` };
    }

    // Conditional: check score distribution for ambiguity
    const scores = chunks.map((c) => c.score ?? 0).sort((a, b) => b - a);
    const h1 = scores[0] ?? 0;
    const gap3 = scores.length >= 3 ? scores[0] - scores[2] : 1;
    const gap6 = scores.length >= 6 ? scores[0] - scores[5] : 1;

    // Score ambiguity: tight clustering suggests reranking would help
    if (gap3 <= 0.04 || gap6 <= 0.07) {
      return { shouldRerank: true, reason: `score_ambiguity:gap3=${gap3.toFixed(3)},gap6=${gap6.toFixed(3)}` };
    }

    // Weak top result: rerank to potentially surface better candidates
    if (h1 < 0.50) {
      return { shouldRerank: true, reason: `weak_top:h1=${h1.toFixed(3)}` };
    }

    // Clear separation: no need to rerank
    return { shouldRerank: false, reason: `clear_separation:h1=${h1.toFixed(3)},gap3=${gap3.toFixed(3)}` };
  }

  /**
   * Normalize section name to match gating sets.
   */
  private normalizeSectionName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes("budget") || lower.includes("financial")) return "budget";
    if (lower.includes("objective") || lower.includes("goal")) return "objectives";
    if (lower.includes("monitor") || lower.includes("evaluat") || lower.includes("m&e")) return "monitoring";
    if (lower.includes("result") || lower.includes("outcome") || lower.includes("impact") || lower.includes("expected")) return "results";
    if (lower.includes("need") || lower.includes("problem") || lower.includes("rationale") || lower.includes("context") || lower.includes("background")) return "need";
    if (lower.includes("team") || lower.includes("staff") || lower.includes("personnel")) return "team";
    if (lower.includes("sustainab") || lower.includes("exit")) return "sustainability";
    if (lower.includes("communicat") || lower.includes("disseminat")) return "communication";
    if (lower.includes("experience") || lower.includes("track record")) return "experience";
    if (lower.includes("cover") && lower.includes("letter")) return "cover_letter";
    // Default: use conditional gating
    return lower;
  }

  /**
   * Call the reranker API (Voyage or Jina) with timeout.
   */
  private async callReranker(
    query: string,
    chunks: RetrievalChunkDto[],
  ): Promise<RetrievalChunkDto[]> {
    const config = this.providerConfig!;

    const documents = chunks.map((c) => c.text.slice(0, 4000)); // Truncate to control costs

    const body: Record<string, unknown> = {
      model: config.model,
      query,
      documents,
    };

    // Jina uses 'documents' key, Voyage uses 'documents' too — both compatible
    if (this.provider === "voyage") {
      body.top_k = chunks.length; // Return all, just reordered
    } else if (this.provider === "jina") {
      body.top_n = chunks.length;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown");
        throw new Error(`Reranker API ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as {
        results?: Array<{ index: number; relevance_score: number }>;
        data?: Array<{ index: number; relevance_score: number }>;
      };

      // Voyage returns { results: [...] }, Jina returns { results: [...] }
      const results = data.results || data.data || [];

      // Map back to chunks with reranker scores
      const reranked = results
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .map((r) => ({
          ...chunks[r.index],
          score: r.relevance_score,
        }));

      return reranked;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
