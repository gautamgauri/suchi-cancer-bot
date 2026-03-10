/**
 * Retrieval Tool — Phase 2: Retrieval as a Callable Tool
 *
 * Wraps the existing RagService into a tool interface that can be
 * called multiple times by the Planner with different queries and
 * intent parameters. This is the key upgrade from "retrieval as a
 * phase" to "retrieval as a tool".
 *
 * Design:
 *  - retrieve() is a stateless function that takes explicit params
 *  - The Planner decides HOW MANY calls to make and with WHAT params
 *  - Results from multiple calls are merged and deduplicated
 *  - Source filtering constrains results to specific corpus segments
 *  - Zero new LLM cost: uses existing RagService + embeddings
 */

import { Injectable, Logger } from "@nestjs/common";
import { RagService } from "./rag.service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";
import { AgenticCategory } from "../chat/agentic-intent-router";

// ─── Types ────────────────────────────────────────────────────────

export interface RetrievalToolParams {
  /** The search query (can differ from original user text) */
  query: string;
  /** The intent of this specific retrieval call */
  intent: RetrievalIntent;
  /** Optional: restrict to specific source types */
  sourceFilter?: string[];
  /** Number of chunks to retrieve (default: 5) */
  topK?: number;
  /** Optional: cancer type for query enhancement */
  cancerType?: string | null;
}

export type RetrievalIntent =
  | "navigation"    // Hospital, doctor, care pathway
  | "schemes"       // Government schemes, financial help
  | "checklist"     // Documents, preparation steps
  | "education"     // General cancer info
  | "psychosocial"  // Emotional support content
  | "treatment"     // Treatment information
  | "symptoms"      // Symptom information
  | "side_effects"; // Side effect information

export interface RetrievalToolResult {
  /** The retrieved chunks */
  chunks: EvidenceChunk[];
  /** The query used for this retrieval */
  query: string;
  /** The intent parameter used */
  intent: RetrievalIntent;
  /** Number of chunks returned */
  count: number;
  /** Latency in ms */
  latencyMs: number;
}

export interface MultiRetrievalResult {
  /** All retrieved chunks, merged and deduplicated */
  mergedChunks: EvidenceChunk[];
  /** Per-call results for observability */
  callResults: RetrievalToolResult[];
  /** Total retrieval calls made */
  totalCalls: number;
  /** Total latency (wall clock, parallel calls counted once) */
  totalLatencyMs: number;
}

// ─── Intent → Source Type mapping ────────────────────────────────

const INTENT_SOURCE_PREFERENCES: Record<RetrievalIntent, string[]> = {
  navigation: ["99_local_navigation", "05_india_ncg", "01_suchi_oncotalks"],
  schemes: ["99_local_navigation", "05_india_ncg"],
  checklist: ["99_local_navigation", "01_suchi_oncotalks", "02_nci_core"],
  education: ["02_nci_core", "01_suchi_oncotalks", "03_who_public_health"],
  psychosocial: ["01_suchi_oncotalks", "02_nci_core"],
  treatment: ["02_nci_core", "05_india_ncg", "01_suchi_oncotalks"],
  symptoms: ["02_nci_core", "01_suchi_oncotalks", "03_who_public_health"],
  side_effects: ["02_nci_core", "01_suchi_oncotalks"],
};

// ─── Intent → Query enhancement terms ────────────────────────────

const INTENT_QUERY_ENHANCEMENTS: Record<RetrievalIntent, string[]> = {
  navigation: ["hospital", "cancer center", "oncologist", "treatment facility"],
  schemes: ["government scheme", "Ayushman Bharat", "PMJAY", "financial assistance", "eligibility"],
  checklist: ["documents needed", "what to bring", "preparation", "checklist", "steps"],
  education: [],  // Don't add noise to educational queries
  psychosocial: ["emotional support", "coping", "counselor", "mental health"],
  treatment: ["treatment options", "therapy", "standard of care"],
  symptoms: ["signs and symptoms", "warning signs"],
  side_effects: ["side effects", "adverse effects", "treatment complications"],
};

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class RetrievalToolService {
  private readonly logger = new Logger(RetrievalToolService.name);

  constructor(private readonly ragService: RagService) {}

  /**
   * Single retrieval call — the core tool.
   * Can be called N times by the Planner with different params.
   */
  async retrieve(params: RetrievalToolParams): Promise<RetrievalToolResult> {
    const started = Date.now();
    const topK = params.topK ?? 5;

    // Enhance query based on intent (add relevant terms)
    const enhancedQuery = this.enhanceQueryForIntent(params.query, params.intent);

    // Map retrieval intent to a query type the existing RagService understands
    const queryType = this.mapIntentToQueryType(params.intent);

    // Call existing RagService
    const chunks = await this.ragService.retrieveWithMetadata(
      enhancedQuery,
      topK,
      params.cancerType,
      queryType,
      params.intent
    );

    // Apply source filter if specified
    const filtered = params.sourceFilter
      ? this.filterBySource(chunks, params.sourceFilter)
      : chunks;

    // If source filter removed too many results, fall back to unfiltered
    // but prefer filtered sources
    const finalChunks = filtered.length >= 2
      ? filtered.slice(0, topK)
      : this.preferSources(chunks, params.sourceFilter || INTENT_SOURCE_PREFERENCES[params.intent], topK);

    const latencyMs = Date.now() - started;

    this.logger.log({
      event: "retrieval_tool_call",
      query: params.query.substring(0, 60),
      enhancedQuery: enhancedQuery.substring(0, 80),
      intent: params.intent,
      sourceFilter: params.sourceFilter,
      topK,
      chunksRetrieved: chunks.length,
      chunksAfterFilter: finalChunks.length,
      latencyMs,
    });

    return {
      chunks: finalChunks,
      query: params.query,
      intent: params.intent,
      count: finalChunks.length,
      latencyMs,
    };
  }

  /**
   * Multi-call retrieval — executes multiple retrieve() calls in parallel,
   * merges and deduplicates results. This is what the Planner uses when
   * a query needs information from multiple intents.
   */
  async multiRetrieve(
    calls: RetrievalToolParams[]
  ): Promise<MultiRetrievalResult> {
    const started = Date.now();

    // Execute all calls in parallel
    const results = await Promise.all(
      calls.map((params) =>
        this.retrieve(params).catch((err) => {
          this.logger.warn(
            `Retrieval call failed (intent=${params.intent}): ${err.message}`
          );
          return {
            chunks: [] as EvidenceChunk[],
            query: params.query,
            intent: params.intent,
            count: 0,
            latencyMs: 0,
          } as RetrievalToolResult;
        })
      )
    );

    // Merge and deduplicate
    const chunkMap = new Map<
      string,
      { chunk: EvidenceChunk; maxScore: number; intentCount: number }
    >();

    for (const result of results) {
      for (const chunk of result.chunks) {
        const existing = chunkMap.get(chunk.chunkId);
        if (existing) {
          existing.intentCount++;
          existing.maxScore = Math.max(
            existing.maxScore,
            chunk.similarity || 0
          );
        } else {
          chunkMap.set(chunk.chunkId, {
            chunk,
            maxScore: chunk.similarity || 0,
            intentCount: 1,
          });
        }
      }
    }

    // Score with cross-intent bonus
    const scored = Array.from(chunkMap.values())
      .map((item) => ({
        chunk: item.chunk,
        finalScore: item.maxScore * (1.0 + (item.intentCount - 1) * 0.15),
      }))
      .sort((a, b) => b.finalScore - a.finalScore);

    // Take top results (sum of all topK params, capped at 15)
    const maxTotal = Math.min(
      calls.reduce((sum, c) => sum + (c.topK ?? 5), 0),
      15
    );
    const mergedChunks = scored
      .slice(0, maxTotal)
      .map((s) => ({ ...s.chunk, similarity: s.finalScore }));

    const totalLatencyMs = Date.now() - started;

    this.logger.log({
      event: "multi_retrieval_complete",
      totalCalls: calls.length,
      totalChunksBeforeMerge: chunkMap.size,
      mergedChunksReturned: mergedChunks.length,
      crossIntentOverlap: scored.filter(
        (s) => s.finalScore > (s.chunk.similarity || 0)
      ).length,
      totalLatencyMs,
    });

    return {
      mergedChunks,
      callResults: results,
      totalCalls: calls.length,
      totalLatencyMs,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────

  private enhanceQueryForIntent(query: string, intent: RetrievalIntent): string {
    const enhancements = INTENT_QUERY_ENHANCEMENTS[intent];
    if (!enhancements || enhancements.length === 0) return query;

    // Only add enhancement terms that aren't already in the query
    const lower = query.toLowerCase();
    const newTerms = enhancements.filter(
      (term) => !lower.includes(term.toLowerCase())
    );

    if (newTerms.length === 0) return query;

    // Add the most relevant term (first one not already present)
    return `${query} ${newTerms[0]}`;
  }

  private mapIntentToQueryType(intent: RetrievalIntent): string {
    switch (intent) {
      case "navigation":
      case "schemes":
      case "checklist":
        return "navigation";
      case "treatment":
        return "treatment";
      case "symptoms":
        return "symptoms";
      case "side_effects":
        return "sideEffects";
      case "psychosocial":
        return "caregiver";
      case "education":
      default:
        return "general";
    }
  }

  private filterBySource(
    chunks: EvidenceChunk[],
    sourceTypes: string[]
  ): EvidenceChunk[] {
    return chunks.filter(
      (chunk) =>
        chunk.document.sourceType &&
        sourceTypes.includes(chunk.document.sourceType)
    );
  }

  /**
   * Sort chunks preferring specific sources, but keep all results.
   * This avoids discarding results when source filter is too strict.
   */
  private preferSources(
    chunks: EvidenceChunk[],
    preferredSources: string[],
    topK: number
  ): EvidenceChunk[] {
    const preferred: EvidenceChunk[] = [];
    const others: EvidenceChunk[] = [];

    for (const chunk of chunks) {
      if (
        chunk.document.sourceType &&
        preferredSources.includes(chunk.document.sourceType)
      ) {
        preferred.push(chunk);
      } else {
        others.push(chunk);
      }
    }

    return [...preferred, ...others].slice(0, topK);
  }
}
