#!/usr/bin/env node
/**
 * Phase 2 journey eval runner (FR-JOURNEY-001..006).
 *
 * Runs cases/tier1/phase2_journeys.yaml against the API and scores the
 * deterministic expectations (mustContain / mustNotContain / mustMatch /
 * safetyClassification / softRedirect). The rubric block in each case is
 * informational for human review — not scored here.
 *
 * Usage: npx ts-node run-journeys.ts [--api <baseUrl>] [--output <path>]
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";
import { ApiClient } from "./runner/api-client";

interface JourneyCase {
  id: string;
  description: string;
  userText: string;
  intent: string;
  mode: string;
  expectedBehavior: {
    mustContain?: string[];
    mustNotContain?: string[];
    mustMatch?: Array<{ pattern: string; description: string }>;
    safetyClassification?: string[];
    softRedirect?: boolean;
    [key: string]: any;
  };
}

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

interface CaseResult {
  id: string;
  description: string;
  passed: boolean;
  checks: CheckResult[];
  responseText: string;
  safetyClassification: string;
  citationCount: number;
  latencyMs: number;
  error?: string;
}

function parsePattern(raw: string): RegExp {
  // Patterns in YAML are written like "(?i)(question|ask)" — translate the
  // inline (?i) flag to a JS 'i' flag.
  if (raw.startsWith("(?i)")) return new RegExp(raw.slice(4), "i");
  return new RegExp(raw);
}

function evaluateCase(c: JourneyCase, responseText: string, safety: string, citationCount: number): CheckResult[] {
  const checks: CheckResult[] = [];
  const text = responseText.toLowerCase();
  const eb = c.expectedBehavior;

  for (const phrase of eb.mustContain ?? []) {
    const ok = text.includes(phrase.toLowerCase());
    checks.push({ check: `mustContain: "${phrase}"`, passed: ok, detail: ok ? "found" : "MISSING" });
  }

  for (const phrase of eb.mustNotContain ?? []) {
    const ok = !text.includes(phrase.toLowerCase());
    checks.push({ check: `mustNotContain: "${phrase}"`, passed: ok, detail: ok ? "absent" : "PRESENT (violation)" });
  }

  for (const m of eb.mustMatch ?? []) {
    const ok = parsePattern(m.pattern).test(responseText);
    checks.push({ check: `mustMatch: ${m.description}`, passed: ok, detail: ok ? "matched" : `no match for ${m.pattern}` });
  }

  if (eb.safetyClassification) {
    const ok = eb.safetyClassification.includes(safety);
    checks.push({
      check: `safetyClassification in [${eb.safetyClassification.join(", ")}]`,
      passed: ok,
      detail: `got "${safety}"`,
    });
  }

  if (eb.softRedirect === true) {
    // Soft redirect responses must not be KB-backed — zero citations.
    const ok = citationCount === 0;
    checks.push({ check: "softRedirect: no citations (no RAG)", passed: ok, detail: `${citationCount} citations` });
  }

  return checks;
}

async function main() {
  const args = process.argv.slice(2);
  const apiIdx = args.indexOf("--api");
  const outIdx = args.indexOf("--output");
  const baseUrl = apiIdx >= 0 ? args[apiIdx + 1] : "https://suchi-api-lxiveognla-uc.a.run.app/v1";
  const outputPath = outIdx >= 0 ? args[outIdx + 1] : "reports/journey-report.json";

  const casesPath = path.resolve(__dirname, "cases/tier1/phase2_journeys.yaml");
  const parsed = yaml.load(await fs.readFile(casesPath, "utf-8")) as { cases: JourneyCase[] };

  console.log(`Running ${parsed.cases.length} journey cases against ${baseUrl}\n`);
  const client = new ApiClient(baseUrl);
  const results: CaseResult[] = [];

  for (const c of parsed.cases) {
    process.stdout.write(`▶ ${c.id} ... `);
    const start = Date.now();
    try {
      // Fresh session per case so flagging/safety state doesn't bleed across cases
      const sessionId = await client.createSession("web");
      const res = await client.sendMessage(sessionId, c.userText, "web");
      const citationCount = res.citations?.length ?? 0;
      const checks = evaluateCase(c, res.responseText, res.safety?.classification ?? "unknown", citationCount);
      const passed = checks.every((ch) => ch.passed);
      results.push({
        id: c.id,
        description: c.description,
        passed,
        checks,
        responseText: res.responseText,
        safetyClassification: res.safety?.classification ?? "unknown",
        citationCount,
        latencyMs: Date.now() - start,
      });
      console.log(passed ? "✅ PASS" : "❌ FAIL");
      if (!passed) {
        for (const ch of checks.filter((x) => !x.passed)) {
          console.log(`    ✗ ${ch.check} — ${ch.detail}`);
        }
      }
    } catch (err: any) {
      results.push({
        id: c.id,
        description: c.description,
        passed: false,
        checks: [],
        responseText: "",
        safetyClassification: "error",
        citationCount: 0,
        latencyMs: Date.now() - start,
        error: err.message,
      });
      console.log(`💥 ERROR: ${err.message}`);
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const report = {
    runAt: new Date().toISOString(),
    target: baseUrl,
    totalCases: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    passRate: Math.round((passedCount / results.length) * 1000) / 10,
    results,
  };

  const outFile = path.resolve(__dirname, outputPath);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(report, null, 2));

  console.log(`\n━━━ Journey Eval Summary ━━━`);
  console.log(`Passed: ${passedCount}/${results.length} (${report.passRate}%)`);
  console.log(`Report: ${outFile}`);
  process.exit(passedCount === results.length ? 0 : 1);
}

main();
