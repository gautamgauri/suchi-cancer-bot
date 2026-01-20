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

export interface CitationValidationResult {
  isValid: boolean;
  confidenceLevel: CitationConfidenceLevel;
  citations: Citation[];
  errors?: string[];
  citationDensity: number; // Citations per sentence
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
   * Orphan citations (not in retrieved chunks) are filtered out
   */
  extractCitations(response: string, retrievedChunks: EvidenceChunk[]): Citation[] {
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
        // Orphan citation - not in retrieved chunks, filter it out
        orphanCitations.push(fullMatch);
        const availableKeys = Array.from(chunkMap.keys()).slice(0, 5);
        this.logger.warn(`[CITATION_INTEGRITY] Orphan citation filtered: ${fullMatch} - chunk not in retrieved set. Looking for key: "${key}". Available chunks (first 5): ${availableKeys.join(", ")}`);
      }
    }

    // Log citation integrity summary
    if (orphanCitations.length > 0) {
      this.logger.warn(`[CITATION_INTEGRITY] Filtered ${orphanCitations.length} orphan citation(s). Only ${citations.length} valid citations remain.`);
    }

    return citations.sort((a, b) => a.position - b.position);
  }

  /**
   * Validate citations against retrieved chunks with graduated confidence levels
   *
   * Citation Threshold Ladder:
   * - GREEN (high confidence): 2+ citations, good density (>0.3 citations/sentence)
   * - YELLOW (low confidence): 1 citation OR low density - answer with uncertainty
   * - RED (abstain): 0 citations - unsafe to answer
   * 
   * @param isIdentifyQuestionWithGeneralIntent If true, allows 0 citations with YELLOW (not RED) for identify questions
   */
  validateCitations(
    citations: Citation[], 
    chunks: EvidenceChunk[], 
    responseText?: string,
    isIdentifyQuestionWithGeneralIntent?: boolean
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












