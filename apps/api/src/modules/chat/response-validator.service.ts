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

    // Combine all chunk content for searching.
    //
    // Whitespace is collapsed to single spaces on BOTH sides of the comparison
    // (here and on the extracted entity). Source chunks are markdown and the
    // model's draft is line-wrapped, so an entity like "radiation therapy"
    // routinely matches across a newline in one and a single space in the
    // other. Comparing raw text made that a spurious "ungrounded entity" and
    // blanked the whole answer — see #167.
    const allChunkContent = this.normalizeWhitespace(
      retrievedChunks.map(chunk => chunk.content).join(" ")
    ).toLowerCase();

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
        const entity = this.normalizeWhitespace(match[0]);

        if (this.isGrounded(entity, patternEntry, allChunkContent)) {
          continue;
        }

        // Get context around the match (50 chars before and after)
        const start = Math.max(0, match.index - 50);
        const end = Math.min(responseText.length, match.index + match[0].length + 50);
        const context = this.normalizeWhitespace(responseText.substring(start, end));

        ungroundedEntities.push({
          type,
          entity,
          context
        });
      }
    }
  }

  /**
   * Decide whether an entity the model used is backed by the retrieved chunks.
   *
   * The gate's job is to catch a medical entity the evidence never mentions
   * (#166). It is NOT meant to demand that the model echo the source's exact
   * wording: requiring a verbatim surface match made the gate fire on
   * "radiation therapy" when the chunk said "radiation", on "tumor markers"
   * when the chunk said "tumor marker", and on "CT scan" when the chunk said
   * "CT" — each of which blanked an otherwise well-grounded answer (#167).
   *
   * Grounding is therefore checked at the level of the ENTITY CONCEPT, using
   * the very same detector on both sides:
   *
   *   1. the normalized surface string appears in the chunks, or
   *   2. the pattern's canonical label appears in the chunks, or
   *   3. one of the pattern's declared synonyms appears in the chunks, or
   *   4. the pattern that fired on the response also fires on the chunks.
   *
   * (4) is the symmetric check and is what makes the gate wording-insensitive.
   * It cannot manufacture grounding: if no chunk mentions the concept in ANY
   * form the pattern recognises, the entity stays ungrounded and the caller
   * abstains. With zero retrieved chunks every entity is ungrounded, which is
   * exactly the behaviour #166 depends on.
   *
   * Value-bearing patterns (`stage IV`, `18% survival`) opt out of (4): for
   * those, evidence about a DIFFERENT value must not ground the claim, so only
   * an exact surface match counts.
   */
  private isGrounded(
    entity: string,
    patternEntry: PatternEntry,
    allChunkContent: string
  ): boolean {
    if (!allChunkContent) {
      return false;
    }

    const entityLower = entity.toLowerCase();

    // (1) Exact (whitespace-normalized) surface form.
    if (this.containsTerm(allChunkContent, entityLower)) {
      return true;
    }

    // Value-bearing entities must match verbatim — no concept-level fallback.
    if (patternEntry.valueBearing) {
      return false;
    }

    // (2) Canonical label for this pattern.
    if (this.containsTerm(allChunkContent, patternEntry.label.toLowerCase())) {
      return true;
    }

    // (3) Declared synonyms ("radiotherapy" for radiation therapy, etc.).
    for (const synonym of patternEntry.synonyms ?? []) {
      if (this.containsTerm(allChunkContent, synonym.toLowerCase())) {
        return true;
      }
    }

    // (4) Same detector, run over the evidence.
    return this.patternMatchesChunks(patternEntry, allChunkContent);
  }

  /**
   * Word-boundary containment test for a literal term.
   *
   * `\b` is only applied where the adjacent character is a word character —
   * a term such as "ca 19-9" or "18%" ends in a non-word character, and an
   * unconditional trailing `\b` would never match there.
   */
  private containsTerm(haystack: string, term: string): boolean {
    if (!term) {
      return false;
    }
    const leading = /^\w/.test(term) ? "\\b" : "";
    const trailing = /\w$/.test(term) ? "\\b" : "";
    return new RegExp(`${leading}${this.escapeRegex(term)}${trailing}`, "i").test(haystack);
  }

  /**
   * Run a pattern over the chunk text without disturbing the shared registry's
   * regex state. The PatternEntry regexes are module-level singletons carrying
   * the `g` flag, so `lastIndex` is rebuilt on a private copy rather than
   * mutated here — otherwise this probe would silently skip matches in the
   * extraction loop that is iterating the same object.
   */
  private patternMatchesChunks(patternEntry: PatternEntry, allChunkContent: string): boolean {
    const probe = this.probeCache.get(patternEntry.key) ??
      new RegExp(patternEntry.regex.source, patternEntry.regex.flags.replace(/g/g, ""));
    this.probeCache.set(patternEntry.key, probe);
    return probe.test(allChunkContent);
  }

  /** Non-global copies of the registry regexes, built lazily. */
  private readonly probeCache = new Map<string, RegExp>();

  /** Collapse every run of whitespace (including newlines) to a single space. */
  private normalizeWhitespace(str: string): string {
    return str.replace(/\s+/g, " ").trim();
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







