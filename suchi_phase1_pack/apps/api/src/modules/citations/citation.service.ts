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

export interface CitationValidationResult {
  isValid: boolean;
  citations: Citation[];
  errors?: string[];
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
   */
  extractCitations(response: string, retrievedChunks: EvidenceChunk[]): Citation[] {
    const citations: Citation[] = [];
    const chunkMap = new Map<string, EvidenceChunk>();
    
    // Build map for quick lookup
    for (const chunk of retrievedChunks) {
      chunkMap.set(`${chunk.docId}:${chunk.chunkId}`, chunk);
    }

    let match;
    while ((match = CITATION_PATTERN.exec(response)) !== null) {
      const fullMatch = match[0];
      const docId = match[1];
      const chunkId = match[2];
      const position = match.index;

      // Validate that this citation references an actual retrieved chunk
      const key = `${docId}:${chunkId}`;
      if (chunkMap.has(key)) {
        citations.push({
          docId,
          chunkId,
          position,
          citationText: fullMatch
        });
      } else {
        this.logger.warn(`Invalid citation: ${fullMatch} - chunk not found in retrieved chunks`);
      }
    }

    return citations.sort((a, b) => a.position - b.position);
  }

  /**
   * Validate citations against retrieved chunks
   * Ensures all citations are valid and claims have citations
   */
  validateCitations(citations: Citation[], chunks: EvidenceChunk[]): CitationValidationResult {
    const errors: string[] = [];
    
    // Build chunk map
    const chunkMap = new Map<string, EvidenceChunk>();
    for (const chunk of chunks) {
      chunkMap.set(`${chunk.docId}:${chunk.chunkId}`, chunk);
    }

    // Validate each citation
    for (const citation of citations) {
      const key = `${citation.docId}:${citation.chunkId}`;
      if (!chunkMap.has(key)) {
        errors.push(`Invalid citation: ${citation.citationText} - chunk not found`);
      }
    }

    // Check for duplicates
    const citationKeys = new Set<string>();
    for (const citation of citations) {
      const key = `${citation.docId}:${citation.chunkId}`;
      if (citationKeys.has(key)) {
        errors.push(`Duplicate citation: ${citation.citationText}`);
      }
      citationKeys.add(key);
    }

    // Basic check: should have at least some citations for medical claims
    // Note: More sophisticated checks (like ensuring each sentence has citations) 
    // would require NLP parsing - this is a basic validation
    if (citations.length === 0) {
      errors.push("Response contains no citations - all medical claims must be cited");
    }

    return {
      isValid: errors.length === 0,
      citations,
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

