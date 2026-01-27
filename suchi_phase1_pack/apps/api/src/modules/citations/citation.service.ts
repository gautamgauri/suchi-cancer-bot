import { Injectable, Logger } from "@nestjs/common";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

export interface Citation {
  docId: string;
  chunkId: string;
  position: number; // Character position in response text
  citationText: string; // The citation marker text like "[citation:docId:chunkId]"
}

export interface EnrichedCitation extends Citation {
  document: {
    title: string;
    url?: string;
    sourceType: string | null;
    source: string | null;
    citation: string | null;
  };
}

export type CitationConfidenceLevel = "GREEN" | "YELLOW" | "RED";

export interface CitationExtractionResult {
  citations: Citation[];
  orphanCount: number; // Number of hallucinated citations that referenced non-existent chunks
  orphanCitations: string[]; // The actual orphan citation markers
}

export interface CitationValidationResult {
  isValid: boolean;
  confidenceLevel: CitationConfidenceLevel;
  citations: Citation[];
  errors?: string[];
  citationDensity: number; // Citations per sentence
  orphanCount?: number; // If > 0, indicates hallucinated citations were detected
}

/**
 * Citation format: [citation:docId:chunkId]
 * Example: "Breast cancer screening typically begins at age 40 [citation:doc_123:chunk_456]"
 */
const CITATION_PATTERN = /\[citation:([^:]+):([^\]]+)\]/g;

@Injectable()
export class CitationService {
  private readonly logger = new Logger(CitationService.name);

  /**
   * Extract citations from LLM response text
   * Enforces strict 1:1 mapping: only citations that reference actual retrieved chunks are included
   * Orphan citations (not in retrieved chunks) are tracked and reported
   *
   * @returns CitationExtractionResult with valid citations and orphan count
   */
  extractCitations(response: string, retrievedChunks: EvidenceChunk[]): CitationExtractionResult {
    const citations: Citation[] = [];
    const chunkMap = new Map<string, EvidenceChunk>();

    // Build map for quick lookup
    for (const chunk of retrievedChunks) {
      chunkMap.set(`${chunk.docId}:${chunk.chunkId}`, chunk);
    }

    let match;
    const orphanCitations: string[] = [];
    while ((match = CITATION_PATTERN.exec(response)) !== null) {
      const fullMatch = match[0];
      const docId = match[1];
      const chunkId = match[2];
      const position = match.index;

      // Strict validation: citation MUST reference an actual retrieved chunk
      const key = `${docId}:${chunkId}`;
      if (chunkMap.has(key)) {
        citations.push({
          docId,
          chunkId,
          position,
          citationText: fullMatch
        });
      } else {
        // Orphan citation - LLM hallucinated a citation to non-existent chunk
        orphanCitations.push(fullMatch);
        const availableKeys = Array.from(chunkMap.keys()).slice(0, 5);
        this.logger.error(`[CITATION_INTEGRITY] HALLUCINATED citation detected: ${fullMatch} - chunk not in retrieved set. Looking for key: "${key}". Available chunks (first 5): ${availableKeys.join(", ")}`);
      }
    }

    // Log citation integrity summary
    if (orphanCitations.length > 0) {
      this.logger.error(`[CITATION_INTEGRITY] ${orphanCitations.length} hallucinated citation(s) detected! This indicates LLM generated fake references. Valid citations: ${citations.length}`);
    }

    return {
      citations: citations.sort((a, b) => a.position - b.position),
      orphanCount: orphanCitations.length,
      orphanCitations
    };
  }

  /**
   * Validate citations against retrieved chunks with graduated confidence levels
   *
   * Citation Threshold Ladder:
   * - GREEN (high confidence): 2+ citations, good density (>0.3 citations/sentence)
   * - YELLOW (low confidence): 1 citation OR low density - answer with uncertainty
   * - RED (abstain): 0 citations OR orphan citations detected - unsafe to answer
   *
   * IMPORTANT: If orphan (hallucinated) citations are detected, this returns RED confidence
   * regardless of valid citation count. Hallucinated citations are a safety concern.
   *
   * @param isIdentifyQuestionWithGeneralIntent If true, allows 0 citations with YELLOW (not RED) for identify questions
   * @param orphanCount Number of hallucinated citations detected (from extractCitations)
   */
  validateCitations(
    citations: Citation[],
    chunks: EvidenceChunk[],
    responseText?: string,
    isIdentifyQuestionWithGeneralIntent?: boolean,
    orphanCount?: number
  ): CitationValidationResult {
    const errors: string[] = [];

    // Build chunk map
    const chunkMap = new Map<string, EvidenceChunk>();
    for (const chunk of chunks) {
      chunkMap.set(`${chunk.docId}:${chunk.chunkId}`, chunk);
    }

    // Validate each citation references an actual retrieved chunk
    for (const citation of citations) {
      const key = `${citation.docId}:${citation.chunkId}`;
      if (!chunkMap.has(key)) {
        errors.push(`Invalid citation: ${citation.citationText} - chunk not found`);
      }
    }

    // Check for duplicates (warning, not error)
    const citationKeys = new Set<string>();
    for (const citation of citations) {
      const key = `${citation.docId}:${citation.chunkId}`;
      if (citationKeys.has(key)) {
        this.logger.debug(`Duplicate citation: ${citation.citationText}`);
      }
      citationKeys.add(key);
    }

    // Calculate citation density (citations per sentence)
    // Simple sentence splitting - could be enhanced with proper NLP
    const sentenceCount = responseText
      ? responseText.split(/[.!?]+/).filter(s => s.trim().length > 0).length
      : 1;
    const citationDensity = citations.length / sentenceCount;

    // Determine confidence level using threshold ladder
    let confidenceLevel: CitationConfidenceLevel;
    let isValid: boolean;

    // CRITICAL: Orphan (hallucinated) citations detected → RED confidence
    // This is a safety concern: LLM generated fake references to non-existent chunks
    if (orphanCount && orphanCount > 0) {
      confidenceLevel = "RED";
      isValid = false;
      errors.push(`${orphanCount} hallucinated citation(s) detected - LLM referenced non-existent chunks. Response is unsafe.`);
      this.logger.error(`[CITATION_INTEGRITY] Failing validation: ${orphanCount} orphan citations. Valid: ${citations.length}. Returning RED confidence.`);
      return {
        isValid,
        confidenceLevel,
        citations,
        citationDensity,
        errors,
        orphanCount
      };
    }

    if (citations.length === 0) {
      // Special case: For identify questions with general intent, allow with YELLOW (strong disclaimer)
      // This allows educational content even if LLM didn't generate citations properly
      if (isIdentifyQuestionWithGeneralIntent) {
        confidenceLevel = "YELLOW";
        isValid = true;
        this.logger.warn("Identify question with general intent has 0 citations - allowing with YELLOW confidence and strong disclaimer");
      } else {
        // RED: No citations - unsafe, must abstain
        confidenceLevel = "RED";
        isValid = false;
        errors.push("Response contains no citations - all medical claims must be cited");
      }
    } else if (citations.length < 2 || citationDensity < 0.3) {
      // YELLOW: Limited citations - answer with caution and uncertainty
      confidenceLevel = "YELLOW";
      isValid = true; // Allow response but flag as low confidence
      this.logger.warn(`Low citation density: ${citations.length} citations, density ${citationDensity.toFixed(2)}`);
    } else {
      // GREEN: Good citation coverage - high confidence
      confidenceLevel = "GREEN";
      isValid = true;
    }

    return {
      isValid,
      confidenceLevel,
      citations,
      citationDensity,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Enrich citations with document metadata
   */
  async enrichCitations(citations: Citation[], chunks: EvidenceChunk[]): Promise<EnrichedCitation[]> {
    const chunkMap = new Map<string, EvidenceChunk>();
    for (const chunk of chunks) {
      chunkMap.set(`${chunk.docId}:${chunk.chunkId}`, chunk);
    }

    return citations.map(citation => {
      const key = `${citation.docId}:${citation.chunkId}`;
      const chunk = chunkMap.get(key);

      if (!chunk) {
        this.logger.warn(`Cannot enrich citation ${citation.citationText} - chunk not found`);
        return {
          ...citation,
          document: {
            title: "Unknown",
            sourceType: null,
            source: null,
            citation: null
          }
        };
      }

      return {
        ...citation,
        document: {
          title: chunk.document.title,
          url: chunk.document.url,
          sourceType: chunk.document.sourceType,
          source: chunk.document.source,
          citation: chunk.document.citation
        }
      };
    });
  }

  /**
   * Remove citation markers from response text (for display)
   * Optionally replace with readable citations
   */
  removeCitationMarkers(response: string): string {
    return response.replace(CITATION_PATTERN, "");
  }

  /**
   * Format citations for display (e.g., as footnotes or inline references)
   */
  formatCitationsForDisplay(citations: EnrichedCitation[]): string {
    if (citations.length === 0) return "";

    const lines = ["\n\n**Sources:**"];
    citations.forEach((citation, index) => {
      const sourceName = citation.document.source || citation.document.title;
      const url = citation.document.url;
      if (url) {
        lines.push(`${index + 1}. ${sourceName} - ${url}`);
      } else {
        lines.push(`${index + 1}. ${sourceName}`);
      }
    });

    return lines.join("\n");
  }
}












