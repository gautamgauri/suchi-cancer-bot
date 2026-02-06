/**
 * Citation Integrity Validator for funding-eval
 * Mirrors the API's citation-integrity.service.ts for local validation
 *
 * FundingBot Citation Policy v1:
 * - No bullshit citations (every citation must map to retrieved evidence)
 * - Hard claims need citation OR placeholder OR softening
 * - Zero evidence = no citations allowed
 */

// Citation format: [[CIT:<chunkId>]] (new) or [citation:docId:chunkId] (legacy)
const NEW_CITATION_REGEX = /\[\[CIT:([a-zA-Z0-9_\-:.]+)\]\]/g;
const LEGACY_CITATION_REGEX = /\[citation:([^:\]]+):([^\]]+)\]/g;

// Placeholder patterns
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

// Patterns that indicate plan/intent statements (exempt from hard-claim rules)
const PLAN_EXEMPT_PATTERNS = [
  /^Month \d+:/i,           // Timeline milestones
  /^\*?\s*\*?\*?Month \d+/i, // Markdown formatted timeline
  /\b(target|goal|objective|milestone)\b/i,
  /\b(by the end of|at month|in phase)\b/i,
];

export interface EvidenceChunk {
  id: string;
  source?: string;
  text?: string;
  chunkId?: string;
  docId?: string;
}

export interface CitationIntegrityResult {
  ok: boolean;
  invalidCitationCount: number;
  hardClaimCount: number;
  unsupportedHardClaimCount: number;
  placeholderCount: number;
  citationCount: number;
  violations: string[];
}

/**
 * Extract all citation tokens from text
 */
function extractCitations(text: string): Array<{ chunkId: string; start: number; end: number }> {
  const citations: Array<{ chunkId: string; start: number; end: number }> = [];

  // New format: [[CIT:<chunkId>]]
  let match: RegExpExecArray | null;
  const newRegex = new RegExp(NEW_CITATION_REGEX.source, "g");
  while ((match = newRegex.exec(text)) !== null) {
    citations.push({
      chunkId: match[1],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Legacy format: [citation:docId:chunkId]
  const legacyRegex = new RegExp(LEGACY_CITATION_REGEX.source, "g");
  while ((match = legacyRegex.exec(text)) !== null) {
    const docId = match[1];
    const chunkId = match[2];
    citations.push({
      chunkId: `${docId}:${chunkId}`,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return citations;
}

/**
 * Extract all placeholder tokens from text
 */
function extractPlaceholders(text: string): Array<{ text: string; start: number; end: number }> {
  const placeholders: Array<{ text: string; start: number; end: number }> = [];
  const seen = new Set<string>();

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
 * Split text into sentences
 */
function splitIntoSentences(text: string): Array<{ text: string; start: number; end: number }> {
  const sentences: Array<{ text: string; start: number; end: number }> = [];
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
 * Check if a sentence is exempt (plan/timeline statement)
 */
function isExemptPlanStatement(sentence: string): boolean {
  return PLAN_EXEMPT_PATTERNS.some((p) => p.test(sentence));
}

/**
 * Check if a sentence is a hard claim
 */
function isHardClaim(sentence: string): boolean {
  // Skip plan/timeline statements entirely
  if (isExemptPlanStatement(sentence)) return false;

  // Skip if it's clearly a plan/intent statement (unless it has metrics)
  if (/\b(we will|we propose|we plan|we intend|we aim|proposed|planned)\b/i.test(sentence)) {
    const hasMetrics = NUMERIC_TRIGGERS.some((p) => new RegExp(p.source, p.flags).test(sentence));
    if (!hasMetrics) return false;
  }

  // Check all trigger patterns
  const allPatterns = [
    ...NUMERIC_TRIGGERS,
    ...IMPACT_VERB_PATTERNS,
    ...COMPARATIVE_PATTERNS,
    ...RFP_REQUIREMENT_PATTERNS,
    ...NAMED_RELATIONSHIP_PATTERNS,
  ];

  for (const pattern of allPatterns) {
    if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a range has a citation nearby
 */
function hasCitationInRange(
  citations: Array<{ chunkId: string; start: number; end: number }>,
  rangeStart: number,
  rangeEnd: number,
  validChunkIds: Set<string>
): boolean {
  return citations.some(
    (c) => validChunkIds.has(c.chunkId) && c.start >= rangeStart && c.end <= rangeEnd + 50
  );
}

/**
 * Check if a range has a placeholder
 */
function hasPlaceholderInRange(
  placeholders: Array<{ text: string; start: number; end: number }>,
  rangeStart: number,
  rangeEnd: number
): boolean {
  return placeholders.some((p) => p.start >= rangeStart && p.end <= rangeEnd);
}

/**
 * Validate text against citation integrity policy
 */
export function validateCitationIntegrity(
  text: string,
  evidenceChunks: EvidenceChunk[] = []
): CitationIntegrityResult {
  const violations: string[] = [];

  // Build valid chunk ID set
  const validChunkIds = new Set<string>();
  for (const chunk of evidenceChunks) {
    if (chunk.id) validChunkIds.add(chunk.id);
    if (chunk.chunkId) validChunkIds.add(chunk.chunkId);
    if (chunk.docId && chunk.chunkId) {
      validChunkIds.add(`${chunk.docId}:${chunk.chunkId}`);
    }
    if (chunk.source && chunk.id) {
      validChunkIds.add(`${chunk.source}:${chunk.id}`);
    }
  }

  const citations = extractCitations(text);
  const placeholders = extractPlaceholders(text);
  const sentences = splitIntoSentences(text);

  // Count invalid citations
  let invalidCitationCount = 0;
  for (const cit of citations) {
    if (!validChunkIds.has(cit.chunkId)) {
      invalidCitationCount++;
      violations.push(`INVALID_CITATION: ${cit.chunkId} not in evidence set`);
    }
  }

  // Rule B: Zero-evidence guard
  if (evidenceChunks.length === 0 && citations.length > 0) {
    violations.push(`CITATION_WITH_NO_EVIDENCE: ${citations.length} citations but no evidence`);
  }

  // Detect hard claims
  const hardClaims: Array<{ text: string; start: number; end: number }> = [];
  for (const sentence of sentences) {
    if (isHardClaim(sentence.text)) {
      hardClaims.push(sentence);
    }
  }

  // Count unsupported hard claims
  let unsupportedHardClaimCount = 0;
  for (const claim of hardClaims) {
    const hasCitation = hasCitationInRange(citations, claim.start, claim.end, validChunkIds);
    const hasPlaceholder = hasPlaceholderInRange(placeholders, claim.start, claim.end);

    if (!hasCitation && !hasPlaceholder) {
      unsupportedHardClaimCount++;
      violations.push(`HARD_CLAIM_UNSUPPORTED: "${claim.text.substring(0, 60)}..."`);
    }
  }

  // Determine if OK based on fatal violations
  const hasFatalViolations =
    invalidCitationCount > 0 ||
    (evidenceChunks.length === 0 && citations.length > 0);

  return {
    ok: !hasFatalViolations,
    invalidCitationCount,
    hardClaimCount: hardClaims.length,
    unsupportedHardClaimCount,
    placeholderCount: placeholders.length,
    citationCount: citations.length,
    violations,
  };
}

/**
 * Check if text has any placeholder
 */
export function hasPlaceholder(text: string): boolean {
  return extractPlaceholders(text).length > 0;
}

/**
 * Count citations in text (both formats)
 */
export function countCitations(text: string): number {
  return extractCitations(text).length;
}

/**
 * Check if text contains abstention marker
 */
export function hasAbstain(text: string): boolean {
  return text.includes("MISSING_EVIDENCE");
}
