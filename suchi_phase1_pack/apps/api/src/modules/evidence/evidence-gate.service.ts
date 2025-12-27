import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { getEvidenceThresholds, getSourceConfig, isTrustedSource, QueryType, SourceConfig } from "../../config/trusted-sources.config";

export interface EvidenceChunk {
  chunkId: string;
  docId: string;
  content: string;
  document: {
    title: string;
    url?: string;
    sourceType: string | null;
    source: string | null;
    citation: string | null;
    lastReviewed?: Date | null;
    isTrustedSource: boolean;
  };
  similarity?: number;
}

export type EvidenceQuality = "strong" | "weak" | "conflicting" | "insufficient";

export type AbstentionReason = 
  | "insufficient_passages" 
  | "insufficient_sources" 
  | "untrusted_sources" 
  | "outdated_content" 
  | "conflicting_evidence"
  | "no_evidence";

export interface EvidenceGateResult {
  shouldAbstain: boolean;
  confidence: "high" | "medium" | "low";
  quality: EvidenceQuality;
  reason?: AbstentionReason;
  message?: string;
}

@Injectable()
export class EvidenceGateService {
  private readonly logger = new Logger(EvidenceGateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate evidence quality before allowing response generation
   */
  async validateEvidence(chunks: EvidenceChunk[], queryType: QueryType): Promise<EvidenceGateResult> {
    if (!chunks || chunks.length === 0) {
      return {
        shouldAbstain: true,
        confidence: "low",
        quality: "insufficient",
        reason: "no_evidence",
        message: "No relevant information found in knowledge base"
      };
    }

    // Check source trustworthiness
    const trustworthinessCheck = await this.checkSourceTrustworthiness(chunks);
    if (!trustworthinessCheck.isTrusted) {
      return {
        shouldAbstain: true,
        confidence: "low",
        quality: "insufficient",
        reason: "untrusted_sources",
        message: `Sources not from trusted providers: ${trustworthinessCheck.untrustedSources.join(", ")}`
      };
    }

    // Get evidence thresholds for this query type
    const thresholds = getEvidenceThresholds(queryType);

    // Check minimum passage count
    if (chunks.length < thresholds.minPassages) {
      return {
        shouldAbstain: true,
        confidence: "low",
        quality: "insufficient",
        reason: "insufficient_passages",
        message: `Found ${chunks.length} passage(s), need at least ${thresholds.minPassages} for ${queryType} queries`
      };
    }

    // Check minimum source count
    const uniqueDocIds = new Set(chunks.map(c => c.docId));
    if (uniqueDocIds.size < thresholds.minSources) {
      return {
        shouldAbstain: true,
        confidence: "low",
        quality: "insufficient",
        reason: "insufficient_sources",
        message: `Found ${uniqueDocIds.size} source(s), need at least ${thresholds.minSources} for ${queryType} queries`
      };
    }

    // Check for recency requirements
    const recencyCheck = await this.checkRecency(chunks, queryType);
    if (!recencyCheck.isRecent) {
      this.logger.warn(`Content may be outdated for ${queryType} query: ${recencyCheck.message}`);
      // Warning but not blocking - allow with low confidence
    }

    // Detect conflicts between sources
    const conflictCheck = this.detectConflicts(chunks);
    if (conflictCheck.hasConflict) {
      return {
        shouldAbstain: false, // Present uncertainty instead of abstaining
        confidence: "low",
        quality: "conflicting",
        reason: "conflicting_evidence",
        message: conflictCheck.message
      };
    }

    // Determine quality based on passage count and sources
    const quality: EvidenceQuality = 
      chunks.length >= thresholds.minPassages + 1 && uniqueDocIds.size >= thresholds.minSources + 1
        ? "strong"
        : "weak";

    const confidence: "high" | "medium" | "low" = 
      quality === "strong" ? "high" :
      quality === "weak" ? "medium" : "low";

    return {
      shouldAbstain: false,
      confidence,
      quality,
    };
  }

  /**
   * Check if all sources are from trusted providers
   */
  async checkSourceTrustworthiness(chunks: EvidenceChunk[]): Promise<{
    isTrusted: boolean;
    untrustedSources: string[];
  }> {
    const untrustedSources: string[] = [];
    const checkedDocs = new Set<string>();

    for (const chunk of chunks) {
      // Skip if we already checked this document
      if (checkedDocs.has(chunk.docId)) {
        continue;
      }
      checkedDocs.add(chunk.docId);

      // Check the isTrustedSource flag from the chunk metadata (already loaded)
      if (!chunk.document.isTrustedSource) {
        const sourceType = chunk.document.sourceType || "unknown";
        if (!untrustedSources.includes(sourceType)) {
          untrustedSources.push(sourceType);
        }
        continue;
      }

      // Also verify sourceType is in trusted list (double-check)
      const sourceType = chunk.document.sourceType;
      if (sourceType && !isTrustedSource(sourceType)) {
        if (!untrustedSources.includes(sourceType)) {
          untrustedSources.push(sourceType);
        }
      }
    }

    return {
      isTrusted: untrustedSources.length === 0,
      untrustedSources
    };
  }

  /**
   * Check if content is recent enough for time-sensitive topics
   */
  async checkRecency(chunks: EvidenceChunk[], topic: string): Promise<{
    isRecent: boolean;
    message?: string;
  }> {
    const now = new Date();
    const outdatedChunks: string[] = [];

    for (const chunk of chunks) {
      const sourceType = chunk.document.sourceType;
      if (!sourceType) continue;

      const config = getSourceConfig(sourceType);
      if (!config || !config.requiresRecency) {
        continue; // No recency requirement for this source
      }

      const lastReviewed = chunk.document.lastReviewed;
      if (!lastReviewed) {
        // No review date - consider it potentially outdated
        outdatedChunks.push(chunk.document.title || chunk.docId);
        continue;
      }

      const ageMonths = (now.getTime() - lastReviewed.getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (config.maxAgeMonths && ageMonths > config.maxAgeMonths) {
        outdatedChunks.push(chunk.document.title || chunk.docId);
      }
    }

    if (outdatedChunks.length > 0) {
      return {
        isRecent: false,
        message: `Some sources may be outdated: ${outdatedChunks.slice(0, 3).join(", ")}`
      };
    }

    return { isRecent: true };
  }

  /**
   * Detect conflicts between top sources
   * Simple heuristic: if top 2 chunks from different sources contradict each other
   */
  detectConflicts(chunks: EvidenceChunk[]): {
    hasConflict: boolean;
    message?: string;
  } {
    if (chunks.length < 2) {
      return { hasConflict: false };
    }

    // Group chunks by source
    const sourceGroups = new Map<string, EvidenceChunk[]>();
    for (const chunk of chunks.slice(0, 4)) { // Check top 4 chunks
      const sourceType = chunk.document.sourceType || "unknown";
      if (!sourceGroups.has(sourceType)) {
        sourceGroups.set(sourceType, []);
      }
      sourceGroups.get(sourceType)!.push(chunk);
    }

    // If we have multiple sources, check for obvious contradictions
    // This is a simple heuristic - could be enhanced with semantic similarity
    if (sourceGroups.size >= 2) {
      // For now, we'll flag if we have multiple sources as potential conflict
      // In practice, you might want to do semantic analysis
      // For Phase 1, we'll just note it and let the LLM present uncertainty
      return {
        hasConflict: false, // Don't block, just note uncertainty
        message: "Multiple sources found - may present different perspectives"
      };
    }

    return { hasConflict: false };
  }
}

