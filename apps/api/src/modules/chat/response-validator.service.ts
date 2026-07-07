import { Injectable, Logger } from "@nestjs/common";
import { EvidenceChunk } from "../evidence/evidence-gate.service";
import {
  DIAGNOSTIC_TEST_PATTERNS,
  TREATMENT_PATTERNS,
  STAGING_PROGNOSIS_PATTERNS,
  PROCEDURE_PATTERNS,
  PatternEntry,
  resetPatternIndices,
} from "./patterns/medical-entities";

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
 * Uses shared pattern registry from patterns/medical-entities.ts
 */
@Injectable()
export class ResponseValidatorService {
  private readonly logger = new Logger(ResponseValidatorService.name);

  /**
   * Validate that all medical entities in the response are grounded in retrieved chunks
   * Uses shared patterns from patterns/medical-entities.ts
   */
  validate(responseText: string, retrievedChunks: EvidenceChunk[]): ValidationResult {
    const ungroundedEntities: UngroundedEntity[] = [];

    // Combine all chunk content for searching
    const allChunkContent = retrievedChunks.map(chunk => chunk.content.toLowerCase()).join(" ");

    // Reset all pattern indices before extraction
    resetPatternIndices(DIAGNOSTIC_TEST_PATTERNS);
    resetPatternIndices(TREATMENT_PATTERNS);
    resetPatternIndices(STAGING_PROGNOSIS_PATTERNS);
    resetPatternIndices(PROCEDURE_PATTERNS);

    // Extract and check diagnostic tests
    this.extractAndCheckEntities(
      responseText,
      DIAGNOSTIC_TEST_PATTERNS,
      "diagnostic_test",
      allChunkContent,
      ungroundedEntities
    );

    // Extract and check treatments
    this.extractAndCheckEntities(
      responseText,
      TREATMENT_PATTERNS,
      "treatment",
      allChunkContent,
      ungroundedEntities
    );

    // Extract and check staging/prognosis
    this.extractAndCheckEntities(
      responseText,
      STAGING_PROGNOSIS_PATTERNS,
      "staging_prognosis",
      allChunkContent,
      ungroundedEntities
    );

    // Extract and check procedures
    this.extractAndCheckEntities(
      responseText,
      PROCEDURE_PATTERNS,
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
   * Extract entities using PatternEntry array and check if they're grounded
   */
  private extractAndCheckEntities(
    responseText: string,
    patterns: PatternEntry[],
    type: UngroundedEntity["type"],
    allChunkContent: string,
    ungroundedEntities: UngroundedEntity[]
  ): void {
    for (const patternEntry of patterns) {
      const pattern = patternEntry.regex;
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







