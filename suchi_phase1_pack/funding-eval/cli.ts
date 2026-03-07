#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import { FundingApiClient } from "./runner/funding-api-client.js";
import { FundingEvaluator } from "./runner/funding-evaluator.js";
import { FundingRubricEvaluator } from "./runner/funding-rubric-evaluator.js";
import { ProposalDiagnosticEvaluator } from "./runner/proposal-diagnostic-evaluator.js";
import { QuestionVerifier } from "./runner/question-verifier.js";
import type {
  FundingCaseResult,
  FundingTestCase,
  ProposalCategory,
  ProposalDiagnosticResult,
  ProposalSuiteReport,
} from "./types.js";

const program = new Command();

program
  .name("funding-eval")
  .description("Funding API evaluation: citation coverage, abstain correctness, latency, CRUD, safety")
  .version("1.0.0");

const DEFAULT_BATCH_FILES = [
  "cases/need_statement_sample.yaml",
  "cases/pipeline_cases.yaml",
  "cases/activity_cases.yaml",
  "cases/email_draft_cases.yaml",
  "cases/donor_profile_cases.yaml",
  "cases/opportunity_cases.yaml",
  "cases/proposal_cases.yaml",
  "cases/framework_cases.yaml",
  "cases/evidence_cases.yaml",
  "cases/approvals_cases.yaml",
  "cases/safety/abstain_cases.yaml",
  "cases/safety/fabrication_cases.yaml",
];

program
  .command("run")
  .description("Run evaluation cases against funding-api")
  .requiredOption("--api-url <url>", "Funding API base URL (e.g. http://localhost:3001)")
  .option("--cases <path>", "Path to YAML cases file (single run)", "cases/need_statement_sample.yaml")
  .option("--batch", "Run all default case files and aggregate report")
  .option("--output <path>", "Output JSON report path", "funding-eval-report.json")
  .option("--summary", "Print summary to console")
  .option("--fail-on-regression", "Exit with code 1 if any case fails")
  .option("--timeout <ms>", "Request timeout in ms", "60000")
  .option("--export-token <token>", "Optional token for evidence-ingest endpoints (Bearer)")
  .action(async (options) => {
    const apiUrl = options.apiUrl.replace(/\/$/, "");
    const outputPath = path.isAbsolute(options.output)
      ? options.output
      : path.resolve(process.cwd(), options.output);
    const timeoutMs = parseInt(options.timeout, 10) || 60_000;
    const exportToken = options.exportToken as string | undefined;

    const evaluator = new FundingEvaluator(apiUrl, timeoutMs);
    const client = new FundingApiClient(apiUrl, timeoutMs, { exportToken });

    const caseFiles: string[] = options.batch
      ? DEFAULT_BATCH_FILES.map((p) => path.resolve(process.cwd(), p))
      : [
          path.isAbsolute(options.cases)
            ? options.cases
            : path.resolve(process.cwd(), options.cases),
        ];

    const allResults: FundingCaseResult[] = [];
    const allExpectations = new Map<string, { min_citations?: number; expect_placeholder?: boolean }>();

    for (const casesPath of caseFiles) {
      try {
        await fs.access(casesPath);
      } catch {
        if (options.batch) {
          console.warn(`  Skip (not found): ${casesPath}`);
          continue;
        }
        throw new Error(`Cases file not found: ${casesPath}`);
      }

      const cases = await FundingEvaluator.loadCases(casesPath);
      const relativePath = path.relative(process.cwd(), casesPath);
      if (caseFiles.length > 1) {
        console.log(`\n--- ${relativePath} ---`);
      }
      for (const c of cases) {
        allExpectations.set(c.id, {
          min_citations: c.expectations?.min_citations,
          expect_placeholder: c.expectations?.expect_placeholder,
        });
      }

      const previousResults = new Map<string, FundingCaseResult>();
      for (const tc of cases) {
        process.stdout.write(`  ${tc.id}... `);
        const result = await evaluator.runCase(tc, client, previousResults);
        previousResults.set(tc.id, result as FundingCaseResult & { response?: unknown });
        allResults.push(result);
        console.log(result.passed ? "OK" : "FAIL");
      }
    }

    const report = evaluator.buildReport(allResults, allExpectations);
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");

    if (options.summary) {
      console.log("\n--- Summary ---");
      console.log(`Passed: ${report.passed}/${report.totalCases}`);
      console.log(`Citation coverage rate: ${(report.citationCoverageRate * 100).toFixed(1)}%`);
      console.log(`Abstain correctness rate: ${(report.abstainCorrectnessRate * 100).toFixed(1)}%`);
      if (report.crudSuccessRate != null) {
        console.log(`CRUD success rate: ${(report.crudSuccessRate * 100).toFixed(1)}%`);
      }
      if (report.placeholderCompliance != null) {
        console.log(`Placeholder compliance: ${(report.placeholderCompliance * 100).toFixed(1)}%`);
      }
      if (report.fabricationRate != null) {
        console.log(`Fabrication safety rate: ${(report.fabricationRate * 100).toFixed(1)}%`);
      }
      console.log(
        `Latency ms: p50=${report.latencyMs.p50.toFixed(0)} p95=${report.latencyMs.p95.toFixed(0)} mean=${report.latencyMs.mean.toFixed(0)}`
      );
      console.log(`Report: ${outputPath}`);
    }

    if (options.failOnRegression && report.failed > 0) {
      process.exit(1);
    }
  });

// ── proposal-suite subcommand ────────────────────────────────────────────────

const CATEGORY_CASE_FILES: Record<ProposalCategory, string> = {
  tech_accelerator: "cases/proposals/cat1-tech-accelerator.yaml",
  fellowship: "cases/proposals/cat2-fellowship.yaml",
  donor_chapter: "cases/proposals/cat3-donor-chapter.yaml",
  partnership_pitch: "cases/proposals/cat4-partnership-pitch.yaml",
};

const ALL_CATEGORIES: ProposalCategory[] = [
  "tech_accelerator",
  "fellowship",
  "donor_chapter",
  "partnership_pitch",
];

program
  .command("proposal-suite")
  .description("Run 4-category E2E proposal quality evaluation")
  .requiredOption("--api-url <url>", "Funding API base URL (e.g. http://localhost:3001)")
  .option("--category <cat>", "Run single category (tech_accelerator|fellowship|donor_chapter|partnership_pitch)")
  .option("--rubrics <path>", "Cross-section rubric file", "rubrics/proposal-rubrics.v1.json")
  .option("--section-rubrics <path>", "Per-section rubric file (existing)", "rubrics/funding-rubrics.v1.json")
  .option("--llm-provider <provider>", "LLM provider: deepseek (default) | openai | vertex_ai", "deepseek")
  .option("--output <path>", "Output JSON report path", "proposal-suite-report.json")
  .option("--summary", "Print summary to console")
  .option("--verbose", "Print detailed diagnostics per category")
  .option("--fail-on-regression", "Exit with code 1 if any category fails")
  .option("--timeout <ms>", "Request timeout in ms", "60000")
  .action(async (options) => {
    const apiUrl = options.apiUrl.replace(/\/$/, "");
    const timeoutMs = parseInt(options.timeout, 10) || 60_000;
    const outputPath = path.isAbsolute(options.output)
      ? options.output
      : path.resolve(process.cwd(), options.output);

    // Determine which categories to run
    const categories: ProposalCategory[] = options.category
      ? [options.category as ProposalCategory]
      : ALL_CATEGORIES;

    // Validate category
    if (options.category && !ALL_CATEGORIES.includes(options.category as ProposalCategory)) {
      console.error(`Invalid category: ${options.category}. Must be one of: ${ALL_CATEGORIES.join(", ")}`);
      process.exit(1);
    }

    // Load rubrics
    const rubricsPath = path.isAbsolute(options.rubrics)
      ? options.rubrics
      : path.resolve(process.cwd(), options.rubrics);
    const proposalRubrics = await ProposalDiagnosticEvaluator.loadRubrics(rubricsPath);

    // Load section rubrics (optional)
    let sectionRubricEvaluator: FundingRubricEvaluator | undefined;
    const sectionRubricsPath = path.isAbsolute(options.sectionRubrics)
      ? options.sectionRubrics
      : path.resolve(process.cwd(), options.sectionRubrics);
    try {
      const sectionRubricPack = await FundingRubricEvaluator.loadRubrics(sectionRubricsPath);
      const judgeConfig = buildJudgeConfig(options.llmProvider);
      sectionRubricEvaluator = new FundingRubricEvaluator(sectionRubricPack, judgeConfig);
    } catch {
      console.warn(`  Warning: Could not load section rubrics from ${sectionRubricsPath}`);
    }

    // Build diagnostic evaluator
    const judgeConfig = buildJudgeConfig(options.llmProvider);
    const diagnosticEvaluator = new ProposalDiagnosticEvaluator(proposalRubrics, {
      sectionRubricEvaluator,
      judgeConfig,
    });

    // Build the regular evaluator (for setup/get_run/get_gaps cases)
    const evaluator = new FundingEvaluator(apiUrl, timeoutMs);
    evaluator.setDiagnosticEvaluator(diagnosticEvaluator);
    const client = new FundingApiClient(apiUrl, timeoutMs);

    console.log(`\n=== Proposal Suite: ${categories.length} categories ===\n`);

    const categoryResults: ProposalDiagnosticResult[] = [];
    const suiteStart = Date.now();

    for (const category of categories) {
      const casePath = path.resolve(process.cwd(), CATEGORY_CASE_FILES[category]);
      console.log(`\n--- ${category} ---`);

      try {
        await fs.access(casePath);
      } catch {
        console.warn(`  Skip (not found): ${casePath}`);
        continue;
      }

      const cases = await FundingEvaluator.loadCases(casePath);
      const previousResults = new Map<string, FundingCaseResult>();

      for (const tc of cases) {
        process.stdout.write(`  ${tc.id}... `);
        const result = await evaluator.runCase(tc, client, previousResults);
        previousResults.set(tc.id, result as FundingCaseResult & { response?: unknown });

        // Extract diagnostic result from orchestrator_e2e cases
        if (tc.type === "orchestrator_e2e" && result.response) {
          categoryResults.push(result.response as ProposalDiagnosticResult);
        }

        console.log(result.passed ? "OK" : "FAIL");

        if (result.error) {
          console.log(`    Error: ${result.error}`);
        }
      }

      // Print verbose diagnostics
      if (options.verbose) {
        const diagResult = categoryResults.find((r) => r.category === category);
        if (diagResult) {
          printDiagnostics(diagResult);
        }
      }
    }

    // Build suite report
    const suiteReport: ProposalSuiteReport = buildSuiteReport(
      categoryResults,
      apiUrl,
      Date.now() - suiteStart,
    );

    await fs.writeFile(outputPath, JSON.stringify(suiteReport, null, 2), "utf-8");

    // Print summary
    if (options.summary || options.verbose) {
      printSuiteSummary(suiteReport);
    }

    // Print LLM cost
    const costSummary = diagnosticEvaluator.getLLMCostSummary();
    if (costSummary && costSummary.callCount > 0) {
      console.log(`\nLLM Judge: ${costSummary.callCount} calls, $${costSummary.totalCost.toFixed(4)}`);
    }

    console.log(`\nReport: ${outputPath}`);

    if (options.failOnRegression && suiteReport.failedCategories > 0) {
      process.exit(1);
    }
  });

// ── Helper functions ─────────────────────────────────────────────────────────

function buildJudgeConfig(provider: string) {
  const llmProvider = (provider || "deepseek") as "deepseek" | "openai" | "vertex_ai";
  return {
    llmProvider,
    deepseekConfig: llmProvider === "deepseek"
      ? { apiKey: process.env.DEEPSEEK_API_KEY || "" }
      : undefined,
    openAiConfig: llmProvider === "openai"
      ? { apiKey: process.env.OPENAI_API_KEY || "" }
      : undefined,
    vertexAiConfig: llmProvider === "vertex_ai"
      ? { project: process.env.GCP_PROJECT || "gen-lang-client-0202543132", location: "us-central1" }
      : undefined,
    fallbackLlmProvider: llmProvider === "deepseek" ? ("openai" as const) : ("deepseek" as const),
    ...(llmProvider !== "deepseek" ? { deepseekConfig: { apiKey: process.env.DEEPSEEK_API_KEY || "" } } : {}),
    ...(llmProvider !== "openai" ? { openAiConfig: { apiKey: process.env.OPENAI_API_KEY || "" } } : {}),
  };
}

function printDiagnostics(r: ProposalDiagnosticResult): void {
  console.log(`\n  Diagnostics: ${r.category}`);
  console.log(`    Orchestrator stages:`);
  console.log(`      Fit score: ${r.orchestratorStages.fitScore ?? "N/A"} (${r.orchestratorStages.fitDecision ?? "N/A"})`);
  console.log(`      Gmail blocks: ${r.orchestratorStages.gmailBlocks ?? "N/A"}`);
  console.log(`      Web evidence chunks: ${r.orchestratorStages.webEvidenceChunks ?? "N/A"}`);
  console.log(`      Proposal sections: ${r.orchestratorStages.proposalSections ?? "N/A"}`);

  console.log(`    Core 7 scorecard (${(r.coreScore * 100).toFixed(0)}%):`);
  for (const dim of r.coreScorecard) {
    console.log(`      ${dim.passed ? "PASS" : "FAIL"} ${dim.dimension} (${(dim.score * 100).toFixed(0)}%, w=${dim.weight})`);
  }

  console.log(`    Category scorecard (${(r.categoryScore * 100).toFixed(0)}%):`);
  for (const check of r.categoryScorecard) {
    console.log(`      ${check.passed ? "PASS" : "FAIL"} ${check.checkId}`);
  }

  if (r.failureModes.length > 0) {
    console.log(`    Failure modes (${r.failureModes.length}):`);
    for (const f of r.failureModes) {
      console.log(`      [${f.severity}] ${f.id}: ${f.symptom}`);
    }
  }

  if (r.improvementPlan.length > 0) {
    console.log(`    Improvement plan (${r.improvementPlan.length} actions):`);
    for (const a of r.improvementPlan.slice(0, 3)) {
      console.log(`      #${a.priority} [${a.effortEstimate}] ${a.action.slice(0, 80)}`);
    }
  }
}

function buildSuiteReport(
  results: ProposalDiagnosticResult[],
  apiUrl: string,
  totalMs: number,
): ProposalSuiteReport {
  const passed = results.filter((r) => r.passed).length;

  // Cross-cutting failure mode frequency
  const failureModeFreq = new Map<string, number>();
  for (const r of results) {
    for (const f of r.failureModes) {
      failureModeFreq.set(f.id, (failureModeFreq.get(f.id) ?? 0) + 1);
    }
  }
  const commonFailureModes = [...failureModeFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, count }));

  const totalImprovementActions = results.reduce(
    (sum, r) => sum + r.improvementPlan.length,
    0,
  );

  const avgCoreScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.coreScore, 0) / results.length
      : 0;
  const avgCategoryScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.categoryScore, 0) / results.length
      : 0;

  const perCategory: Record<string, number> = {};
  for (const r of results) {
    perCategory[r.category] = r.latencyMs;
  }

  return {
    runAt: new Date().toISOString(),
    apiBaseUrl: apiUrl,
    totalCategories: results.length,
    passedCategories: passed,
    failedCategories: results.length - passed,
    categoryResults: results,
    crossCuttingSummary: {
      avgCoreScore: Math.round(avgCoreScore * 100) / 100,
      avgCategoryScore: Math.round(avgCategoryScore * 100) / 100,
      commonFailureModes,
      totalImprovementActions,
    },
    latencyMs: { total: totalMs, perCategory },
  };
}

function printSuiteSummary(report: ProposalSuiteReport): void {
  console.log("\n=== Proposal Suite Summary ===");
  console.log(`Categories: ${report.passedCategories}/${report.totalCategories} passed`);
  console.log(`Avg core score: ${(report.crossCuttingSummary.avgCoreScore * 100).toFixed(0)}%`);
  console.log(`Avg category score: ${(report.crossCuttingSummary.avgCategoryScore * 100).toFixed(0)}%`);
  if (report.crossCuttingSummary.commonFailureModes.length > 0) {
    console.log(`Common failure modes:`);
    for (const f of report.crossCuttingSummary.commonFailureModes.slice(0, 5)) {
      console.log(`  ${f.id}: ${f.count}/${report.totalCategories} categories`);
    }
  }
  console.log(`Improvement actions: ${report.crossCuttingSummary.totalImprovementActions}`);
  console.log(`Total time: ${(report.latencyMs.total / 1000).toFixed(1)}s`);
  for (const [cat, ms] of Object.entries(report.latencyMs.perCategory)) {
    console.log(`  ${cat}: ${(ms / 1000).toFixed(1)}s`);
  }
}

// ── verify-questions subcommand ──────────────────────────────────────────────

program
  .command("verify-questions")
  .description("Verify stored opportunity questions against live form URL")
  .requiredOption("--api-url <url>", "Funding API base URL (e.g. http://localhost:3001)")
  .requiredOption("--opportunity <id>", "Opportunity ID to verify")
  .option("--timeout <ms>", "Request timeout in ms", "120000")
  .option("--output <path>", "Output JSON report path")
  .action(async (options) => {
    const apiUrl = options.apiUrl.replace(/\/$/, "");
    const timeoutMs = parseInt(options.timeout, 10) || 120_000;

    const verifier = new QuestionVerifier(apiUrl, timeoutMs);

    console.log(`\nVerifying questions for: ${options.opportunity}`);
    console.log(`API: ${apiUrl}\n`);

    const result = await verifier.verify(options.opportunity);

    // Print results
    console.log(`Stored sections: ${result.storedSectionCount}`);
    console.log(`Extracted sections: ${result.extractedSectionCount}`);
    console.log(`Matched: ${result.matched.length}`);

    if (result.matched.length > 0) {
      console.log("\nMatched sections:");
      for (const m of result.matched) {
        const wordNote = m.wordLimitMatch
          ? ""
          : ` ⚠ word limit: stored=${m.storedWordLimit ?? "none"} vs extracted=${m.extractedWordLimit ?? "none"}`;
        console.log(`  ✓ "${m.storedName}" ↔ "${m.extractedName}" (sim=${m.similarity.toFixed(2)})${wordNote}`);
      }
    }

    if (result.missingSections.length > 0) {
      console.log("\nMissing (stored but not found in live form):");
      for (const s of result.missingSections) {
        console.log(`  ✗ ${s}`);
      }
    }

    if (result.extraSections.length > 0) {
      console.log("\nExtra (in live form but not stored):");
      for (const s of result.extraSections) {
        console.log(`  + ${s}`);
      }
    }

    console.log(`\nResult: ${result.passed ? "PASS" : "FAIL"} — ${result.summary}`);

    if (options.output) {
      const outputPath = path.isAbsolute(options.output)
        ? options.output
        : path.resolve(process.cwd(), options.output);
      await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
      console.log(`Report: ${outputPath}`);
    }
  });

program.parse();
