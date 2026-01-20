import { Injectable, Logger } from "@nestjs/common";
import { EvidenceChunk } from "../evidence/evidence-gate.service";
import {
  PatternEntry,
  DIAGNOSTIC_TEST_PATTERNS,
  WARNING_SIGN_PATTERNS,
  TIMELINE_PATTERNS,
  resetPatternIndices,
} from "./patterns/medical-entities";

// ============================================================================
// INTERFACES
// ============================================================================

export interface EvidenceAnchor {
  chunkId: string;
  docId: string;
  quote: string;           // ~20 words around the match
  chunkIndex: number;      // Order in which chunk was retrieved (for stable sorting)
  documentTitle: string;   // For display
  sourceType: string | null;
}

export interface ExtractedItem {
  key: string;              // canonical, e.g. "mri"
  label: string;            // display, e.g. "MRI"
  surfaceForms: string[];   // all detected forms, e.g. ["MRI", "MRI scan"]
  matchTokens: string[];    // tokens for normalized response matching
  evidence: EvidenceAnchor[];
  firstChunkIndex: number;  // For stable ordering
}

export interface TimelineItem {
  label: string;
  rawMatch: string;
  evidence: EvidenceAnchor | null;
}

export interface StructuredInfo {
  diagnosticTests: ExtractedItem[];
  warningSigns: ExtractedItem[];
  timeline: TimelineItem | null;  // null if not found (don't default)
  suggestedQuestions: string[];
}

export interface CompletenessPolicy {
  minDiagnosticTests: number;
  minWarningSigns: number;
  timelineRequired: boolean;
}

export interface MissingItems {
  diagnosticTests: ExtractedItem[];
  warningSigns: ExtractedItem[];
  timelineMissing: boolean;
}

export interface CompletenessResult {
  meetsPolicy: boolean;
  missing: MissingItems;
  coverage: {
    diagnosticTests: { found: number; required: number };
    warningSigns: { found: number; required: number };
    timeline: { found: boolean; required: boolean };
  };
}

// ============================================================================
// COMPLETENESS POLICIES BY QUERY TYPE
// ============================================================================

export const COMPLETENESS_POLICIES: Record<string, CompletenessPolicy> = {
  diagnosis: { minDiagnosticTests: 4, minWarningSigns: 4, timelineRequired: true },
  symptoms: { minDiagnosticTests: 2, minWarningSigns: 5, timelineRequired: true },
  screening: { minDiagnosticTests: 3, minWarningSigns: 3, timelineRequired: true },
  treatment: { minDiagnosticTests: 1, minWarningSigns: 2, timelineRequired: false },
  sideEffects: { minDiagnosticTests: 1, minWarningSigns: 2, timelineRequired: false },
  prevention: { minDiagnosticTests: 1, minWarningSigns: 2, timelineRequired: false },
  caregiver: { minDiagnosticTests: 1, minWarningSigns: 2, timelineRequired: false },
  navigation: { minDiagnosticTests: 1, minWarningSigns: 1, timelineRequired: false },
  general: { minDiagnosticTests: 2, minWarningSigns: 2, timelineRequired: false },
};

// Symptom qualifiers - broad symptoms require these nearby to count
const SYMPTOM_QUALIFIERS = /\b(persistent|unexplained|new|worsening|unusual|severe|chronic|ongoing|constant|recurring|sudden)\b/i;
const BROAD_SYMPTOM_KEYS = new Set(["pain", "fatigue", "fever", "bleeding", "discharge"]);

// ============================================================================
// SERVICE
// ============================================================================

@Injectable()
export class StructuredExtractorService {
  private readonly logger = new Logger(StructuredExtractorService.name);

  /**
   * Extract all structured entities from RAG chunks
   * Returns deterministically ordered results (by chunk order, then alpha)
   */
  extract(chunks: EvidenceChunk[], queryType?: string): StructuredInfo {
    const diagnosticTests = this.extractEntities(chunks, DIAGNOSTIC_TEST_PATTERNS, false);
    const warningSigns = this.extractEntities(chunks, WARNING_SIGN_PATTERNS, true);
    const timeline = this.extractFirstTimeline(chunks);

    // Generate suggested questions based on extracted entities
    const suggestedQuestions = this.generateQuestions(diagnosticTests, warningSigns, queryType);

    this.logger.debug(
      `Extracted: ${diagnosticTests.length} tests, ${warningSigns.length} warning signs, timeline=${timeline ? "found" : "null"}`
    );

    return {
      diagnosticTests,
      warningSigns,
      timeline,
      suggestedQuestions,
    };
  }

  /**
   * Extract entities using pattern entries, deduplicating by canonical key
   * Stable ordering: by first chunk appearance, then alphabetical
   */
  private extractEntities(
    chunks: EvidenceChunk[],
    patterns: PatternEntry[],
    requireQualifierForBroad: boolean
  ): ExtractedItem[] {
    const entityMap = new Map<string, ExtractedItem>();

    // Reset all regex lastIndex before extraction
    resetPatternIndices(patterns);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const content = chunk.content;

      for (const pattern of patterns) {
        // Reset for each chunk
        pattern.regex.lastIndex = 0;

        let match;
        while ((match = pattern.regex.exec(content)) !== null) {
          const surfaceForm = match[0].trim();

          // For broad symptoms, require a qualifier nearby (within 50 chars)
          if (requireQualifierForBroad && BROAD_SYMPTOM_KEYS.has(pattern.key)) {
            const contextStart = Math.max(0, match.index - 50);
            const contextEnd = Math.min(content.length, match.index + match[0].length + 50);
            const nearbyContext = content.slice(contextStart, contextEnd);
            if (!SYMPTOM_QUALIFIERS.test(nearbyContext)) {
              continue; // Skip broad symptom without qualifier
            }
          }

          const quote = this.extractWordQuote(content, match.index, match[0].length);

          const evidence: EvidenceAnchor = {
            chunkId: chunk.chunkId,
            docId: chunk.docId,
            quote,
            chunkIndex,
            documentTitle: chunk.document.title,
            sourceType: chunk.document.sourceType,
          };

          if (entityMap.has(pattern.key)) {
            // Merge: add surface form and evidence
            const existing = entityMap.get(pattern.key)!;
            if (!existing.surfaceForms.includes(surfaceForm)) {
              existing.surfaceForms.push(surfaceForm);
              // Add to match tokens
              existing.matchTokens.push(...this.generateMatchTokens(surfaceForm));
            }
            // Add evidence if from different chunk
            if (!existing.evidence.some(e => e.chunkId === chunk.chunkId)) {
              existing.evidence.push(evidence);
            }
          } else {
            // New entity
            const matchTokens = this.generateMatchTokens(pattern.label);
            matchTokens.push(...this.generateMatchTokens(surfaceForm));
            if (pattern.synonyms) {
              for (const syn of pattern.synonyms) {
                matchTokens.push(...this.generateMatchTokens(syn));
              }
            }

            entityMap.set(pattern.key, {
              key: pattern.key,
              label: pattern.label,
              surfaceForms: [surfaceForm],
              matchTokens: [...new Set(matchTokens)], // dedupe
              evidence: [evidence],
              firstChunkIndex: chunkIndex,
            });
          }
        }
      }
    }

    // Stable sort: by firstChunkIndex, then alphabetical by label
    return Array.from(entityMap.values()).sort((a, b) => {
      if (a.firstChunkIndex !== b.firstChunkIndex) {
        return a.firstChunkIndex - b.firstChunkIndex;
      }
      return a.label.localeCompare(b.label);
    });
  }

  /**
   * Generate match tokens for response checking
   * Handles variations like "CT scan", "CT", "ct_scan"
   */
  private generateMatchTokens(text: string): string[] {
    const normalized = this.normalizeForMatching(text);
    const tokens = [normalized];

    // Add individual words if multi-word
    const words = normalized.split(/\s+/).filter(w => w.length > 2);
    if (words.length > 1) {
      tokens.push(...words);
    }

    // Add without spaces
    tokens.push(normalized.replace(/\s+/g, ""));

    return tokens;
  }

  /**
   * Extract first timeline mention (return null if none found)
   */
  private extractFirstTimeline(chunks: EvidenceChunk[]): TimelineItem | null {
    resetPatternIndices(TIMELINE_PATTERNS);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];

      for (const pattern of TIMELINE_PATTERNS) {
        pattern.regex.lastIndex = 0;

        const match = pattern.regex.exec(chunk.content);
        if (match) {
          return {
            label: pattern.label,
            rawMatch: match[0].trim(),
            evidence: {
              chunkId: chunk.chunkId,
              docId: chunk.docId,
              quote: this.extractWordQuote(chunk.content, match.index, match[0].length),
              chunkIndex,
              documentTitle: chunk.document.title,
              sourceType: chunk.document.sourceType,
            },
          };
        }
      }
    }

    return null; // No timeline found - don't default
  }

  /**
   * Extract a quote using word boundaries (~20 words around match)
   */
  private extractWordQuote(content: string, matchIndex: number, matchLength: number): string {
    // Find word boundaries
    const words = content.split(/\s+/);
    let charCount = 0;
    let startWordIndex = 0;
    let endWordIndex = words.length - 1;

    // Find which word contains the match start
    for (let i = 0; i < words.length; i++) {
      const wordEnd = charCount + words[i].length;
      if (charCount <= matchIndex && matchIndex < wordEnd + 1) {
        startWordIndex = Math.max(0, i - 10); // 10 words before
        endWordIndex = Math.min(words.length - 1, i + 10); // 10 words after
        break;
      }
      charCount += words[i].length + 1; // +1 for space
    }

    return words.slice(startWordIndex, endWordIndex + 1).join(" ").trim();
  }

  /**
   * Generate suggested questions based on extracted entities
   */
  private generateQuestions(
    tests: ExtractedItem[],
    signs: ExtractedItem[],
    queryType?: string
  ): string[] {
    const questions: string[] = [];

    // Questions about tests
    if (tests.length > 0) {
      const testNames = tests.slice(0, 3).map(t => t.label).join(", ");
      questions.push(`What will the ${testNames} show?`);
      questions.push("How should I prepare for these tests?");
      questions.push("How long will it take to get results?");
    }

    // Questions about warning signs
    if (signs.length > 0) {
      questions.push("When should I seek immediate medical attention?");
      questions.push("Are there other symptoms I should watch for?");
    }

    // General questions
    questions.push("What are the next steps after diagnosis?");
    questions.push("Are there any lifestyle changes that might help?");

    return questions.slice(0, 7); // Cap at 7
  }

  /**
   * Check if LLM response meets completeness policy
   */
  checkCompleteness(
    responseText: string,
    extraction: StructuredInfo,
    queryType: string
  ): CompletenessResult {
    const policy = COMPLETENESS_POLICIES[queryType] || COMPLETENESS_POLICIES.general;
    const normalizedResponse = this.normalizeForMatching(responseText);

    // Find which extracted items are in the response
    const testsInResponse = extraction.diagnosticTests.filter(item =>
      this.isItemInResponse(normalizedResponse, item)
    );
    const signsInResponse = extraction.warningSigns.filter(item =>
      this.isItemInResponse(normalizedResponse, item)
    );
    const hasTimeline = extraction.timeline !== null &&
      normalizedResponse.includes(this.normalizeForMatching(extraction.timeline.rawMatch));

    // Calculate what's missing
    const missingTests = extraction.diagnosticTests.filter(item =>
      !this.isItemInResponse(normalizedResponse, item)
    );
    const missingSigns = extraction.warningSigns.filter(item =>
      !this.isItemInResponse(normalizedResponse, item)
    );

    // Check policy requirements (cap at what's available)
    const testsNeeded = Math.min(policy.minDiagnosticTests, extraction.diagnosticTests.length);
    const signsNeeded = Math.min(policy.minWarningSigns, extraction.warningSigns.length);

    const testsMet = testsInResponse.length >= testsNeeded;
    const signsMet = signsInResponse.length >= signsNeeded;
    const timelineMet = !policy.timelineRequired || hasTimeline || extraction.timeline === null;

    const meetsPolicy = testsMet && signsMet && timelineMet;

    return {
      meetsPolicy,
      missing: {
        diagnosticTests: testsMet ? [] : missingTests.slice(0, policy.minDiagnosticTests - testsInResponse.length),
        warningSigns: signsMet ? [] : missingSigns.slice(0, policy.minWarningSigns - signsInResponse.length),
        timelineMissing: policy.timelineRequired && !hasTimeline && extraction.timeline !== null,
      },
      coverage: {
        diagnosticTests: { found: testsInResponse.length, required: testsNeeded },
        warningSigns: { found: signsInResponse.length, required: signsNeeded },
        timeline: { found: hasTimeline, required: policy.timelineRequired },
      },
    };
  }

  /**
   * Check if an extracted item appears in the response using matchTokens
   */
  private isItemInResponse(normalizedResponse: string, item: ExtractedItem): boolean {
    // Check any match token
    for (const token of item.matchTokens) {
      if (normalizedResponse.includes(token)) {
        return true;
      }
    }

    // Check canonical key (with underscores converted to spaces)
    if (normalizedResponse.includes(item.key.replace(/_/g, " "))) {
      return true;
    }

    return false;
  }

  /**
   * Normalize text for matching (lowercase, remove punctuation, collapse whitespace)
   */
  private normalizeForMatching(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Generate fallback content to fill gaps in LLM response
   */
  generateFallbackContent(missing: MissingItems, extraction: StructuredInfo): string {
    const sections: string[] = [];

    if (missing.diagnosticTests.length > 0) {
      sections.push("\n**Additional tests your doctor may recommend:**");
      for (const test of missing.diagnosticTests.slice(0, 5)) {
        const ev = test.evidence[0];
        sections.push(`- ${test.label} [citation:${ev.docId}:${ev.chunkId}]`);
      }
    }

    if (missing.warningSigns.length > 0) {
      sections.push("\n**Additional warning signs to be aware of:**");
      for (const sign of missing.warningSigns.slice(0, 5)) {
        const ev = sign.evidence[0];
        sections.push(`- ${sign.label} [citation:${ev.docId}:${ev.chunkId}]`);
      }
    }

    if (missing.timelineMissing && extraction.timeline !== null && extraction.timeline.evidence) {
      const ev = extraction.timeline.evidence;
      sections.push(
        `\n**When to seek care:** ${extraction.timeline.rawMatch} [citation:${ev.docId}:${ev.chunkId}]`
      );
    }

    return sections.join("\n");
  }

  /**
   * Format extracted info as a checklist for LLM prompt
   * Softer language - instructs model to cover items but doesn't say "INVALID"
   */
  formatForPrompt(extraction: StructuredInfo): string {
    const sections: string[] = [];

    if (extraction.diagnosticTests.length > 0) {
      sections.push("DIAGNOSTIC TESTS FOUND IN SOURCES (cover these in your response):");
      for (const test of extraction.diagnosticTests.slice(0, 6)) {
        const ev = test.evidence[0];
        sections.push(`- ${test.label} [citation:${ev.docId}:${ev.chunkId}]`);
      }
      sections.push("");
    }

    if (extraction.warningSigns.length > 0) {
      sections.push("WARNING SIGNS FOUND IN SOURCES (cover these in your response):");
      for (const sign of extraction.warningSigns.slice(0, 6)) {
        const ev = sign.evidence[0];
        sections.push(`- ${sign.label} [citation:${ev.docId}:${ev.chunkId}]`);
      }
      sections.push("");
    }

    if (extraction.timeline !== null && extraction.timeline.evidence) {
      const ev = extraction.timeline.evidence;
      sections.push(`TIMELINE FOUND IN SOURCES: "${extraction.timeline.rawMatch}" [citation:${ev.docId}:${ev.chunkId}]`);
      sections.push("");
    }

    if (extraction.suggestedQuestions.length > 0) {
      sections.push("SUGGESTED QUESTIONS FOR \"QUESTIONS TO ASK YOUR DOCTOR\" SECTION:");
      for (const q of extraction.suggestedQuestions.slice(0, 5)) {
        sections.push(`- ${q}`);
      }
      sections.push("");
    }

    if (sections.length > 0) {
      sections.unshift("=== PRE-EXTRACTED CHECKLIST ===\n");
      sections.push("You must cover every checklist item above. If you cannot find support for an item in the references, say so explicitly and do not invent it.");
      sections.push("=== END CHECKLIST ===\n");
    }

    return sections.join("\n");
  }

  /**
   * Get the appropriate policy for a query type
   */
  getPolicy(queryType: string): CompletenessPolicy {
    return COMPLETENESS_POLICIES[queryType] || COMPLETENESS_POLICIES.general;
  }
}
