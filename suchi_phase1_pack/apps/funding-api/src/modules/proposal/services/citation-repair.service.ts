import { Injectable, Logger } from "@nestjs/common";

/**
 * Citation Repair Service
 *
 * Implements Citation Policy v1 auto-repair:
 * - Softens unsupported comparative claims ("proven" → "evidence-based")
 * - Adds placeholders for unsupported numeric claims
 * - Exempts plan/intent statements from hard-claim detection
 */

// Soften rules: comparative → neutral language
const SOFTEN_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bproven\b/gi, replacement: "evidence-based" },
  { pattern: /\bproven track record\b/gi, replacement: "demonstrated experience" },
  { pattern: /\blargest\b/gi, replacement: "primary" },
  { pattern: /\bhighest\b/gi, replacement: "substantial" },
  { pattern: /\bbest practice/gi, replacement: "recommended practice" },
  { pattern: /\bbest-in-class\b/gi, replacement: "high-quality" },
  { pattern: /\buniquely effective\b/gi, replacement: "designed to be effective" },
  { pattern: /\bmost effective\b/gi, replacement: "highly effective" },
  { pattern: /\bonly organization\b/gi, replacement: "one of the organizations" },
  { pattern: /\bnot only\b/gi, replacement: "not just" },  // "not only X but also Y"
  { pattern: /\bthe only\b/gi, replacement: "a key" },
  { pattern: /\bfirst to\b/gi, replacement: "among those who" },
  { pattern: /\bthe first\b/gi, replacement: "an initial" },
  { pattern: /\bleading\b/gi, replacement: "established" },
  { pattern: /\btop\b(?=\s+(organization|partner|funder|foundation))/gi, replacement: "prominent" },
  { pattern: /\bunprecedented\b/gi, replacement: "significant" },
  { pattern: /\bdeep expertise\b/gi, replacement: "substantial experience" },
];

// Patterns that indicate plan/intent statements (exempt from hard-claim rules)
const PLAN_EXEMPT_PATTERNS = [
  /^Month \d+:/i,           // Timeline milestones
  /^\*?\s*\*?\*?Month \d+/i, // Markdown formatted timeline
  /\b(will|shall|plan to|aim to|intend to|propose to|expect to)\b/i,
  /\b(target|goal|objective|milestone)\b/i,
  /\b(by the end of|at month|in phase)\b/i,
  /\d+%\s*of\s*(budget|funding|grant|allocation)/i, // Budget allocations
  /\bbudget line\b/i,       // Budget descriptions
  /\bwe will monitor\b/i,   // Monitoring plans
  /\bwe will track\b/i,     // Tracking plans
  /\bindicators such as\b/i, // Indicator descriptions
];

// Hard claim patterns (for detection)
const NUMERIC_PATTERNS = [
  /\b\d[\d,]*(\.\d+)?\s*(children|students|learners|teachers|schools|districts|villages|families|beneficiaries|participants|members|people|women|men|youth|girls|boys)/gi,
  /\b\d[\d,]*(\.\d+)?%/g,
  /₹[\d,]+/g,
  /\b(INR|USD|Rs\.?)\s*[\d,]+/gi,
  /\b\d+\s*(crore|lakh|million|billion|thousand)\b/gi,
];

const IMPACT_VERB_PATTERNS = [
  /\b(served|reached|trained|enrolled|graduated|improved|increased|reduced|delivered|screened|supported|impacted|empowered|transformed)\s+(\d[\d,]*|over|more than|approximately|nearly|almost)/gi,
];

const COMPARATIVE_PATTERNS = [
  /\b(more effective|most effective|best|largest|only|first|leading|top|highest|lowest|unique|unprecedented|proven|deep expertise|uniquely)\b/gi,
];

const NAMED_RELATIONSHIP_PATTERNS = [
  /\b(funded by|supported by|partnered with|in partnership with|in collaboration with|working with)\s+[A-Z][a-zA-Z\s&]+/g,
];

export interface RepairResult {
  original: string;
  repaired: string;
  changes: Array<{
    type: "soften" | "placeholder";
    original: string;
    replacement: string;
    sentence: string;
  }>;
  stats: {
    hardClaimsDetected: number;
    unsupportedBefore: number;
    unsupportedAfter: number;
    softened: number;
    placeholdered: number;
  };
}

@Injectable()
export class CitationRepairService {
  private readonly logger = new Logger(CitationRepairService.name);

  /**
   * Check if a sentence is exempt (plan/intent statement)
   */
  private isExemptPlanStatement(sentence: string): boolean {
    return PLAN_EXEMPT_PATTERNS.some(p => p.test(sentence));
  }

  /**
   * Check if sentence has a citation
   */
  private hasCitation(sentence: string): boolean {
    return /\[citation:[^\]]+\]/.test(sentence);
  }

  /**
   * Check if sentence has a placeholder
   */
  private hasPlaceholder(sentence: string): boolean {
    return /\{\{MISSING:[^}]+\}\}|\[Insert[^\]]+\]|\[Target:[^\]]+\]/.test(sentence);
  }

  /**
   * Detect if sentence is a hard claim and what type
   */
  private detectHardClaim(sentence: string): { isHard: boolean; types: string[] } {
    const types: string[] = [];

    // Check numeric patterns
    for (const pattern of NUMERIC_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
        types.push("numeric");
        break;
      }
    }

    // Check impact verbs
    for (const pattern of IMPACT_VERB_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
        types.push("impact");
        break;
      }
    }

    // Check comparatives
    for (const pattern of COMPARATIVE_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
        types.push("comparative");
        break;
      }
    }

    // Check named relationships
    for (const pattern of NAMED_RELATIONSHIP_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(sentence)) {
        types.push("relationship");
        break;
      }
    }

    return { isHard: types.length > 0, types };
  }

  /**
   * Apply softening rules to a sentence
   */
  private applySoftenRules(sentence: string): { result: string; changes: string[] } {
    let result = sentence;
    const changes: string[] = [];

    for (const rule of SOFTEN_RULES) {
      const match = result.match(rule.pattern);
      if (match) {
        result = result.replace(rule.pattern, rule.replacement);
        changes.push(`"${match[0]}" → "${rule.replacement}"`);
      }
    }

    return { result, changes };
  }

  /**
   * Repair a single sentence/line: detect hard claims, soften comparatives.
   * Mutates stats and changes accumulators in place.
   */
  private repairSentence(
    sentence: string,
    changes: RepairResult["changes"],
    stats: RepairResult["stats"],
  ): string {
    if (this.isExemptPlanStatement(sentence)) {
      return sentence;
    }

    const { isHard, types } = this.detectHardClaim(sentence);
    if (!isHard) {
      return sentence;
    }

    stats.hardClaimsDetected++;

    if (this.hasCitation(sentence) || this.hasPlaceholder(sentence)) {
      return sentence;
    }

    stats.unsupportedBefore++;

    let repairedSentence = sentence;

    if (types.includes("comparative")) {
      const { result, changes: softenChanges } = this.applySoftenRules(sentence);
      if (softenChanges.length > 0) {
        repairedSentence = result;
        stats.softened++;
        changes.push({
          type: "soften",
          original: sentence.substring(0, 100),
          replacement: result.substring(0, 100),
          sentence: sentence.substring(0, 60) + "...",
        });
      }
    }

    const { isHard: stillHard } = this.detectHardClaim(repairedSentence);
    if (stillHard && !this.hasCitation(repairedSentence) && !this.hasPlaceholder(repairedSentence)) {
      stats.unsupportedAfter++;
    }

    return repairedSentence;
  }

  /**
   * Repair a section's draft text.
   * Processes paragraph-by-paragraph to preserve markdown structure (headings, tables, bullets).
   */
  repairSection(draftText: string): RepairResult {
    const changes: RepairResult["changes"] = [];
    const stats: RepairResult["stats"] = {
      hardClaimsDetected: 0,
      unsupportedBefore: 0,
      unsupportedAfter: 0,
      softened: 0,
      placeholdered: 0,
    };

    // Split into paragraphs — preserve blank-line boundaries
    const paragraphs = draftText.split(/\n\n+/);
    const repairedParagraphs: string[] = [];

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (trimmed === "") {
        repairedParagraphs.push(paragraph);
        continue;
      }

      // Detect markdown structural paragraphs: headings, tables, bullets, blockquotes, hr
      if (/^(\s*[#|>*\-+]|\s*\d+\.\s|---|\|)/.test(trimmed)) {
        // Process line-by-line to preserve formatting
        const lines = paragraph.split("\n");
        const repairedLines = lines.map(line => {
          // Skip table rows, headings, horizontal rules, empty lines
          if (/^\s*[#|]|^\s*---/.test(line) || line.trim() === "") {
            return line;
          }
          return this.repairSentence(line, changes, stats);
        });
        repairedParagraphs.push(repairedLines.join("\n"));
      } else {
        // Prose paragraph: split into sentences, process each, rejoin with space
        const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z\*#])/);
        const repairedSentences = sentences.map(s => this.repairSentence(s, changes, stats));
        repairedParagraphs.push(repairedSentences.join(" "));
      }
    }

    const repaired = repairedParagraphs.join("\n\n");

    this.logger.log({
      message: "Section repair complete",
      ...stats,
      reductionPct: stats.unsupportedBefore > 0
        ? Math.round((1 - stats.unsupportedAfter / stats.unsupportedBefore) * 100)
        : 0,
    });

    return {
      original: draftText,
      repaired,
      changes,
      stats,
    };
  }

  /**
   * Repair all sections in a proposal
   */
  repairProposal(sections: Array<{ name: string; draftText: string }>): {
    sections: Array<{ name: string; draftText: string; repairStats: RepairResult["stats"] }>;
    totalStats: RepairResult["stats"];
  } {
    const totalStats: RepairResult["stats"] = {
      hardClaimsDetected: 0,
      unsupportedBefore: 0,
      unsupportedAfter: 0,
      softened: 0,
      placeholdered: 0,
    };

    const repairedSections = sections.map(section => {
      const result = this.repairSection(section.draftText);

      totalStats.hardClaimsDetected += result.stats.hardClaimsDetected;
      totalStats.unsupportedBefore += result.stats.unsupportedBefore;
      totalStats.unsupportedAfter += result.stats.unsupportedAfter;
      totalStats.softened += result.stats.softened;
      totalStats.placeholdered += result.stats.placeholdered;

      return {
        name: section.name,
        draftText: result.repaired,
        repairStats: result.stats,
      };
    });

    this.logger.log({
      message: "Proposal repair complete",
      ...totalStats,
      unsupportedReductionPct: totalStats.unsupportedBefore > 0
        ? Math.round((1 - totalStats.unsupportedAfter / totalStats.unsupportedBefore) * 100)
        : 0,
    });

    return { sections: repairedSections, totalStats };
  }
}
