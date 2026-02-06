#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import { FundingApiClient } from "./runner/funding-api-client.js";
import { FundingEvaluator } from "./runner/funding-evaluator.js";
import type { FundingCaseResult, FundingTestCase } from "./types.js";

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

program.parse();
