import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { getEvidenceThresholds, getSourceConfig, isTrustedSource, QueryType, SourceConfig } from "../../config/trusted-sources.config";
import { ModeDetector } from "../chat/mode-detector";

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
  | "no_evidence"
  | "citation_validation_failed";

export interface EvidenceGateResult {
  // NEW: Clear status and approved chunks for trust-first enforcement
  status: 'ok' | 'insufficient';
  approvedChunks: EvidenceChunk[];
  reasonCode: 'NO_RESULTS' | 'LOW_TRUST' | 'LOW_SCORE' | 'RECENCY_FAIL' | 'LOW_DIVERSITY' | 'FILTERED_OUT' | null;
  
  // EXISTING: Keep for backward compatibility
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
   * Check if RAG has strong matches (Rule B1)
   * Strong = similarity > 0.7 OR top 3 chunks from trusted sources
   */
  hasStrongMatches(chunks: EvidenceChunk[]): boolean {
    if (!chunks || chunks.length === 0) {
      return false;
    }

    // Check if top chunk has high similarity (> 0.7)
    const topChunk = chunks[0];
    if (topChunk.similarity !== undefined && topChunk.similarity > 0.7) {
      return true;
    }

    // Check if top 3 chunks are from trusted sources
    const top3Chunks = chunks.slice(0, 3);
    const allTrusted = top3Chunks.every(chunk => chunk.document.isTrustedSource);
    if (top3Chunks.length >= 3 && allTrusted) {
      return true;
    }

    return false;
  }

  /**
   * Validate evidence quality before allowing response generation
   * Rule B1: If strong matches, bypass abstention (only check source trustworthiness)
   * Rule B2: If weak/empty, ask clarifying question before abstaining
   * Rule B3: Abstain only for diagnosis/treatment/dosing or very weak matches
   */
  async validateEvidence(
    chunks: EvidenceChunk[], 
    queryType: QueryType, 
    userText?: string,
    intent?: string,
    conversationContext?: { hasGenerallyAsking?: boolean }
  ): Promise<EvidenceGateResult> {
    // Bypass abstention when general education is detected
    if (conversationContext?.hasGenerallyAsking && intent === "INFORMATIONAL_GENERAL") {
      return {
        status: chunks.length > 0 ? 'ok' : 'insufficient',
        approvedChunks: chunks.length > 0 ? chunks : [],
        reasonCode: chunks.length > 0 ? null : 'NO_RESULTS',
        shouldAbstain: false,
        confidence: "medium",
        quality: chunks.length > 0 ? "weak" : "insufficient"
      };
    }

    // Override: Allow general identify questions through even with weak evidence
    // Check if this is a general identify question (not personal) - check userText pattern directly
    if (userText) {
      const identifyGeneralPattern = /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i;
      const cancerKeywordPattern = /\b(cancer|lymphoma|tumou?r|symptom|sign|warning)\b/i;
      
      const isIdentifyGeneral = identifyGeneralPattern.test(userText.toLowerCase()) && 
                                cancerKeywordPattern.test(userText.toLowerCase()) &&
                                !ModeDetector.hasPersonalDiagnosisSignal(userText);
      
      if (isIdentifyGeneral) {
        // Allow through with caution - provide informational response even with weak evidence
        // This bypasses abstention for general "how to identify" questions
        return {
          status: chunks.length > 0 ? 'ok' : 'insufficient',
          approvedChunks: chunks.length > 0 ? chunks : [],
          reasonCode: chunks.length > 0 ? null : 'NO_RESULTS',
          shouldAbstain: false,
          confidence: "medium",
          quality: chunks.length > 0 ? "weak" : "insufficient"
        };
      }
    }

    if (!chunks || chunks.length === 0) {
      return {
        status: 'insufficient',
        approvedChunks: [],
        reasonCode: 'NO_RESULTS',
        shouldAbstain: true,
        confidence: "low",
        quality: "insufficient",
        reason: "no_evidence",
        message: "No relevant information found in knowledge base"
      };
    }

    // Rule B1: Check for strong matches first
    const hasStrong = this.hasStrongMatches(chunks);
    if (hasStrong) {
      // Only check source trustworthiness for strong matches
      const trustworthinessCheck = await this.checkSourceTrustworthiness(chunks);
      if (!trustworthinessCheck.isTrusted) {
        return {
          status: 'insufficient',
          approvedChunks: [],
          reasonCode: 'LOW_TRUST',
          shouldAbstain: true,
          confidence: "low",
          quality: "insufficient",
          reason: "untrusted_sources",
          message: `Sources not from trusted providers: ${trustworthinessCheck.untrustedSources.join(", ")}`
        };
      }

      // Strong matches pass through - answer directly
      return {
        status: 'ok',
        approvedChunks: chunks,
        reasonCode: null,
        shouldAbstain: false,
        confidence: "high",
        quality: "strong",
      };
    }

    // For non-strong matches, check source trustworthiness
    const trustworthinessCheck = await this.checkSourceTrustworthiness(chunks);
    if (!trustworthinessCheck.isTrusted) {
      return {
        status: 'insufficient',
        approvedChunks: [],
        reasonCode: 'LOW_TRUST',
        shouldAbstain: true,
        confidence: "low",
        quality: "insufficient",
        reason: "untrusted_sources",
        message: `Sources not from trusted providers: ${trustworthinessCheck.untrustedSources.join(", ")}`
      };
    }

    // Rule B2: For weak matches, check thresholds but don't abstain immediately
    // Rule B3: Only abstain if confidence would be very low (< 0.3 equivalent)
    const thresholds = getEvidenceThresholds(queryType);
    const uniqueDocIds = new Set(chunks.map(c => c.docId));

    // NEW: Relax thresholds for general-info queries with Tier-1 sources
    const hasTier1 = chunks.some(c => {
      const config = getSourceConfig(c.document.sourceType || '');
      return config?.priority === 'high';
    });

    const isGeneralInfo = ['general', 'prevention', 'caregiver', 'navigation'].includes(queryType);
    const adjustedThresholds = (isGeneralInfo && hasTier1) 
      ? { minPassages: 1, minSources: 1 } // Relax for general queries with Tier-1 source
      : thresholds; // Keep strict for treatment/symptoms

    // Calculate confidence based on similarity scores if available
    const avgSimilarity = chunks
      .filter(c => c.similarity !== undefined)
      .map(c => c.similarity!)
      .reduce((sum, sim) => sum + sim, 0) / chunks.filter(c => c.similarity !== undefined).length;

    // Rule B3: Very weak matches (low similarity AND insufficient passages/sources)
    const isVeryWeak = (avgSimilarity < 0.3 || avgSimilarity === undefined) && 
                       (chunks.length < adjustedThresholds.minPassages || uniqueDocIds.size < adjustedThresholds.minSources);

    if (isVeryWeak) {
      return {
        status: 'insufficient',
        approvedChunks: [],
        reasonCode: 'LOW_SCORE',
        shouldAbstain: true,
        confidence: "low",
        quality: "insufficient",
        reason: chunks.length < thresholds.minPassages ? "insufficient_passages" : "insufficient_sources",
        message: `Found ${chunks.length} passage(s) from ${uniqueDocIds.size} source(s), but confidence is too low to answer accurately`
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
        status: 'ok', // Allow with conflicting flag
        approvedChunks: chunks,
        reasonCode: null,
        shouldAbstain: false, // Present uncertainty instead of abstaining
        confidence: "low",
        quality: "conflicting",
        reason: "conflicting_evidence",
        message: conflictCheck.message
      };
    }

    // Determine quality based on passage count, sources, and similarity
    const hasEnoughPassages = chunks.length >= thresholds.minPassages;
    const hasEnoughSources = uniqueDocIds.size >= thresholds.minSources;
    const hasGoodSimilarity = avgSimilarity !== undefined && avgSimilarity > 0.5;

    const quality: EvidenceQuality = 
      hasEnoughPassages && hasEnoughSources && hasGoodSimilarity
        ? "strong"
        : (hasEnoughPassages || hasEnoughSources || hasGoodSimilarity)
        ? "weak"
        : "insufficient";

    const confidence: "high" | "medium" | "low" = 
      quality === "strong" ? "high" :
      quality === "weak" ? "medium" : "low";

    // Rule B2: For weak matches, don't abstain - allow with clarifying question option
    return {
      status: quality === "insufficient" ? 'insufficient' : 'ok',
      approvedChunks: quality === "insufficient" ? [] : chunks,
      reasonCode: quality === "insufficient" ? 'LOW_DIVERSITY' : null,
      shouldAbstain: false,
      confidence,
      quality,
    };
  }

  /**
   * Generate a clarifying question for weak evidence (Rule B2)
   */
  generateClarifyingQuestion(userText: string, queryType: QueryType): string {
    const lowerText = userText.toLowerCase();
    
    // Detect what type of question this is
    if (lowerText.includes("symptom")) {
      return "To provide more accurate information, could you specify which symptoms you're asking about, or are you asking about symptoms in general?";
    }
    if (lowerText.includes("treatment") || lowerText.includes("therapy")) {
      return "To help you better, could you share the cancer type or stage (if known), or are you asking about treatments in general?";
    }
    if (lowerText.includes("report") || lowerText.includes("scan") || lowerText.includes("test")) {
      return "To provide more relevant guidance, could you share the type of report or test you're asking about?";
    }
    
    // Generic clarifying question
    return "To provide a more accurate answer, could you provide a bit more context about what specifically you'd like to know?";
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

