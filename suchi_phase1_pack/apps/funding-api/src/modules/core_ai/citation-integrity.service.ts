/**
 * FundingBot Citation Policy v1 Implementation
 *
 * Primary objective: Prevent false authority by ensuring the bot never attaches
 * citations that are not supported by retrieved evidence, while still allowing
 * legitimate creative/synthetic fundraising writing.
 *
 * Rules enforced:
 * A) Citation Integrity - every citation must map to a retrieved chunk
 * B) Zero-evidence guard - no citations allowed when evidence set is empty
 * C) Hard-claim compliance - hard claims need citation OR placeholder OR softening
 * D) Citation not required everywhere - absence of citations is OK if no hard claims
 */

import { Injectable, Logger } from "@nestjs/common";

// Citation format: [[CIT:<chunkId>]]
const CITATION_REGEX = /\[\[CIT:([a-zA-Z0-9_\-:.]+)\]\]/g;

// Legacy citation format for backwards compatibility: [citation:docId:chunkId]
const LEGACY_CITATION_REGEX = /\[citation:([^:\]]+):([^\]]+)\]/g;

// Placeholder patterns (case-insensitive)
const PLACEHOLDER_PATTERNS = [
  /\[Insert[^\]]+\]/gi,
  /\[(Donor|Funder|Org|Organization|Project|Programme|Program|Date|Location|Budget|Amount|Metric|Your Name|Name|Contact|Deadline|Phone|Email|Address|Title|Position)[^\]]*\]/gi,
  /\bTODO\([^)]*\)/gi,
  /\bTBD\([^)]*\)/gi,
  /\bTODO\b/gi,
  /\bTBD\b/gi,
  /\(insert[^)]*\)/gi,
];

// Hard claim trigger patterns
const NUMERIC_TRIGGERS = [
  /\b\d[\d,]*(\.\d+)?\s*(children|students|learners|teachers|schools|districts|villages|families|beneficiaries|participants|members|people|women|men|youth|girls|boys)/gi,
  /\b\d[\d,]*(\.\d+)?%/g,
  /\b(percent|percentage)\b/gi,
  /₹[\d,]+/g,
  /\b(INR|USD|Rs\.?)\s*[\d,]+/gi,
  /\b\d+\s*(crore|lakh|million|billion|thousand)\b/gi,
];

const IMPACT_VERB_PATTERNS = [
  /\b(served|reached|trained|enrolled|graduated|improved|increased|reduced|delivered|screened|supported|impacted|empowered|transformed)\s+(\d[\d,]*|over|more than|approximately|nearly|almost)/gi,
  /\b(served|reached|trained|enrolled|graduated|improved|increased|reduced|delivered|screened|supported|impacted)\s+(children|students|learners|teachers|schools|districts|villages|families|beneficiaries|participants)/gi,
];

const COMPARATIVE_PATTERNS = [
  /\b(more effective|most effective|best|largest|only|first|leading|top|highest|lowest|unique|unprecedented)\b/gi,
];

const RFP_REQUIREMENT_PATTERNS = [
  /\b(deadline|due date|submission date)\s*(is|:|of)?\s*\d/gi,
  /\b(eligib|budget cap|maximum budget|grant amount|funding limit)\b/gi,
  /\b(must|required to|mandatory|shall)\s+(submit|include|provide|demonstrate)/gi,
];

const NAMED_RELATIONSHIP_PATTERNS = [
  /\b(funded by|supported by|partnered with|in partnership with|in collaboration with|working with)\s+[A-Z][a-zA-Z\s&]+/g,
];

export type ViolationCode =
  | "INVALID_CITATION"
  | "CITATION_WITH_NO_EVIDENCE"
  | "HARD_CLAIM_UNSUPPORTED"
  | "CITATION_ALIGNMENT_WEAK";

export type ViolationSeverity = "fatal" | "warn";

export interface CitationViolation {
  code: ViolationCode;
  severity: ViolationSeverity;
  message: string;
  span?: { start: number; end: number };
  meta?: Record<string, unknown>;
}

export interface CitationIntegrityStats {
  evidenceCount: number;
  citationCount: number;
  invalidCitationCount: number;
  hardClaimCount: number;
  unsupportedHardClaimCount: number;
  placeholderCount: number;
  citationAlignmentWeakCount: number;
}

export interface CitationIntegrityResult {
  ok: boolean;
  violations: CitationViolation[];
  stats: CitationIntegrityStats;
  hardClaims: Array<{ text: string; start: number; end: number; hasCitation: boolean; hasPlaceholder: boolean }>;
  citations: Array<{ chunkId: string; valid: boolean; start: number; end: number }>;
  placeholders: Array<{ text: string; start: number; end: number }>;
}

export interface EvidenceChunk {
  chunkId: string;
  docId?: string;
  content: string;
  source?: string;
}

export type EnforcementMode = "strict" | "sanitize";

@Injectable()
export class CitationIntegrityService {
  private readonly logger = new Logger(CitationIntegrityService.name);

  /**
   * Validate text against citation integrity policy
   */
  validate(
    text: string,
    evidenceChunks: EvidenceChunk[],
    options: { mode?: EnforcementMode; taskRequiresEvidence?: boolean } = {}
  ): CitationIntegrityResult {
    const { mode = "strict", taskRequiresEvidence = false } = options;

    const validChunkIds = new Set<string>();
    for (const chunk of evidenceChunks) {
      validChunkIds.add(chunk.chunkId);
      // Also add combined docId:chunkId for legacy format
      if (chunk.docId) {
        validChunkIds.add(`${chunk.docId}:${chunk.chunkId}`);
      }
    }

    const violations: CitationViolation[] = [];
    const citations = this.extractCitations(text, validChunkIds);
    const placeholders = this.extractPlaceholders(text);
    const hardClaims = this.detectHardClaims(text);

    const stats: CitationIntegrityStats = {
      evidenceCount: evidenceChunks.length,
      citationCount: citations.length,
      invalidCitationCount: 0,
      hardClaimCount: hardClaims.length,
      unsupportedHardClaimCount: 0,
      placeholderCount: placeholders.length,
      citationAlignmentWeakCount: 0,
    };

    // Rule A: Citation Integrity - every citation must map to a retrieved chunk
    for (const cit of citations) {
      if (!cit.valid) {
        stats.invalidCitationCount++;
        violations.push({
          code: "INVALID_CITATION",
          severity: "fatal",
          message: `Citation [[CIT:${cit.chunkId}]] does not match any retrieved chunk`,
          span: { start: cit.start, end: cit.end },
          meta: { chunkId: cit.chunkId },
        });
      }
    }

    // Rule B: Zero-evidence guard
    if (evidenceChunks.length === 0 && citations.length > 0) {
      violations.push({
        code: "CITATION_WITH_NO_EVIDENCE",
        severity: "fatal",
        message: `${citations.length} citation(s) found but no evidence was retrieved`,
        meta: { citationCount: citations.length },
      });
    }

    // Rule C: Hard-claim compliance
    for (const claim of hardClaims) {
      const hasCitation = this.textHasCitationInRange(text, citations, claim.start, claim.end);
      const hasPlaceholder = this.textHasPlaceholderInRange(placeholders, claim.start, claim.end);
      claim.hasCitation = hasCitation;
      claim.hasPlaceholder = hasPlaceholder;

      if (!hasCitation && !hasPlaceholder) {
        stats.unsupportedHardClaimCount++;
        violations.push({
          code: "HARD_CLAIM_UNSUPPORTED",
          severity: evidenceChunks.length === 0 ? "fatal" : "warn",
          message: `Hard claim without citation or placeholder: "${claim.text.substring(0, 80)}..."`,
          span: { start: claim.start, end: claim.end },
          meta: { claimText: claim.text },
        });
      }
    }

    // Optional: Citation alignment check (weak alignment detection)
    for (const cit of citations.filter((c) => c.valid)) {
      const alignmentScore = this.checkCitationAlignment(text, cit, evidenceChunks);
      if (alignmentScore < 0.1) {
        stats.citationAlignmentWeakCount++;
        violations.push({
          code: "CITATION_ALIGNMENT_WEAK",
          severity: "warn",
          message: `Citation [[CIT:${cit.chunkId}]] has weak alignment with surrounding text`,
          span: { start: cit.start, end: cit.end },
          meta: { chunkId: cit.chunkId, alignmentScore },
        });
      }
    }

    const fatalViolations = violations.filter((v) => v.severity === "fatal");
    const ok = fatalViolations.length === 0;

    return {
      ok,
      violations,
      stats,
      hardClaims,
      citations,
      placeholders,
    };
  }

  /**
   * Extract all citation tokens from text
   */
  private extractCitations(
    text: string,
    validChunkIds: Set<string>
  ): Array<{ chunkId: string; valid: boolean; start: number; end: number }> {
    const citations: Array<{ chunkId: string; valid: boolean; start: number; end: number }> = [];

    // New format: [[CIT:<chunkId>]]
    let match: RegExpExecArray | null;
    const newRegex = new RegExp(CITATION_REGEX.source, "g");
    while ((match = newRegex.exec(text)) !== null) {
      const chunkId = match[1];
      citations.push({
        chunkId,
        valid: validChunkIds.has(chunkId),
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    // Legacy format: [citation:docId:chunkId]
    const legacyRegex = new RegExp(LEGACY_CITATION_REGEX.source, "g");
    while ((match = legacyRegex.exec(text)) !== null) {
      const docId = match[1];
      const chunkId = match[2];
      const combinedId = `${docId}:${chunkId}`;
      citations.push({
        chunkId: combinedId,
        valid: validChunkIds.has(combinedId) || validChunkIds.has(chunkId),
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return citations;
  }

  /**
   * Extract all placeholder tokens from text
   */
  private extractPlaceholders(text: string): Array<{ text: string; start: number; end: number }> {
    const placeholders: Array<{ text: string; start: number; end: number }> = [];
    const seen = new Set<string>(); // Avoid duplicates from overlapping patterns

    for (const pattern of PLACEHOLDER_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const key = `${match.index}:${match[0]}`;
        if (!seen.has(key)) {
          seen.add(key);
          placeholders.push({
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
          });
        }
      }
    }

    return placeholders.sort((a, b) => a.start - b.start);
  }

  /**
   * Detect hard claims in text
   */
  private detectHardClaims(
    text: string
  ): Array<{ text: string; start: number; end: number; hasCitation: boolean; hasPlaceholder: boolean }> {
    const sentences = this.splitIntoSentences(text);
    const hardClaims: Array<{ text: string; start: number; end: number; hasCitation: boolean; hasPlaceholder: boolean }> = [];

    for (const sentence of sentences) {
      if (this.isHardClaim(sentence.text)) {
        hardClaims.push({
          text: sentence.text,
          start: sentence.start,
          end: sentence.end,
          hasCitation: false,
          hasPlaceholder: false,
        });
      }
    }

    return hardClaims;
  }

  /**
   * Check if a sentence is a hard claim
   */
  private isHardClaim(sentence: string): boolean {
    // Skip if it's clearly a plan/intent statement
    if (/\b(we will|we propose|we plan|we intend|we aim|proposed|planned)\b/i.test(sentence)) {
      // But still check if it has metrics (e.g., "We will serve 10,000 children" is still a hard claim)
      const hasMetrics = NUMERIC_TRIGGERS.some((p) => new RegExp(p.source, p.flags).test(sentence));
      if (!hasMetrics) return false;
    }

    // Check numeric triggers
    for (const pattern of NUMERIC_TRIGGERS) {
      if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
        return true;
      }
    }

    // Check impact verbs with quantities
    for (const pattern of IMPACT_VERB_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
        return true;
      }
    }

    // Check comparatives/superlatives
    for (const pattern of COMPARATIVE_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
        return true;
      }
    }

    // Check RFP requirement patterns
    for (const pattern of RFP_REQUIREMENT_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
        return true;
      }
    }

    // Check named relationships
    for (const pattern of NAMED_RELATIONSHIP_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Split text into sentences with positions
   */
  private splitIntoSentences(text: string): Array<{ text: string; start: number; end: number }> {
    const sentences: Array<{ text: string; start: number; end: number }> = [];
    // Simple sentence splitter - handles . ! ? followed by space/newline
    const regex = /[^.!?\n]+[.!?\n]*/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const sentenceText = match[0].trim();
      if (sentenceText.length > 0) {
        sentences.push({
          text: sentenceText,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
    return sentences;
  }

  /**
   * Check if a text range has a citation
   */
  private textHasCitationInRange(
    _text: string,
    citations: Array<{ chunkId: string; valid: boolean; start: number; end: number }>,
    rangeStart: number,
    rangeEnd: number
  ): boolean {
    return citations.some(
      (c) => c.valid && c.start >= rangeStart && c.end <= rangeEnd + 50 // Allow citation slightly after sentence
    );
  }

  /**
   * Check if a text range has a placeholder
   */
  private textHasPlaceholderInRange(
    placeholders: Array<{ text: string; start: number; end: number }>,
    rangeStart: number,
    rangeEnd: number
  ): boolean {
    return placeholders.some((p) => p.start >= rangeStart && p.end <= rangeEnd);
  }

  /**
   * Check citation alignment with surrounding text (simple keyword overlap)
   */
  private checkCitationAlignment(
    text: string,
    citation: { chunkId: string; start: number; end: number },
    evidenceChunks: EvidenceChunk[]
  ): number {
    const chunk = evidenceChunks.find(
      (c) => c.chunkId === citation.chunkId || `${c.docId}:${c.chunkId}` === citation.chunkId
    );
    if (!chunk) return 0;

    // Get surrounding sentence (100 chars before and after citation)
    const contextStart = Math.max(0, citation.start - 100);
    const contextEnd = Math.min(text.length, citation.end + 100);
    const context = text.substring(contextStart, contextEnd).toLowerCase();

    // Extract keywords from chunk content
    const chunkWords = new Set(
      chunk.content
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3)
    );

    // Extract keywords from context
    const contextWords = context.split(/\W+/).filter((w) => w.length > 3);

    // Calculate overlap
    const overlap = contextWords.filter((w) => chunkWords.has(w)).length;
    const score = contextWords.length > 0 ? overlap / contextWords.length : 0;

    return score;
  }

  /**
   * Sanitize text by removing invalid citations (for production use)
   */
  sanitize(text: string, evidenceChunks: EvidenceChunk[]): { text: string; removedCitations: string[] } {
    const validChunkIds = new Set<string>();
    for (const chunk of evidenceChunks) {
      validChunkIds.add(chunk.chunkId);
      if (chunk.docId) {
        validChunkIds.add(`${chunk.docId}:${chunk.chunkId}`);
      }
    }

    const removedCitations: string[] = [];

    // Remove invalid new-format citations
    let sanitized = text.replace(CITATION_REGEX, (match, chunkId) => {
      if (!validChunkIds.has(chunkId)) {
        removedCitations.push(match);
        return "";
      }
      return match;
    });

    // Remove invalid legacy citations
    sanitized = sanitized.replace(LEGACY_CITATION_REGEX, (match, docId, chunkId) => {
      const combinedId = `${docId}:${chunkId}`;
      if (!validChunkIds.has(combinedId) && !validChunkIds.has(chunkId)) {
        removedCitations.push(match);
        return "";
      }
      return match;
    });

    // Clean up double spaces from removed citations
    sanitized = sanitized.replace(/  +/g, " ").trim();

    return { text: sanitized, removedCitations };
  }
}
