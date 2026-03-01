/**
 * Sprint 3 C3+C4: Rubric-based section evaluator for funding proposals.
 *
 * Loads funding-rubrics.v1.json, runs deterministic checks against each section,
 * then (optionally) invokes the LLM judge for semantic quality checks.
 */
import * as fs from "fs/promises";
import {
  FundingLLMJudge,
  FundingLLMCheck,
  FundingLLMJudgeResult,
  FundingJudgeEvalConfig,
} from "./funding-llm-judge.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FundingRubricCheck {
  id: string;
  description: string;
  required: boolean;
  type: string;
  params?: Record<string, any>;
}

export interface FundingRubricLLMConfig {
  model: string;
  prompt_contract: {
    format: string;
    require_evidence_quotes: boolean;
    max_quote_words_per_field: number;
  };
  checks: FundingLLMCheck[];
}

export interface FundingRubric {
  rubric_id: string;
  section_type: string;
  pass_threshold: number;
  weights: Record<string, number>;
  deterministic_checks: FundingRubricCheck[];
  llm_judge?: FundingRubricLLMConfig;
}

export interface FundingRubricPack {
  rubric_pack_id: string;
  version: string;
  description?: string;
  global: Record<string, any>;
  rubrics: Record<string, FundingRubric>;
}

export interface SectionEvalResult {
  sectionType: string;
  rubricId: string;
  passed: boolean;
  score: number;
  passThreshold: number;
  deterministicResults: Array<{
    checkId: string;
    passed: boolean;
    required: boolean;
    detail?: string;
  }>;
  llmJudgeResults?: FundingLLMJudgeResult[];
  failReasons: string[];
}

// ── Rubric Evaluator ─────────────────────────────────────────────────────────

export class FundingRubricEvaluator {
  private rubricPack: FundingRubricPack;
  private llmJudge?: FundingLLMJudge;

  constructor(rubricPack: FundingRubricPack, judgeConfig?: FundingJudgeEvalConfig) {
    this.rubricPack = rubricPack;
    if (judgeConfig) {
      this.llmJudge = new FundingLLMJudge(judgeConfig);
    }
  }

  static async loadRubrics(filePath: string): Promise<FundingRubricPack> {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as FundingRubricPack;
  }

  getRubric(sectionType: string): FundingRubric | null {
    return this.rubricPack.rubrics[sectionType] || null;
  }

  /**
   * Evaluate a single proposal section against its rubric.
   */
  async evaluateSection(
    sectionType: string,
    sectionText: string,
    context?: {
      funderName?: string;
      orgName?: string;
      retrievedChunks?: Array<{ docId: string; chunkId: string; content: string }>;
    },
  ): Promise<SectionEvalResult> {
    const rubric = this.getRubric(sectionType);
    if (!rubric) {
      return {
        sectionType,
        rubricId: "none",
        passed: true,
        score: 1.0,
        passThreshold: 0,
        deterministicResults: [],
        failReasons: [`No rubric defined for section type: ${sectionType}`],
      };
    }

    // 1. Run deterministic checks
    const deterministicResults = rubric.deterministic_checks.map((check) => {
      const result = this.runDeterministicCheck(check, sectionText);
      return { checkId: check.id, passed: result.passed, required: check.required, detail: result.detail };
    });

    // 2. Check if required deterministic checks failed (skip LLM if so)
    const requiredFailed = deterministicResults.some((r) => r.required && !r.passed);

    // 3. Run LLM judge checks (if available and deterministic didn't hard-fail)
    let llmJudgeResults: FundingLLMJudgeResult[] | undefined;
    if (!requiredFailed && rubric.llm_judge && this.llmJudge) {
      llmJudgeResults = await this.llmJudge.judgeWithConsensus(
        sectionText,
        rubric.llm_judge,
        rubric.llm_judge.checks,
        { sectionType, ...context },
      );
    }

    // 4. Compute weighted score
    const weights = rubric.weights;
    let totalWeight = 0;
    let weightedSum = 0;

    for (const dr of deterministicResults) {
      const w = weights[dr.checkId] || 0;
      totalWeight += w;
      weightedSum += dr.passed ? w : 0;
    }

    if (llmJudgeResults) {
      for (const lr of llmJudgeResults) {
        if (lr.skipped) continue;
        const w = weights[lr.checkId] || 0;
        totalWeight += w;
        const checkScore = lr.score !== undefined ? lr.score : lr.passed ? 1.0 : 0;
        weightedSum += checkScore * w;
      }
    }

    const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0;
    const passed = score >= rubric.pass_threshold && !requiredFailed;

    const failReasons: string[] = [];
    for (const dr of deterministicResults) {
      if (!dr.passed) failReasons.push(`[deterministic] ${dr.checkId}: ${dr.detail || "FAIL"}`);
    }
    if (llmJudgeResults) {
      for (const lr of llmJudgeResults) {
        if (!lr.passed && !lr.skipped) {
          failReasons.push(`[llm_judge] ${lr.checkId}: ${lr.evidence || lr.error || "FAIL"}`);
        }
      }
    }

    return {
      sectionType,
      rubricId: rubric.rubric_id,
      passed,
      score,
      passThreshold: rubric.pass_threshold,
      deterministicResults,
      llmJudgeResults,
      failReasons,
    };
  }

  // ── Deterministic checks ──────────────────────────────────────────────────

  private runDeterministicCheck(
    check: FundingRubricCheck,
    text: string,
  ): { passed: boolean; detail?: string } {
    switch (check.type) {
      case "regex_presence_any":
        return this.checkRegexPresenceAny(check.params?.patterns_any || [], text);

      case "regex_presence_all":
        return this.checkRegexPresenceAll(check.params?.patterns_all || [], text);

      case "regex_absence":
        return this.checkRegexAbsence(check.params?.patterns_any || [], text);

      case "regex_presence_count":
        return this.checkRegexPresenceCount(
          check.params?.patterns || [],
          check.params?.min_present || 1,
          text,
        );

      case "citation_presence":
        return this.checkCitationPresence(check.params?.min_count || 1, text);

      case "min_count":
        return this.checkMinCount(check.params?.pattern || "", check.params?.min || 1, text);

      case "prose_ratio":
        return this.checkProseRatio(check.params?.min_prose_ratio || 0.5, text);

      case "budget_ceiling_check":
        return { passed: true, detail: "Budget ceiling check requires runtime context" };

      case "scope_number_consistency":
        return { passed: true, detail: "Scope consistency check requires cross-section context" };

      default:
        return { passed: true, detail: `Unknown check type: ${check.type} (skipped)` };
    }
  }

  private checkRegexPresenceAny(patterns: string[], text: string): { passed: boolean; detail?: string } {
    for (const pat of patterns) {
      if (new RegExp(pat).test(text)) {
        return { passed: true };
      }
    }
    return { passed: false, detail: `None of ${patterns.length} patterns found` };
  }

  private checkRegexPresenceAll(patterns: string[], text: string): { passed: boolean; detail?: string } {
    const missing: string[] = [];
    for (const pat of patterns) {
      if (!new RegExp(pat).test(text)) {
        missing.push(pat);
      }
    }
    if (missing.length === 0) return { passed: true };
    return { passed: false, detail: `${missing.length}/${patterns.length} patterns missing` };
  }

  private checkRegexAbsence(patterns: string[], text: string): { passed: boolean; detail?: string } {
    for (const pat of patterns) {
      const match = text.match(new RegExp(pat));
      if (match) {
        return { passed: false, detail: `Found forbidden pattern: "${match[0]}"` };
      }
    }
    return { passed: true };
  }

  private checkRegexPresenceCount(
    patterns: string[],
    minPresent: number,
    text: string,
  ): { passed: boolean; detail?: string } {
    let found = 0;
    for (const pat of patterns) {
      if (new RegExp(pat).test(text)) found++;
    }
    const passed = found >= minPresent;
    return { passed, detail: `${found}/${patterns.length} patterns found (need ${minPresent})` };
  }

  private checkCitationPresence(minCount: number, text: string): { passed: boolean; detail?: string } {
    const citations = text.match(/\[citation:[^\]]+\]/g) || [];
    const passed = citations.length >= minCount;
    return { passed, detail: `${citations.length} citations found (need ${minCount})` };
  }

  private checkMinCount(pattern: string, min: number, text: string): { passed: boolean; detail?: string } {
    const matches = text.match(new RegExp(pattern, "g")) || [];
    const passed = matches.length >= min;
    return { passed, detail: `${matches.length} matches (need ${min})` };
  }

  private checkProseRatio(minRatio: number, text: string): { passed: boolean; detail?: string } {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const bulletLines = lines.filter((l) => /^\s*[-*•]\s+/.test(l) || /^\s*\d+\.\s+/.test(l));
    const proseLines = lines.length - bulletLines.length;
    const ratio = lines.length > 0 ? proseLines / lines.length : 0;
    const passed = ratio >= minRatio;
    return {
      passed,
      detail: `Prose ratio: ${Math.round(ratio * 100)}% (${proseLines} prose / ${lines.length} total, need ${Math.round(minRatio * 100)}%)`,
    };
  }
}
