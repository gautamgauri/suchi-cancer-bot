import { Injectable, Logger } from "@nestjs/common";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

export interface ValidationResult {
  isValid: boolean;
  ungroundedEntities: UngroundedEntity[];
  shouldAbstain: boolean;
}

export interface UngroundedEntity {
  type: "diagnostic_test" | "treatment" | "staging_prognosis" | "procedure";
  entity: string;
  context: string; // Surrounding text where entity was found
}

/**
 * Validates that all medical entities in a response are grounded in retrieved chunks
 */
@Injectable()
export class ResponseValidatorService {
  private readonly logger = new Logger(ResponseValidatorService.name);

  // Diagnostic test patterns (case-insensitive)
  private readonly diagnosticTestPatterns = [
    /\b(CT|CAT)\s*(scan|scanning)?\b/gi,
    /\bMRI\b/gi,
    /\bbronchoscopy\b/gi,
    /\bbiopsy\b/gi,
    /\bPET\s*(-\s*CT)?\b/gi,
    /\bX-?ray\b/gi,
    /\bmammogram\b/gi,
    /\bultrasound\b/gi,
    /\bcolonoscopy\b/gi,
    /\bendoscopy\b/gi,
    /\blaryngoscopy\b/gi,
    /\bcolposcopy\b/gi,
    /\bFNA\b/gi, // Fine needle aspiration
    /\bPSA\b/gi, // Prostate-specific antigen
    /\bAFP\b/gi, // Alpha-fetoprotein
    /\bCA\s*-?\s*125\b/gi,
    /\bCA\s*-?\s*19-?9\b/gi,
    /\bCEA\b/gi, // Carcinoembryonic antigen
    /\bPap\s*(test|smear)?\b/gi,
    /\bHPV\s*test\b/gi,
    /\bsputum\s*test\b/gi,
    /\bchest\s*X-?ray\b/gi,
    /\bpulmonary\s*function\s*test\b/gi,
    /\bneedle\s*biopsy\b/gi,
    /\bsurgical\s*biopsy\b/gi,
    /\bFIT\b/gi, // Fecal immunochemical test
    /\bDRE\b/gi, // Digital rectal exam
    /\bEUS\b/gi, // Endoscopic ultrasound
    /\bTSH\b/gi, // Thyroid-stimulating hormone
    /\bcystoscopy\b/gi,
    /\burinalysis\b/gi,
    /\bpathology\s*(test|report)?\b/gi,
    /\bstaging\s*(scan|test|workup)?\b/gi,
    /\breceptor\s*testing\b/gi,
    /\bgenetic\s*markers?\b/gi,
    /\btumor\s*markers?\b/gi,
  ];

  // Treatment patterns
  private readonly treatmentPatterns = [
    /\bchemotherapy\b/gi,
    /\bimmunotherapy\b/gi,
    /\bradiation\s*(therapy|treatment)?\b/gi,
    /\btargeted\s*therapy\b/gi,
    /\bhormone\s*therapy\b/gi,
    /\bsurgery\b/gi,
    /\bsurgical\s*(resection|removal|procedure)\b/gi,
  ];

  // Staging/prognosis patterns
  private readonly stagingPrognosisPatterns = [
    /\bstage\s*[I1-4IV]\b/gi,
    /\bstaging\b/gi,
    /\bprognosis\b/gi,
    /\bsurvival\s*(rate|percentage)?\b/gi,
    /\b\d+%\s*survival\b/gi,
    /\bmetastasis\b/gi,
    /\bmetastatic\b/gi,
  ];

  // Procedure patterns
  private readonly procedurePatterns = [
    /\bphysical\s*exam\b/gi,
    /\bclinical\s*exam\b/gi,
    /\bpelvic\s*exam\b/gi,
    /\bbreast\s*exam\b/gi,
    /\bchest\s*exam\b/gi,
    /\bneurologic\s*exam\b/gi,
    /\bENT\s*exam\b/gi,
  ];

  /**
   * Validate that all medical entities in the response are grounded in retrieved chunks
   */
  validate(responseText: string, retrievedChunks: EvidenceChunk[]): ValidationResult {
    const ungroundedEntities: UngroundedEntity[] = [];

    // Combine all chunk content for searching
    const allChunkContent = retrievedChunks.map(chunk => chunk.content.toLowerCase()).join(" ");

    // Extract and check diagnostic tests
    this.extractAndCheckEntities(
      responseText,
      this.diagnosticTestPatterns,
      "diagnostic_test",
      allChunkContent,
      ungroundedEntities
    );

    // Extract and check treatments
    this.extractAndCheckEntities(
      responseText,
      this.treatmentPatterns,
      "treatment",
      allChunkContent,
      ungroundedEntities
    );

    // Extract and check staging/prognosis
    this.extractAndCheckEntities(
      responseText,
      this.stagingPrognosisPatterns,
      "staging_prognosis",
      allChunkContent,
      ungroundedEntities
    );

    // Extract and check procedures
    this.extractAndCheckEntities(
      responseText,
      this.procedurePatterns,
      "procedure",
      allChunkContent,
      ungroundedEntities
    );

    // Remove duplicates (same entity, same type)
    const uniqueEntities = this.deduplicateEntities(ungroundedEntities);

    const isValid = uniqueEntities.length === 0;
    const shouldAbstain = !isValid;

    if (!isValid) {
      this.logger.warn(
        `Response contains ${uniqueEntities.length} ungrounded medical entities: ${uniqueEntities.map(e => e.entity).join(", ")}`
      );
    }

    return {
      isValid,
      ungroundedEntities: uniqueEntities,
      shouldAbstain
    };
  }

  /**
   * Extract entities using patterns and check if they're grounded
   */
  private extractAndCheckEntities(
    responseText: string,
    patterns: RegExp[],
    type: UngroundedEntity["type"],
    allChunkContent: string,
    ungroundedEntities: UngroundedEntity[]
  ): void {
    for (const pattern of patterns) {
      // Reset regex lastIndex to avoid issues with global flag
      pattern.lastIndex = 0;
      
      let match;
      while ((match = pattern.exec(responseText)) !== null) {
        const entity = match[0].trim();
        const entityLower = entity.toLowerCase();
        
        // Check if entity appears in any retrieved chunk
        // Use word boundaries to avoid partial matches
        const entityPattern = new RegExp(`\\b${this.escapeRegex(entityLower)}\\b`, "i");
        
        if (!entityPattern.test(allChunkContent)) {
          // Get context around the match (50 chars before and after)
          const start = Math.max(0, match.index - 50);
          const end = Math.min(responseText.length, match.index + match[0].length + 50);
          const context = responseText.substring(start, end).replace(/\s+/g, " ").trim();

          ungroundedEntities.push({
            type,
            entity,
            context
          });
        }
      }
    }
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Remove duplicate entities (same entity and type)
   */
  private deduplicateEntities(entities: UngroundedEntity[]): UngroundedEntity[] {
    const seen = new Set<string>();
    const unique: UngroundedEntity[] = [];

    for (const entity of entities) {
      const key = `${entity.type}:${entity.entity.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(entity);
      }
    }

    return unique;
  }

  /**
   * Generate abstention response when ungrounded entities are found
   */
  generateAbstentionResponse(hasRedFlags: boolean = false): string {
    let response = "I don't have enough information in my NCI sources to answer this safely. Please consult a clinician.";

    if (hasRedFlags) {
      response += "\n\nIf you're experiencing severe symptoms (significant bleeding, severe pain, difficulty breathing, or other urgent concerns), seek emergency care immediately or call emergency services.";
    } else {
      response += "\n\nFor general information about cancer, I can help answer questions based on trusted sources. If you have specific concerns about symptoms, please consult a healthcare provider.";
    }

    return response;
  }
}



