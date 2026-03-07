/**
 * Proposal Diagnostic Evaluator — the main brain for the 4-category proposal test suite.
 *
 * Orchestrates: full pipeline run → core 7 evaluation → category add-ons →
 * per-section rubrics → failure mode diagnosis → improvement plan generation.
 */
import * as fs from "fs/promises";
import type {
  OrchestratorE2ECase,
  ProposalCategory,
  ProposalDiagnosticResult,
  FailureMode,
  ImprovementAction,
} from "../types.js";
import { FundingApiClient } from "./funding-api-client.js";
import {
  FundingRubricEvaluator,
  type SectionEvalResult,
} from "./funding-rubric-evaluator.js";
import {
  FundingLLMJudge,
  type FundingLLMCheck,
  type FundingLLMJudgeConfig,
  type FundingJudgeEvalConfig,
} from "./funding-llm-judge.js";
import {
  checkMinSectionCount,
  checkNoErrorSections,
  checkCrossSectionNumberConsistency,
  checkCrossSectionVoice,
  checkCrossSectionVoiceSingular,
  checkHollowPhraseCount,
  checkWordLimitCompliance,
  checkNoOrgVoiceLeakage,
  checkCrossSectionDeduplication,
  checkNoBudgetLanguage,
  checkNoRawTags,
  type CrossSectionCheckResult,
} from "./cross-section-checks.js";

// ── Rubric file shape ────────────────────────────────────────────────────────

interface ProposalRubricPack {
  rubric_pack_id: string;
  version: string;
  core_dimensions: Array<{
    dimension: string;
    weight: number;
    description: string;
    checks: Array<{
      id: string;
      type: string;
      description: string;
      params?: Record<string, unknown>;
    }>;
  }>;
  category_addons: Record<
    string,
    {
      description: string;
      pass_threshold: number;
      checks: Array<{
        id: string;
        type: string;
        description: string;
        params?: Record<string, unknown>;
      }>;
      core_overrides?: Record<
        string,
        {
          remove?: string[];
          add?: Array<{
            id: string;
            type: string;
            description: string;
            params?: Record<string, unknown>;
          }>;
        }
      >;
    }
  >;
  llm_judge_config: FundingLLMJudgeConfig;
}

interface ProposalSection {
  name: string;
  draftText?: string;
  retrievedChunks?: Array<{ chunkId: string; docId: string; content?: string }>;
  [key: string]: unknown;
}

// ── Main class ───────────────────────────────────────────────────────────────

export class ProposalDiagnosticEvaluator {
  private rubricPack: ProposalRubricPack;
  private sectionRubricEvaluator?: FundingRubricEvaluator;
  private llmJudge?: FundingLLMJudge;

  constructor(
    rubricPack: ProposalRubricPack,
    options?: {
      sectionRubricEvaluator?: FundingRubricEvaluator;
      judgeConfig?: FundingJudgeEvalConfig;
    },
  ) {
    this.rubricPack = rubricPack;
    this.sectionRubricEvaluator = options?.sectionRubricEvaluator;
    if (options?.judgeConfig) {
      this.llmJudge = new FundingLLMJudge(options.judgeConfig);
    }
  }

  static async loadRubrics(filePath: string): Promise<ProposalRubricPack> {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as ProposalRubricPack;
  }

  /**
   * Run full E2E evaluation for a single category test case.
   */
  async evaluateCategory(
    tc: OrchestratorE2ECase,
    client: FundingApiClient,
  ): Promise<ProposalDiagnosticResult> {
    const start = Date.now();
    const category = tc.proposalCategory;
    const opportunityId =
      (tc.body?.opportunityId as string) ??
      (tc.params?.opportunityId as string) ??
      "";

    const result: ProposalDiagnosticResult = {
      category,
      opportunityId,
      latencyMs: 0,
      passed: false,
      orchestratorStages: {},
      coreScorecard: [],
      coreScore: 0,
      categoryScorecard: [],
      categoryScore: 0,
      failureModes: [],
      improvementPlan: [],
    };

    try {
      // 1. Run the orchestrator pipeline
      const orchestratorResult = await client.orchestratorRun(
        opportunityId,
        {
          proposalOptions: tc.orchestratorOptions,
          forceGenerate: true, // Always proceed even if fit is marginal
        },
      );

      // The orchestrator returns OrchestratorRunState
      const runState = orchestratorResult as Record<string, unknown>;
      result.proposalRunId = runState.proposalRunId as string | undefined;

      // 2. Extract orchestrator stage results from nested objects
      const fitScore = runState.fitScore as
        | { totalScore?: number; decision?: string }
        | undefined;
      const gmailMemory = runState.gmailMemory as
        | { blocksFound?: number }
        | undefined;
      const budgetEnvelope = runState.budgetEnvelope as
        | { grandTotal?: number; grantPeriodMonths?: number; targetCeilingINR?: number }
        | undefined;
      const webEvidence = runState.webEvidence as
        | { queriesUsed?: number; sources?: unknown[] }
        | undefined;

      result.orchestratorStages = {
        fitScore: fitScore?.totalScore,
        fitDecision: fitScore?.decision,
        gmailBlocks: gmailMemory?.blocksFound,
        budgetEnvelope: budgetEnvelope
          ? { total: budgetEnvelope.grandTotal, currency: "INR", months: budgetEnvelope.grantPeriodMonths }
          : undefined,
        webEvidenceChunks: webEvidence?.sources?.length ?? webEvidence?.queriesUsed,
      };

      // 3. Get full proposal sections
      let sections: ProposalSection[] = [];
      if (result.proposalRunId) {
        const run = (await client.proposalGetRun(result.proposalRunId)) as {
          sections?: ProposalSection[];
        };
        sections = run?.sections ?? [];
      } else if (orchestratorResult.sections) {
        sections = orchestratorResult.sections as ProposalSection[];
      }
      result.orchestratorStages.proposalSections = sections.length;

      // 4. Run core 7 evaluation
      result.coreScorecard = await this.evaluateCore7(sections, tc);
      result.coreScore = this.computeWeightedScore(result.coreScorecard);

      // 5. Run category add-on evaluation
      result.categoryScorecard = await this.evaluateCategoryAddOns(
        category,
        sections,
        tc,
      );
      result.categoryScore = this.computeCategoryScore(
        result.categoryScorecard,
      );

      // 6. Run per-section rubric evaluation (if available)
      if (this.sectionRubricEvaluator && sections.length > 0) {
        try {
          result.sectionResults = await this.evaluatePerSection(sections, tc);
        } catch (sectionErr: unknown) {
          const msg = sectionErr instanceof Error ? sectionErr.message : String(sectionErr);
          result.sectionResults = [{ sectionType: "_error", passed: false, score: 0, failReasons: [`Section rubric error: ${msg}`] }];
        }
      }

      // 7. Diagnose failure modes
      result.failureModes = this.diagnoseFailureModes(result, sections, tc);

      // 8. Generate improvement plan
      result.improvementPlan = this.generateImprovementPlan(
        result.failureModes,
      );

      // Determine pass/fail
      const coreThreshold =
        tc.categoryExpectations?.cross_section_threshold ?? 0.6;
      const categoryThreshold =
        tc.categoryExpectations?.category_threshold ?? 0.6;
      const criticalFailures = result.failureModes.filter(
        (f) => f.severity === "critical",
      );
      result.passed =
        result.coreScore >= coreThreshold &&
        result.categoryScore >= categoryThreshold &&
        criticalFailures.length === 0;
    } catch (err: unknown) {
      result.error = err instanceof Error ? err.message : String(err);
      result.failureModes.push({
        id: "pipeline_stall",
        severity: "critical",
        stage: "orchestrator_run",
        symptom: `Orchestrator pipeline failed: ${result.error}`,
        rootCause: "API error or timeout during orchestrator execution",
        affectedSections: ["all"],
      });
    }

    result.latencyMs = Date.now() - start;
    return result;
  }

  // ── Core 7 evaluation ──────────────────────────────────────────────────────

  private async evaluateCore7(
    sections: ProposalSection[],
    tc: OrchestratorE2ECase,
  ): Promise<ProposalDiagnosticResult["coreScorecard"]> {
    const scorecard: ProposalDiagnosticResult["coreScorecard"] = [];

    // Load core_overrides for this category (if any)
    const addon = this.rubricPack.category_addons[tc.proposalCategory];
    const coreOverrides = addon?.core_overrides ?? {};

    for (const dim of this.rubricPack.core_dimensions) {
      // Apply core_overrides: remove specified checks, add replacements
      const override = coreOverrides[dim.dimension];
      let checks = [...dim.checks];
      if (override) {
        if (override.remove) {
          checks = checks.filter((c) => !override.remove!.includes(c.id));
        }
        if (override.add) {
          checks.push(...override.add);
        }
      }

      const checkResults: Array<{
        id: string;
        passed: boolean;
        detail: string;
      }> = [];

      for (const check of checks) {
        const result = await this.runCoreCheck(check, sections, tc);
        checkResults.push(result);
      }

      const passedCount = checkResults.filter((r) => r.passed).length;
      const score =
        checkResults.length > 0 ? passedCount / checkResults.length : 1;
      const passed = checkResults.length === 0 || score >= 0.5; // no checks = pass; otherwise majority must pass

      scorecard.push({
        dimension: dim.dimension,
        weight: dim.weight,
        passed,
        score,
        details: checkResults.map(
          (r) => `${r.id}: ${r.passed ? "PASS" : "FAIL"} — ${r.detail}`,
        ),
      });
    }

    return scorecard;
  }

  private async runCoreCheck(
    check: {
      id: string;
      type: string;
      description: string;
      params?: Record<string, unknown>;
    },
    sections: ProposalSection[],
    tc: OrchestratorE2ECase,
  ): Promise<{ id: string; passed: boolean; detail: string }> {
    // Deterministic checks
    if (check.type === "deterministic") {
      return this.runDeterministicCoreCheck(check, sections);
    }

    // LLM-scored checks
    if (check.type === "llm_scored_boolean" && this.llmJudge) {
      return this.runLLMCoreCheck(check, sections, tc);
    }

    // No LLM available — skip
    return {
      id: check.id,
      passed: true,
      detail: "Skipped (no LLM judge available)",
    };
  }

  private runDeterministicCoreCheck(
    check: {
      id: string;
      description: string;
      params?: Record<string, unknown>;
    },
    sections: ProposalSection[],
  ): { id: string; passed: boolean; detail: string } {
    let result: CrossSectionCheckResult;

    switch (check.id) {
      case "min_section_count":
        result = checkMinSectionCount(
          sections,
          (check.params?.min_sections as number) ?? 8,
        );
        break;
      case "no_error_sections":
        result = checkNoErrorSections(sections);
        break;
      case "beneficiary_count_consistent":
        result = checkCrossSectionNumberConsistency(
          sections,
          (check.params?.field as string) ?? "beneficiary_count",
          (check.params?.min_sections as number) ?? 3,
        );
        break;
      case "first_person_voice":
        result = checkCrossSectionVoice(
          sections,
          (check.params?.min_ratio as number) ?? 0.8,
        );
        break;
      case "first_person_voice_singular":
        result = checkCrossSectionVoiceSingular(
          sections,
          (check.params?.min_ratio as number) ?? 0.8,
        );
        break;
      case "word_limit_compliance":
        result = checkWordLimitCompliance(
          sections,
          (check.params?.word_limits as Record<string, number>) ?? {},
        );
        break;
      case "no_org_voice_leakage":
        result = checkNoOrgVoiceLeakage(
          sections,
          (check.params?.org_names as string[]) ?? [],
        );
        break;
      case "low_hollow_phrases":
        result = checkHollowPhraseCount(
          sections,
          (check.params?.patterns as string[]) ?? [],
          (check.params?.max_count as number) ?? 2,
        );
        break;
      case "cross_section_deduplication":
        result = checkCrossSectionDeduplication(
          sections,
          (check.params?.max_overlap as number) ?? 0.30,
          (check.params?.exclude_patterns as string[]) ?? undefined,
        );
        break;
      case "no_budget_language":
        result = checkNoBudgetLanguage(sections);
        break;
      case "no_raw_tags":
        result = checkNoRawTags(sections);
        break;
      default:
        return {
          id: check.id,
          passed: true,
          detail: `Unknown deterministic check: ${check.id}`,
        };
    }

    return { id: check.id, passed: result.passed, detail: result.detail };
  }

  private async runLLMCoreCheck(
    check: { id: string; description: string },
    sections: ProposalSection[],
    tc: OrchestratorE2ECase,
  ): Promise<{ id: string; passed: boolean; detail: string }> {
    if (!this.llmJudge) {
      return { id: check.id, passed: true, detail: "Skipped (no LLM judge)" };
    }

    // Combine all section text for cross-section LLM analysis
    const allText = sections
      .map((s) => `## ${s.name}\n${s.draftText ?? ""}`)
      .join("\n\n");

    const llmChecks: FundingLLMCheck[] = [
      {
        id: check.id,
        description: check.description,
        required: false,
        type: "llm_scored_boolean",
      },
    ];

    const results = await this.llmJudge.judgeWithConsensus(
      allText.slice(0, 15000), // Limit to avoid token overflow
      this.rubricPack.llm_judge_config,
      llmChecks,
      {
        sectionType: "cross_section",
        orgName: (tc.body?.orgName as string) ?? "Diksha Foundation",
      },
    );

    const r = results[0];
    if (!r || r.skipped) {
      return { id: check.id, passed: true, detail: "LLM judge skipped" };
    }
    return {
      id: check.id,
      passed: r.passed,
      detail: r.evidence ?? (r.passed ? "PASS" : "FAIL"),
    };
  }

  // ── Category add-on evaluation ─────────────────────────────────────────────

  private async evaluateCategoryAddOns(
    category: ProposalCategory,
    sections: ProposalSection[],
    tc: OrchestratorE2ECase,
  ): Promise<ProposalDiagnosticResult["categoryScorecard"]> {
    const addon = this.rubricPack.category_addons[category];
    if (!addon) {
      return [
        {
          checkId: "no_addon",
          passed: true,
          evidence: `No category add-on defined for: ${category}`,
        },
      ];
    }

    const scorecard: ProposalDiagnosticResult["categoryScorecard"] = [];

    // Split checks into deterministic and LLM-scored
    const deterministicChecks = addon.checks.filter(
      (c) => c.type === "deterministic",
    );
    const llmOnlyChecks = addon.checks.filter(
      (c) => c.type !== "deterministic",
    );

    // Run deterministic checks locally
    for (const check of deterministicChecks) {
      const result = this.runDeterministicCoreCheck(
        { id: check.id, description: check.description, params: check.params },
        sections,
      );
      scorecard.push({
        checkId: result.id,
        passed: result.passed,
        evidence: result.detail,
      });
    }

    // Run LLM checks via judge (if available)
    if (llmOnlyChecks.length > 0 && this.llmJudge) {
      const allText = sections
        .map((s) => `## ${s.name}\n${s.draftText ?? ""}`)
        .join("\n\n");

      const llmChecks: FundingLLMCheck[] = llmOnlyChecks.map((c) => ({
        id: c.id,
        description: c.description,
        required: false,
        type: "llm_scored_boolean" as const,
      }));

      const results = await this.llmJudge.judgeWithConsensus(
        allText.slice(0, 15000),
        this.rubricPack.llm_judge_config,
        llmChecks,
        {
          sectionType: `category_${category}`,
          orgName: (tc.body?.orgName as string) ?? "Diksha Foundation",
        },
      );

      for (const r of results) {
        scorecard.push({
          checkId: r.checkId,
          passed: r.passed,
          evidence: r.evidence ?? r.error,
        });
      }
    } else if (llmOnlyChecks.length > 0) {
      // No LLM judge — skip LLM checks
      for (const c of llmOnlyChecks) {
        scorecard.push({
          checkId: c.id,
          passed: true,
          evidence: "Skipped (no LLM judge)",
        });
      }
    }

    return scorecard;
  }

  // ── Per-section rubric evaluation ──────────────────────────────────────────

  private async evaluatePerSection(
    sections: ProposalSection[],
    tc: OrchestratorE2ECase,
  ): Promise<
    Array<{
      sectionType: string;
      passed: boolean;
      score: number;
      failReasons: string[];
    }>
  > {
    if (!this.sectionRubricEvaluator) return [];

    const results: Array<{
      sectionType: string;
      passed: boolean;
      score: number;
      failReasons: string[];
    }> = [];

    for (const section of sections) {
      const sectionType = this.normalizeSectionType(section.name);
      const rubric = this.sectionRubricEvaluator.getRubric(sectionType);
      if (!rubric) continue;

      const evalResult = await this.sectionRubricEvaluator.evaluateSection(
        sectionType,
        section.draftText ?? "",
        {
          orgName: (tc.body?.orgName as string) ?? "Diksha Foundation",
          retrievedChunks: section.retrievedChunks?.map((c) => ({
            docId: c.docId,
            chunkId: c.chunkId,
            content: c.content ?? "",
          })),
        },
      );

      results.push({
        sectionType,
        passed: evalResult.passed,
        score: evalResult.score,
        failReasons: evalResult.failReasons,
      });
    }

    return results;
  }

  // ── Failure mode diagnosis ─────────────────────────────────────────────────

  private diagnoseFailureModes(
    result: ProposalDiagnosticResult,
    sections: ProposalSection[],
    tc: OrchestratorE2ECase,
  ): FailureMode[] {
    const failures: FailureMode[] = [];

    // 1. Pipeline stall — orchestrator stage failed
    if (result.error) {
      failures.push({
        id: "pipeline_stall",
        severity: "critical",
        stage: "orchestrator_run",
        symptom: `Orchestrator failed: ${result.error}`,
        rootCause: "API error or timeout",
        affectedSections: ["all"],
      });
    }

    // 2. Thin sections — sections below 100 words
    const thinSections = sections.filter((s) => {
      const words = (s.draftText ?? "").split(/\s+/).length;
      return words < 100 && (s.draftText?.trim().length ?? 0) > 0;
    });
    if (thinSections.length >= 2) {
      failures.push({
        id: "thin_sections",
        severity: "major",
        stage: "proposal_generation",
        symptom: `${thinSections.length} sections have fewer than 100 words`,
        rootCause:
          "Insufficient context or evidence for LLM to generate substantive content",
        affectedSections: thinSections.map((s) => s.name),
      });
    }

    // 3. Evidence gap — low citation count
    const allText = sections.map((s) => s.draftText ?? "").join("\n");
    const citationMatches = allText.match(/\[citation:[^\]]+\]/g) ?? [];
    if (citationMatches.length < 3 && sections.length > 0) {
      failures.push({
        id: "evidence_gap",
        severity: "major",
        stage: "evidence_retrieval",
        symptom: `Only ${citationMatches.length} citations across ${sections.length} sections`,
        rootCause:
          "KB evidence not retrieved or not incorporated into generation prompts",
        affectedSections: sections
          .filter((s) => !/\[citation:/.test(s.draftText ?? ""))
          .map((s) => s.name),
      });
    }

    // 4. Coherence drift — beneficiary count varies
    const beneficiaryCheck = checkCrossSectionNumberConsistency(
      sections,
      "beneficiary_count",
      2,
    );
    if (!beneficiaryCheck.passed && sections.length >= 3) {
      failures.push({
        id: "coherence_drift",
        severity: "major",
        stage: "proposal_generation",
        symptom: "Beneficiary count varies across sections",
        rootCause:
          "Sections generated independently without shared context injection",
        affectedSections: sections.map((s) => s.name),
      });
    }

    // 5. Hollow language — too many generic phrases
    const hollowPatterns = [
      "holistic approach",
      "sustainable impact",
      "transformative change",
      "paradigm shift",
      "cutting-edge",
      "world-class",
      "best-in-class",
      "synergistic",
    ];
    const hollowCheck = checkHollowPhraseCount(sections, hollowPatterns, 2);
    if (!hollowCheck.passed) {
      failures.push({
        id: "hollow_language",
        severity: "minor",
        stage: "proposal_generation",
        symptom: hollowCheck.detail,
        rootCause: "LLM defaults to generic grant-writing language",
        affectedSections: sections
          .filter((s) => {
            const text = (s.draftText ?? "").toLowerCase();
            return hollowPatterns.some((p) => text.includes(p));
          })
          .map((s) => s.name),
      });
    }

    // 6. Scope mismatch — budget doesn't match activities
    const budgetDim = result.coreScorecard.find(
      (d) => d.dimension === "feasibility",
    );
    if (budgetDim && !budgetDim.passed) {
      failures.push({
        id: "scope_mismatch",
        severity: "major",
        stage: "proposal_generation",
        symptom: "Budget-scope alignment failed",
        rootCause:
          "Budget section generated without activity/scope constraints",
        affectedSections: ["budget", "projectDesign", "objectives"],
      });
    }

    // 7. Proposal framing leak — fellowship reads like an org grant proposal
    const proposalFramingCheck = result.categoryScorecard.find(
      (c) => c.checkId === "not_too_proposal_like",
    );
    if (proposalFramingCheck && !proposalFramingCheck.passed) {
      failures.push({
        id: "proposal_framing_leak",
        severity: "major",
        stage: "proposal_generation",
        symptom: "Fellowship essay reads like an organizational grant proposal (budget justifications, ToC frameworks, deliverable tables)",
        rootCause: "ProposalService patterns leaking into fellowship pipeline, or LLM defaulting to grant-writing style",
        affectedSections: sections.map((s) => s.name),
      });
    }

    // 8. Missing category signal — category-specific checks failed
    const failedCategoryChecks = result.categoryScorecard.filter(
      (c) => !c.passed,
    );
    if (failedCategoryChecks.length >= 3) {
      failures.push({
        id: "missing_category_signal",
        severity: "major",
        stage: "proposal_generation",
        symptom: `${failedCategoryChecks.length} of ${result.categoryScorecard.length} category-specific checks failed`,
        rootCause: `Proposal not tailored for ${tc.proposalCategory} category requirements`,
        affectedSections: ["all"],
      });
    }

    // 8. Low fit score (if expectations set)
    const minFit = tc.categoryExpectations?.min_fit_score;
    if (
      minFit &&
      result.orchestratorStages.fitScore != null &&
      result.orchestratorStages.fitScore < minFit
    ) {
      failures.push({
        id: "low_fit_score",
        severity: "critical",
        stage: "fit_scoring",
        symptom: `Fit score ${result.orchestratorStages.fitScore} below threshold ${minFit}`,
        rootCause:
          "Opportunity may not be a good fit for the organization, or KB evidence insufficient",
        affectedSections: ["all"],
      });
    }

    return failures;
  }

  // ── Improvement plan generation ────────────────────────────────────────────

  private generateImprovementPlan(failures: FailureMode[]): ImprovementAction[] {
    const actions: ImprovementAction[] = [];
    const templates: Record<
      string,
      {
        action: string;
        expectedImpact: string;
        effortEstimate: ImprovementAction["effortEstimate"];
      }
    > = {
      pipeline_stall: {
        action:
          "Debug orchestrator pipeline — check API logs, increase timeout, verify opportunity exists in DB",
        expectedImpact: "Unblocks entire evaluation",
        effortEstimate: "high",
      },
      thin_sections: {
        action:
          "Increase evidence retrieval limit per section, add more KB documents, or improve section prompts with more context",
        expectedImpact:
          "Richer sections with 200+ words and specific details",
        effortEstimate: "medium",
      },
      evidence_gap: {
        action:
          "Verify KB has relevant documents indexed, check embedding quality, increase retrieval top-k",
        expectedImpact:
          "More citations per section, better evidence-backed claims",
        effortEstimate: "medium",
      },
      coherence_drift: {
        action:
          "Inject shared context (beneficiary count, budget total, geography) into all section generation prompts",
        expectedImpact:
          "Consistent numbers across sections, no contradictions",
        effortEstimate: "medium",
      },
      hollow_language: {
        action:
          "Add hollow-phrase detection to section generation post-processing, or add negative examples to prompts",
        expectedImpact: "Fewer generic phrases, more specific language",
        effortEstimate: "low",
      },
      scope_mismatch: {
        action:
          "Pass activity list and scope constraints to budget generation prompt, enforce budget ceiling",
        expectedImpact: "Budget aligned with described activities",
        effortEstimate: "medium",
      },
      proposal_framing_leak: {
        action:
          "Ensure fellowship pipeline uses section archetypes, remove budget references from prompts, strengthen anti-proposal voice instructions",
        expectedImpact: "Fellowship essays read as personal narratives, not org grant proposals",
        effortEstimate: "medium",
      },
      missing_category_signal: {
        action:
          "Add category-aware prompt templates that inject category-specific requirements into generation",
        expectedImpact: "Proposals tailored to category expectations",
        effortEstimate: "high",
      },
      low_fit_score: {
        action:
          "Review opportunity-to-org matching logic, add more KB evidence about org capabilities, or skip this opportunity",
        expectedImpact: "Better fit assessment accuracy",
        effortEstimate: "high",
      },
    };

    // Sort failures by severity for priority ordering
    const severityOrder: Record<string, number> = {
      critical: 1,
      major: 2,
      minor: 3,
    };
    const sorted = [...failures].sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4),
    );

    for (let i = 0; i < sorted.length; i++) {
      const failure = sorted[i];
      const template = templates[failure.id];
      if (template) {
        actions.push({
          priority: i + 1,
          action: template.action,
          expectedImpact: template.expectedImpact,
          effortEstimate: template.effortEstimate,
          relatedFailureModes: [failure.id],
        });
      } else {
        actions.push({
          priority: i + 1,
          action: `Investigate and fix: ${failure.symptom}`,
          expectedImpact: `Resolve ${failure.severity} failure in ${failure.stage}`,
          effortEstimate: "medium",
          relatedFailureModes: [failure.id],
        });
      }
    }

    return actions;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private computeWeightedScore(
    scorecard: ProposalDiagnosticResult["coreScorecard"],
  ): number {
    let totalWeight = 0;
    let weightedSum = 0;
    for (const dim of scorecard) {
      totalWeight += dim.weight;
      weightedSum += dim.score * dim.weight;
    }
    return totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100) / 100
      : 0;
  }

  private computeCategoryScore(
    scorecard: ProposalDiagnosticResult["categoryScorecard"],
  ): number {
    if (scorecard.length === 0) return 1;
    const passed = scorecard.filter((c) => c.passed).length;
    return Math.round((passed / scorecard.length) * 100) / 100;
  }

  private normalizeSectionType(sectionName: string): string {
    const nameMap: Record<string, string> = {
      budget: "budget",
      "budget & financials": "budget",
      objectives: "objectives",
      "objectives & outcomes": "objectives",
      sustainability: "sustainability",
      "sustainability plan": "sustainability",
      monitoring: "monitoring",
      "monitoring & evaluation": "monitoring",
      "m&e": "monitoring",
      "project design": "projectDesign",
      "project_design": "projectDesign",
      methodology: "projectDesign",
      compliance: "compliance",
      "compliance & legal": "compliance",
      need: "need",
      "need statement": "need",
      "need_statement": "need",
      "problem statement": "need",
    };
    return nameMap[sectionName.toLowerCase()] ?? sectionName.toLowerCase();
  }

  /** Get LLM judge cost summary (if judge was used) */
  getLLMCostSummary(): { totalCost: number; callCount: number } | undefined {
    if (!this.llmJudge) return undefined;
    const summary = this.llmJudge.getCostSummary();
    return { totalCost: summary.totalCost, callCount: summary.callCount };
  }
}
