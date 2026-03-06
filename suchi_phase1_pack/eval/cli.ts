#!/usr/bin/env node

import { Command } from "commander";
import { Evaluator } from "./runner/evaluator";
import { ReportGenerator } from "./runner/report-generator";
import { ApiClient } from "./runner/api-client";
import { VoiceEvaluator } from "./runner/voice-evaluator";
import { VoiceReportGenerator } from "./runner/voice-report-generator";
import { loadConfig } from "./config/loader";
import * as path from "path";
import * as fs from "fs/promises";

const program = new Command();

program
  .name("eval")
  .description("Suchi Bot Evaluation Framework")
  .version("1.0.0");

program
  .command("run")
  .description("Run evaluation tests")
  .option("-c, --case <id>", "Run specific test case by ID")
  .option("-t, --tier <number>", "Run tests for specific tier", parseInt)
  .option("--cancer <type>", "Filter by cancer type")
  .option("--intent <type>", "Filter by intent type")
  .option("--cases <path>", "Path to test cases YAML file", "cases/tier1/common_cancers_20_mode_matrix.yaml")
  .option("--rubrics <path>", "Path to rubrics JSON file", "rubrics/rubrics.v1.json")
  .option("--config <path>", "Path to config file")
  .option("--output <path>", "Output path for report JSON", "report.json")
  .option("--summary", "Print summary to console")
  .option("--batch-size <number>", "Run tests in batches of N cases", parseInt)
  .action(async (options) => {
    try {
      console.log("Loading configuration...");
      const config = await loadConfig(options.config);

      console.log("Loading test cases...");
      const casesPath = path.isAbsolute(options.cases)
        ? options.cases
        : path.resolve(process.cwd(), options.cases);
      const testCases = await Evaluator.loadTestCases(casesPath);

      console.log("Loading rubrics...");
      const rubricsPath = path.isAbsolute(options.rubrics)
        ? options.rubrics
        : path.resolve(process.cwd(), options.rubrics);
      const rubricPack = await Evaluator.loadRubrics(rubricsPath);

      // Filter test cases
      const filters: any = {};
      if (options.case) filters.caseId = options.case;
      if (options.tier) filters.tier = options.tier;
      if (options.cancer) filters.cancer = options.cancer;
      if (options.intent) filters.intent = options.intent;

      // ✅ PREFLIGHT: Validate filters before running any tests
      const validation = Evaluator.validateFilters(testCases, filters);

      // Print discovered values
      console.log(`\n📋 Test Suite Summary:`);
      console.log(`  Total cases in suite: ${validation.totalCases}`);
      console.log(`  Selected cases: ${validation.selectedCases}`);
      if (validation.availableCancerTypes.length > 0) {
        console.log(`  Available cancer types: ${validation.availableCancerTypes.join(', ')}`);
      }
      if (validation.availableIntents.length > 0) {
        console.log(`  Available intents: ${validation.availableIntents.join(', ')}`);
      }

      // Print filter values (canonicalized)
      if (filters.cancer) {
        const { canonicalCancerType } = require('./utils/canonicalize');
        console.log(`  Requested cancer: "${filters.cancer}" → canonicalized to "${canonicalCancerType(filters.cancer)}"`);
      }
      if (filters.intent) {
        const { canonicalIntent } = require('./utils/canonicalize');
        console.log(`  Requested intent: "${filters.intent}" → canonicalized to "${canonicalIntent(filters.intent)}"`);
      }

      // ✅ FAIL-FAST: Abort if filter matches 0 cases
      if (validation.errors.length > 0) {
        console.error(`\n❌ PREFLIGHT VALIDATION FAILED:\n`);
        validation.errors.forEach(err => console.error(`  ${err}`));
        process.exit(1);
      }

      // Warn if selection seems unexpected
      if (validation.warnings.length > 0) {
        console.warn(`\n⚠️  Warnings:`);
        validation.warnings.forEach(warn => console.warn(`  ${warn}`));
        console.warn(`  Continuing anyway...\n`);
      }

      const filteredCases = Evaluator.filterTestCases(testCases, filters);

      // ✅ NEW: Warm-up API to prevent cold start on first test case
      console.log("\n🔥 Warming up API...");
      try {
        const warmupClient = new ApiClient(config.apiBaseUrl, 30000, config.authBearer, 0); // 30s timeout, no retries
        const warmupSession = await warmupClient.createSession("web");
        await warmupClient.sendMessage(
          warmupSession,
          "What is cancer?", // Simple query
          "web"
        );
        console.log("✅ API warmed up\n");
      } catch (error: any) {
        console.warn("⚠️ Warm-up failed (continuing anyway):", error.message);
      }

      // Create evaluator and report generator
      const evaluator = new Evaluator(config, rubricPack);
      const reportGenerator = new ReportGenerator();
      const outputPath = path.resolve(process.cwd(), options.output);

      // Apply batching if batch-size is specified
      let results;
      if (options.batchSize && options.batchSize > 0) {
        const batches: typeof filteredCases[] = [];
        for (let i = 0; i < filteredCases.length; i += options.batchSize) {
          batches.push(filteredCases.slice(i, i + options.batchSize));
        }

        console.log(`Running ${filteredCases.length} test case(s) in ${batches.length} batch(es) of ${options.batchSize}...`);

        // Process batches sequentially
        const allResults = [];
        for (let i = 0; i < batches.length; i++) {
          const startCase = i * options.batchSize + 1;
          const endCase = Math.min((i + 1) * options.batchSize, filteredCases.length);
          console.log(`\nBatch ${i + 1}/${batches.length}: Cases ${startCase}-${endCase}`);
          const batchResults = await evaluator.evaluateTestCases(batches[i]);
          allResults.push(...batchResults);

          // ✅ NEW: Write incremental report after each batch
          const partialReport = reportGenerator.generateReport(allResults, config);
          await reportGenerator.exportToFile(partialReport, outputPath);
          console.log(`  💾 Progress saved: ${allResults.length}/${filteredCases.length} cases`);
        }

        results = allResults;
      } else {
        console.log(`Running ${filteredCases.length} test case(s)...`);

        // ✅ NEW: Write after each case for non-batched runs
        const allResults = [];
        for (let i = 0; i < filteredCases.length; i++) {
          console.log(`\n[${i + 1}/${filteredCases.length}] Evaluating ${filteredCases[i].id}...`);
          const result = await evaluator.evaluateTestCase(filteredCases[i]);
          allResults.push(result);

          // Write incremental report after each case
          const partialReport = reportGenerator.generateReport(
            allResults,
            config,
            undefined,
            { loadedCount: testCases.length, selectedCount: filteredCases.length }
          );
          await reportGenerator.exportToFile(partialReport, outputPath);
          console.log(`  💾 Progress saved: ${allResults.length}/${filteredCases.length} cases`);
        }

        results = allResults;
      }

      // ✅ FAIL-FAST: Check if we executed 0 cases
      if (results.length === 0) {
        console.error(`\n❌ ERROR: No test cases were executed!`);
        console.error(`  Selected cases: ${filteredCases.length}`);
        console.error(`  This indicates a filter or execution problem.`);
        process.exit(1);
      }

      // Generate final report
      const report = reportGenerator.generateReport(
        results,
        config,
        undefined,
        { loadedCount: testCases.length, selectedCount: filteredCases.length }
      );

      // Include LLM cost summary if available
      const costSummary = evaluator.getLLMCostSummary();
      if (costSummary && (costSummary.totalCost > 0 || costSummary.fallbackUsedCount > 0)) {
        (report as any).llmCost = {
          totalCost: costSummary.totalCost,
          totalTokens: costSummary.totalTokens,
          callCount: costSummary.callCount,
          fallbackUsedCount: costSummary.fallbackUsedCount,
          formatted: `$${costSummary.totalCost.toFixed(4)} (${costSummary.totalTokens.toLocaleString()} tokens, ${costSummary.callCount} calls)`
        };
        console.log(`\n💰 LLM cost: ${(report as any).llmCost.formatted}`);
        if (costSummary.fallbackUsedCount > 0) {
          console.log(`  🔄 Fallback used: ${costSummary.fallbackUsedCount} times (Gemini Flash)`);
        }
      }

      // ✅ VALIDATION: Check if report is invalid (0 executed)
      if (report.suite?.status === 'INVALID') {
        console.error(`\n❌ ERROR: Report is INVALID - 0 cases executed!`);
        console.error(`  Suite loaded: ${report.suite.loadedCount}`);
        console.error(`  Suite selected: ${report.suite.selectedCount}`);
        console.error(`  Suite executed: ${report.suite.executedCount}`);
        process.exit(1);
      }

      // Save final report (ensures completeness marker)
      await reportGenerator.exportToFile(report, outputPath);
      console.log(`\n✅ Final report saved to: ${outputPath}`);

      // Print summary if requested
      if (options.summary) {
        console.log("\n" + reportGenerator.generateSummaryText(report));
      } else {
        console.log(`\nSummary: ${report.summary.passed}/${report.summary.total} passed`);
        console.log(`Average Score: ${(report.summary.averageScore * 100).toFixed(1)}%`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

program
  .command("voice-e2e")
  .description("Run voice end-to-end evaluation tests")
  .option("--cases <path>", "Path to voice test cases YAML", "cases/voice/voice_e2e_cases.yaml")
  .option("--rubrics <path>", "Path to voice rubrics JSON", "rubrics/voice-rubrics.v1.json")
  .option("--output <path>", "Output path for report JSON", "reports/voice-e2e-report.json")
  .option("--transport <type>", "Transport: http, ws, or both", "http")
  .option("--synthetic", "Generate test audio via TTS (no pre-recorded fixtures needed)")
  .option("--summary", "Print summary to console")
  .action(async (options) => {
    try {
      console.log("Loading configuration...");
      const config = await loadConfig();

      const casesPath = path.isAbsolute(options.cases)
        ? options.cases
        : path.resolve(process.cwd(), options.cases);
      const rubricsPath = path.isAbsolute(options.rubrics)
        ? options.rubrics
        : path.resolve(process.cwd(), options.rubrics);
      const outputPath = path.isAbsolute(options.output)
        ? options.output
        : path.resolve(process.cwd(), options.output);

      // Ensure output directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      const voiceConfig = {
        apiBaseUrl: config.apiBaseUrl,
        transport: options.transport as 'http' | 'ws' | 'both',
        synthetic: !!options.synthetic,
        casesPath,
        outputPath,
        rubricsPath,
        authBearer: config.authBearer,
        timeoutMs: config.timeoutMs || 120000,
      };

      console.log(`\n📋 Voice E2E Config:`);
      console.log(`  API: ${voiceConfig.apiBaseUrl}`);
      console.log(`  Transport: ${voiceConfig.transport}`);
      console.log(`  Synthetic: ${voiceConfig.synthetic}`);
      console.log(`  Cases: ${casesPath}`);
      console.log(`  Output: ${outputPath}`);

      // Load test cases
      console.log("\nLoading voice test cases...");
      const testCases = await VoiceEvaluator.loadTestCases(casesPath);
      console.log(`  Loaded ${testCases.length} test cases`);

      // Create evaluator
      const evaluator = new VoiceEvaluator(voiceConfig);
      await evaluator.loadRubrics(rubricsPath);

      // Run evaluation
      console.log(`\nRunning voice E2E evaluation...`);
      const results = await evaluator.evaluateAll(testCases);

      // Generate report
      const reportGenerator = new VoiceReportGenerator();
      const report = reportGenerator.generateReport(results, voiceConfig);

      // Save report
      await reportGenerator.exportToFile(report, outputPath);
      console.log(`\n✅ Report saved to: ${outputPath}`);

      // Print summary
      if (options.summary) {
        console.log("\n" + reportGenerator.generateSummaryText(report));
      } else {
        console.log(`\nSummary: ${report.summary.passed}/${report.summary.total} passed (${(report.summary.passRate * 100).toFixed(1)}%)`);
      }

      // Exit with non-zero if suite failed
      if (report.summary.passed < 5 && report.summary.total >= 6) {
        console.error(`\n❌ Suite FAILED: only ${report.summary.passed}/6 cases passed (threshold: 5/6)`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      if (error.stack) console.error(error.stack);
      process.exit(1);
    }
  });

program
  .command("report")
  .description("Generate report from existing results")
  .option("--input <path>", "Path to results JSON file", "report.json")
  .option("--output <path>", "Output path for formatted report")
  .option("--format <type>", "Report format: json, text", "text")
  .action(async (options) => {
    try {
      const inputPath = path.resolve(process.cwd(), options.input);
      const content = await fs.readFile(inputPath, "utf-8");
      const report = JSON.parse(content);

      const reportGenerator = new ReportGenerator();

      if (options.format === "text") {
        const summary = reportGenerator.generateSummaryText(report);
        if (options.output) {
          await fs.writeFile(options.output, summary, "utf-8");
          console.log(`Report saved to: ${options.output}`);
        } else {
          console.log(summary);
        }
      } else {
        if (options.output) {
          await fs.writeFile(options.output, JSON.stringify(report, null, 2), "utf-8");
          console.log(`Report saved to: ${options.output}`);
        } else {
          console.log(JSON.stringify(report, null, 2));
        }
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

program.parse();
