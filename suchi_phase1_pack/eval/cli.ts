#!/usr/bin/env node

import { Command } from "commander";
import { Evaluator } from "./runner/evaluator";
import { ReportGenerator } from "./runner/report-generator";
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

      const filteredCases = Evaluator.filterTestCases(testCases, filters);
      console.log(`Running ${filteredCases.length} test case(s)...`);

      // Create evaluator
      const evaluator = new Evaluator(config, rubricPack);

      // Run evaluation
      const results = await evaluator.evaluateTestCases(filteredCases);

      // Generate report
      const reportGenerator = new ReportGenerator();
      const report = reportGenerator.generateReport(results, config);

      // Save report
      const outputPath = path.resolve(process.cwd(), options.output);
      await reportGenerator.exportToFile(report, outputPath);
      console.log(`\nReport saved to: ${outputPath}`);

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

