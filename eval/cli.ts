#!/usr/bin/env node

import { Command } from "commander";
import { Evaluator } from "./runner/evaluator";
import { ReportGenerator } from "./runner/report-generator";
import { ApiClient } from "./runner/api-client";
import { VoiceEvaluator } from "./runner/voice-evaluator";
import { VoiceReportGenerator } from "./runner/voice-report-generator";
import { runVoiceTranscriptEval } from "./runner/voice-transcript-eval";
import { emailTranscriptReport } from "./runner/transcript-emailer";
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

      // Warm-up API with a small budget so preflight cannot stall the whole run.
      console.log("\n🔥 Warming up API...");
      try {
        const warmupClient = new ApiClient(config.apiBaseUrl, 30000, config.authBearer, 0);
        const warmupSession = await warmupClient.createSession("web");
        await warmupClient.sendMessage(
          warmupSession,
          "What is cancer?",
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

      // Ensure output directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

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

program
  .command("voice-transcript")
  .description("Run voice transcript eval — sends spoken cancer queries as text to /v1/chat and captures transcripts")
  .option("--cases <path>", "Path to voice transcript cases YAML", "cases/voice/voice_transcript_cancer_queries.yaml")
  .option("--output <path>", "Output path for transcript report JSON", "reports/voice-transcript-report.json")
  .option("--summary", "Print full transcript summary to console")
  .option("--email <address>", "Email complete conversation transcript to this address")
  .action(async (options) => {
    try {
      console.log("Loading configuration...");
      const config = await loadConfig();

      const casesPath = path.isAbsolute(options.cases)
        ? options.cases
        : path.resolve(process.cwd(), options.cases);
      const outputPath = path.isAbsolute(options.output)
        ? options.output
        : path.resolve(process.cwd(), options.output);

      console.log(`\n  API: ${config.apiBaseUrl}`);
      console.log(`  Cases: ${casesPath}`);
      console.log(`  Output: ${outputPath}`);

      const report = await runVoiceTranscriptEval({
        casesPath,
        apiBaseUrl: config.apiBaseUrl,
        outputPath,
        timeoutMs: config.timeoutMs || 60000,
        authBearer: config.authBearer,
        summary: !!options.summary,
      });

      // Print concise voice quality summary if not already shown by --summary
      if (!options.summary && report.summary.voiceQuality) {
        const vq = report.summary.voiceQuality;
        console.log(`\nVoice Quality: ${vq.overallPassCount}/${report.summary.total} voice-ready | avg ${vq.avgWordCount} words | ${vq.tooLongCount} too long | ${vq.formattingIssueCount} formatting issues | ${vq.unnaturalLanguageCount} unnatural`);
      }

      if (options.email) {
        await emailTranscriptReport(report, options.email);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      if (error.stack) console.error(error.stack);
      process.exit(1);
    }
  });

program
  .command("release-gate")
  .description("Run the gold eval pack and check release quality thresholds")
  .option("--api-url <url>", "API base URL (overrides config)")
  .option("--save-baseline", "Save scores as new baseline after a DEPLOY verdict")
  .option("--output <path>", "Output path for release gate report JSON", "reports/release-gate-report.json")
  .option("--config <path>", "Path to eval config file")
  .action(async (options) => {
    try {
      const { runReleaseGate } = await import("./runner/release-gate");

      const report = await runReleaseGate({
        apiUrl: options.apiUrl,
        saveBaseline: !!options.saveBaseline,
        outputPath: path.isAbsolute(options.output)
          ? options.output
          : path.resolve(process.cwd(), options.output),
        configPath: options.config,
      });

      // Exit with non-zero if verdict is BLOCK
      if (report.verdict === "BLOCK") {
        process.exit(1);
      }
    } catch (error: any) {
      console.error("Release gate error:", error.message);
      if (error.stack) console.error(error.stack);
      process.exit(1);
    }
  });

program
  .command("judge-compare")
  .description("Compare LLM judge agreement between two eval reports")
  .requiredOption("--report-a <path>", "Path to first eval report JSON")
  .requiredOption("--report-b <path>", "Path to second eval report JSON")
  .option("--output <path>", "Output path for agreement report (writes .json and .md)")
  .option("--format <type>", "Output format: json, markdown, or both", "both")
  .action(async (options) => {
    try {
      const { runJudgeCompare } = await import("./runner/judge-validator");
      await runJudgeCompare({
        reportA: options.reportA,
        reportB: options.reportB,
        output: options.output,
        format: options.format as "json" | "markdown" | "both",
      });
    } catch (error: any) {
      console.error("Error:", error.message);
      if (error.stack) console.error(error.stack);
      process.exit(1);
    }
  });

program
  .command("loop")
  .description("Run quality improvement loop: eval -> diagnose -> plan -> fix -> rerun -> compare")
  .option("--api-url <url>", "API base URL", "http://localhost:3001")
  .option("--dataset <path>", "JSONL dataset path", "../evals/datasets/starter.jsonl")
  .option("--resume <loopId>", "Resume an existing loop by ID")
  .option("--approve", "Approve the repair plan and continue")
  .option("--reject", "Reject the repair plan")
  .option("--reason <text>", "Rejection reason")
  .option("--status <loopId>", "Show status of a loop")
  .action(async (options) => {
    try {
      const {
        startLoop,
        resumeWithApproval,
        resumeWithRejection,
        printStatus,
      } = await import("./loop/loop-runner");
      const { execSync } = await import("child_process");

      // Eval runner function that shells out to the evals runner
      const runEval = async (apiUrl: string, dataset: string) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const outputPath = path.resolve(__dirname, "..", "evals", "artifacts", "runs", `loop-${timestamp}.json`);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });

        const cmd = `cd ${path.resolve(__dirname, "..", "evals")} && npx tsx runners/run-evals.ts --api-url ${apiUrl} --dataset ${dataset} --output ${outputPath}`;
        console.log(`  Running: ${cmd}`);
        execSync(cmd, { stdio: "inherit" });

        const raw = await fs.readFile(outputPath, "utf-8");
        return JSON.parse(raw);
      };

      if (options.status) {
        await printStatus(options.status);
        return;
      }

      if (options.resume) {
        if (options.reject) {
          await resumeWithRejection(options.resume, options.reason);
        } else {
          await resumeWithApproval(options.resume, runEval);
        }
        return;
      }

      // Start new loop
      await startLoop({
        apiUrl: options.apiUrl,
        dataset: options.dataset,
        runEval,
      });
    } catch (error: any) {
      console.error("Loop error:", error.message);
      if (error.stack) console.error(error.stack);
      process.exit(1);
    }
  });

program
  .command("eval-optimize")
  .description("Analyze eval suite quality and propose improvements to test cases, keywords, and rubrics")
  .option("--cases <paths...>", "Paths to eval case YAML files to analyze")
  .option("--reports <paths...>", "Paths to recent eval report JSON files to analyze")
  .option("--rubrics <path>", "Path to rubrics JSON file", "rubrics/rubrics.v1.json")
  .option("--output <dir>", "Output directory for optimizer report", "reports/eval-optimizer")
  .option("--dry-run", "Analyze only, do not call LLM for proposals")
  .action(async (options) => {
    try {
      const { runEvalOptimizer } = await import("./autoresearch/eval-optimizer");

      // Default case paths if not specified
      const defaultCasePaths = [
        "cases/voice/voice_transcript_cancer_queries.yaml",
        "cases/tier1/common_cancers_20_mode_matrix.yaml",
        "cases/gold/core_safety.yaml",
      ];

      // Default report paths if not specified
      const defaultReportPaths = [
        "reports/voice-transcript-report.json",
        "reports/tier1-report.json",
        "reports/tier1-report-v5.json",
      ];

      const casePaths = (options.cases || defaultCasePaths).map((p: string) =>
        path.isAbsolute(p) ? p : path.resolve(process.cwd(), p),
      );

      const reportPaths = (options.reports || defaultReportPaths).map((p: string) =>
        path.isAbsolute(p) ? p : path.resolve(process.cwd(), p),
      );

      const rubricsPath = path.isAbsolute(options.rubrics)
        ? options.rubrics
        : path.resolve(process.cwd(), options.rubrics);

      const outputDir = path.isAbsolute(options.output)
        ? options.output
        : path.resolve(process.cwd(), options.output);

      await runEvalOptimizer({
        casePaths,
        reportPaths,
        rubricsPath,
        outputDir,
        dryRun: !!options.dryRun,
      });
    } catch (error: any) {
      console.error("Eval optimizer error:", error.message);
      if (error.stack) console.error(error.stack);
      process.exit(1);
    }
  });

program
  .command("autoresearch")
  .description("Run Karpathy-style autoresearch loop: mine failures -> hypothesise -> patch -> eval -> gate -> archive")
  .option("--target <cluster>", "Target failure cluster type (e.g. 'citation', 'safety', 'completeness', 'voice_formatting', 'voice_length') or 'all'", "all")
  .option("--mode <mode>", "Mode: 'gold' (default) runs gold eval cases, 'voice' runs voice transcript eval", "gold")
  .option("--max-iterations <n>", "Maximum iterations per run (hard cap: 20)", parseInt, 20)
  .option("--dry-run", "Generate hypotheses and patches but do not apply or eval")
  .option("--api-url <url>", "API base URL", "http://localhost:3001")
  .option("--cases <path>", "Path to gold eval cases YAML", "cases/gold/core_safety.yaml")
  .option("--voice-cases <path>", "Path to voice transcript cases YAML (voice mode)", "cases/voice/voice_transcript_cancer_queries.yaml")
  .option("--voice-report <path>", "Output path for voice transcript baseline report (voice mode)", "reports/voice-autoresearch-baseline.json")
  .option("--rubrics <path>", "Path to rubrics JSON", "rubrics/rubrics.v1.json")
  .option("--manifest <path>", "Path to repairable manifest JSON", "../repairable/manifest.json")
  .option("--auth-bearer <token>", "Optional bearer token for API auth")
  .option("--email <addr>", "Email an HTML summary of the run to this address (uses SMTP_PASS from env or Secret Manager)")
  .option("--run-label <label>", "Label included in the email subject (e.g. 'nightly')", "manual")
  .action(async (options) => {
    try {
      const { runAutoresearch } = await import("./autoresearch/autoresearch-runner");

      const casesPath = path.isAbsolute(options.cases)
        ? options.cases
        : path.resolve(process.cwd(), options.cases);
      const rubricsPath = path.isAbsolute(options.rubrics)
        ? options.rubrics
        : path.resolve(process.cwd(), options.rubrics);
      const manifestPath = path.isAbsolute(options.manifest)
        ? options.manifest
        : path.resolve(process.cwd(), options.manifest);

      const voiceCasesPath = path.isAbsolute(options.voiceCases)
        ? options.voiceCases
        : path.resolve(process.cwd(), options.voiceCases);
      const voiceReportPath = path.isAbsolute(options.voiceReport)
        ? options.voiceReport
        : path.resolve(process.cwd(), options.voiceReport);

      const mode = options.mode === "voice" ? "voice" : "gold";

      await runAutoresearch({
        target: options.target,
        mode,
        maxIterations: options.maxIterations || 20,
        dryRun: !!options.dryRun,
        apiBaseUrl: options.apiUrl,
        goldCasesPath: casesPath,
        rubricsPath,
        manifestPath,
        authBearer: options.authBearer,
        voiceCasesPath: mode === "voice" ? voiceCasesPath : undefined,
        voiceReportPath: mode === "voice" ? voiceReportPath : undefined,
        emailRecipient: options.email,
        runLabel: options.runLabel,
      });
    } catch (error: any) {
      console.error("Autoresearch error:", error.message);
      if (error.stack) console.error(error.stack);
      process.exit(1);
    }
  });

program
  .command("generate-cases")
  .description("Generate randomised eval test cases from dynamic scenario templates")
  .option("--count <number>", "Number of cases to generate", parseInt, 30)
  .option(
    "--language <style>",
    "Language style: english, hinglish, hindi, casual, emotional, typo, or mixed",
    "mixed",
  )
  .option("--cancer <type>", "Cancer type filter: breast, lung, cervical, ... or all", "all")
  .option("--output <path>", "Output YAML file path", "cases/tier2/generated.yaml")
  .action(async (options) => {
    try {
      const { generateCases, casesToYaml } = await import(
        "./cases/tier2/dynamic_scenario_generator"
      );

      const count = options.count || 30;
      const language = options.language || "mixed";
      const cancer = options.cancer || "all";

      console.log(`Generating ${count} test cases (language=${language}, cancer=${cancer})...`);

      const cases = generateCases({ count, language, cancer });
      const yamlContent = casesToYaml(cases);

      const outputPath = path.isAbsolute(options.output)
        ? options.output
        : path.resolve(process.cwd(), options.output);

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, yamlContent, "utf-8");

      console.log(`Generated ${cases.length} test cases -> ${outputPath}`);
    } catch (error: any) {
      console.error("Generate cases error:", error.message);
      if (error.stack) console.error(error.stack);
      process.exit(1);
    }
  });

program.parse();
