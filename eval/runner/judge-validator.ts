/**
 * Judge Validator — Compares two eval reports to measure LLM judge agreement.
 *
 * Use cases:
 *   1. Cross-provider validation: Gemini vs Deepseek (are judges consistent?)
 *   2. Cross-run stability:      same provider, different runs (is the judge flaky?)
 *   3. Code-change regression:   same cases before/after a code change
 *
 * Reads the standard EvaluationReport JSON format produced by the eval runner.
 * Outputs a structured agreement report with Cohen's kappa, per-check stats,
 * and a ranked list of the most-disagreed cases.
 *
 * No new dependencies — pure TypeScript + Node built-ins.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { EvaluationReport, EvaluationResult, LLMJudgeResult } from "../types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface JudgeAgreementReport {
  meta: {
    generatedAt: string;
    reportA: { path: string; runId: string; llmProvider: string; timestamp: string };
    reportB: { path: string; runId: string; llmProvider: string; timestamp: string };
    casesCompared: number;
    casesSkipped: number;
    skippedReasons: string[];
  };
  overall: {
    totalComparisons: number;
    agreementCount: number;
    agreementPct: number;
    cohensKappa: number;
    interpretation: string; // "poor" | "slight" | "fair" | "moderate" | "substantial" | "almost_perfect"
  };
  perCheck: PerCheckStats[];
  disagreements: Disagreement[];
  unstableChecks: PerCheckStats[]; // checks with agreement < 80%
  recommendations: string[];
}

export interface PerCheckStats {
  checkId: string;
  totalPairs: number;
  agreementCount: number;
  agreementPct: number;
  cohensKappa: number;
  interpretation: string;
  reportAPassCount: number;
  reportBPassCount: number;
  reportAPassPct: number;
  reportBPassPct: number;
}

export interface Disagreement {
  testCaseId: string;
  checkId: string;
  reportAPassed: boolean;
  reportBPassed: boolean;
  reportAEvidence: string;
  reportBEvidence: string;
  reportAConsensus: string;
  reportBConsensus: string;
  responseSnippet: string; // first 200 chars of response
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Cohen's kappa for binary agreement.
 *
 *   kappa = (po - pe) / (1 - pe)
 *
 * where po = observed agreement, pe = expected agreement by chance.
 */
function cohensKappa(
  bothPass: number,
  bothFail: number,
  aPassBFail: number,
  aFailBPass: number,
): number {
  const total = bothPass + bothFail + aPassBFail + aFailBPass;
  if (total === 0) return 1; // nothing to compare

  const po = (bothPass + bothFail) / total;

  const aPassRate = (bothPass + aPassBFail) / total;
  const bPassRate = (bothPass + aFailBPass) / total;
  const pe = aPassRate * bPassRate + (1 - aPassRate) * (1 - bPassRate);

  if (pe === 1) return 1; // perfect expected agreement
  return (po - pe) / (1 - pe);
}

function kappaInterpretation(k: number): string {
  if (k < 0) return "poor";
  if (k < 0.21) return "slight";
  if (k < 0.41) return "fair";
  if (k < 0.61) return "moderate";
  if (k < 0.81) return "substantial";
  return "almost_perfect";
}

function snippet(text: string, maxLen = 200): string {
  if (!text) return "";
  const clean = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + "..." : clean;
}

// ─── Core comparison ────────────────────────────────────────────────────────

/**
 * Build a lookup: testCaseId -> checkId -> LLMJudgeResult
 */
function buildLookup(
  results: EvaluationResult[],
): Map<string, Map<string, LLMJudgeResult>> {
  const lookup = new Map<string, Map<string, LLMJudgeResult>>();
  for (const r of results) {
    if (!r.llmJudgeResults) continue;
    const checks = new Map<string, LLMJudgeResult>();
    for (const jr of r.llmJudgeResults) {
      checks.set(jr.checkId, jr);
    }
    lookup.set(r.testCaseId, checks);
  }
  return lookup;
}

/**
 * Build a lookup: testCaseId -> responseText
 */
function buildResponseLookup(results: EvaluationResult[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const r of results) {
    lookup.set(r.testCaseId, r.responseText || "");
  }
  return lookup;
}

/**
 * Compare two eval reports and produce an agreement report.
 */
export function compareReports(
  reportA: EvaluationReport,
  reportB: EvaluationReport,
  pathA: string,
  pathB: string,
): JudgeAgreementReport {
  const lookupA = buildLookup(reportA.results);
  const lookupB = buildLookup(reportB.results);
  const responsesA = buildResponseLookup(reportA.results);
  const responsesB = buildResponseLookup(reportB.results);

  // Find common test case IDs that have LLM judge results in both
  const commonCaseIds = [...lookupA.keys()].filter((id) => lookupB.has(id));
  const skippedReasons: string[] = [];

  // Cases in A but not B
  const aOnly = [...lookupA.keys()].filter((id) => !lookupB.has(id));
  if (aOnly.length > 0) {
    skippedReasons.push(
      `${aOnly.length} case(s) in report A but not B: ${aOnly.slice(0, 5).join(", ")}${aOnly.length > 5 ? "..." : ""}`,
    );
  }
  // Cases in B but not A
  const bOnly = [...lookupB.keys()].filter((id) => !lookupA.has(id));
  if (bOnly.length > 0) {
    skippedReasons.push(
      `${bOnly.length} case(s) in report B but not A: ${bOnly.slice(0, 5).join(", ")}${bOnly.length > 5 ? "..." : ""}`,
    );
  }

  // Collect all unique check IDs across common cases
  const allCheckIds = new Set<string>();
  for (const caseId of commonCaseIds) {
    const checksA = lookupA.get(caseId)!;
    const checksB = lookupB.get(caseId)!;
    for (const id of checksA.keys()) allCheckIds.add(id);
    for (const id of checksB.keys()) allCheckIds.add(id);
  }

  // Per-check accumulators
  const perCheckAccum = new Map<
    string,
    { bp: number; bf: number; apbf: number; afbp: number; aPass: number; bPass: number; total: number }
  >();
  for (const checkId of allCheckIds) {
    perCheckAccum.set(checkId, { bp: 0, bf: 0, apbf: 0, afbp: 0, aPass: 0, bPass: 0, total: 0 });
  }

  // Overall accumulators
  let overallBP = 0;
  let overallBF = 0;
  let overallAPBF = 0;
  let overallAFBP = 0;

  // Disagreements
  const disagreements: Disagreement[] = [];

  for (const caseId of commonCaseIds) {
    const checksA = lookupA.get(caseId)!;
    const checksB = lookupB.get(caseId)!;
    const responseText = responsesA.get(caseId) || responsesB.get(caseId) || "";

    // Compare each check present in either report
    const unionCheckIds = new Set([...checksA.keys(), ...checksB.keys()]);

    for (const checkId of unionCheckIds) {
      const jrA = checksA.get(checkId);
      const jrB = checksB.get(checkId);

      // Skip if either side is missing or skipped
      if (!jrA || !jrB) continue;
      if (jrA.skipped || jrB.skipped) continue;
      if (jrA.error || jrB.error) continue;

      const accum = perCheckAccum.get(checkId);
      if (!accum) continue;

      accum.total++;
      if (jrA.passed) accum.aPass++;
      if (jrB.passed) accum.bPass++;

      if (jrA.passed && jrB.passed) {
        accum.bp++;
        overallBP++;
      } else if (!jrA.passed && !jrB.passed) {
        accum.bf++;
        overallBF++;
      } else if (jrA.passed && !jrB.passed) {
        accum.apbf++;
        overallAPBF++;
        disagreements.push({
          testCaseId: caseId,
          checkId,
          reportAPassed: true,
          reportBPassed: false,
          reportAEvidence: jrA.evidence || "",
          reportBEvidence: jrB.evidence || "",
          reportAConsensus: jrA.consensus || "",
          reportBConsensus: jrB.consensus || "",
          responseSnippet: snippet(responseText),
        });
      } else {
        accum.afbp++;
        overallAFBP++;
        disagreements.push({
          testCaseId: caseId,
          checkId,
          reportAPassed: false,
          reportBPassed: true,
          reportAEvidence: jrA.evidence || "",
          reportBEvidence: jrB.evidence || "",
          reportAConsensus: jrA.consensus || "",
          reportBConsensus: jrB.consensus || "",
          responseSnippet: snippet(responseText),
        });
      }
    }
  }

  // Build per-check stats
  const perCheck: PerCheckStats[] = [];
  for (const [checkId, acc] of perCheckAccum) {
    if (acc.total === 0) continue;
    const agreement = acc.bp + acc.bf;
    const kappa = cohensKappa(acc.bp, acc.bf, acc.apbf, acc.afbp);
    perCheck.push({
      checkId,
      totalPairs: acc.total,
      agreementCount: agreement,
      agreementPct: round((agreement / acc.total) * 100),
      cohensKappa: round(kappa),
      interpretation: kappaInterpretation(kappa),
      reportAPassCount: acc.aPass,
      reportBPassCount: acc.bPass,
      reportAPassPct: round((acc.aPass / acc.total) * 100),
      reportBPassPct: round((acc.bPass / acc.total) * 100),
    });
  }
  // Sort by agreement ascending (worst first)
  perCheck.sort((a, b) => a.agreementPct - b.agreementPct);

  // Overall stats
  const totalComparisons = overallBP + overallBF + overallAPBF + overallAFBP;
  const overallAgreement = overallBP + overallBF;
  const overallKappa = cohensKappa(overallBP, overallBF, overallAPBF, overallAFBP);

  // Sort disagreements: group by case, then by check
  disagreements.sort((a, b) => {
    if (a.testCaseId !== b.testCaseId) return a.testCaseId.localeCompare(b.testCaseId);
    return a.checkId.localeCompare(b.checkId);
  });

  // Unstable checks: agreement < 80%
  const unstableChecks = perCheck.filter((c) => c.agreementPct < 80);

  // Recommendations
  const recommendations = generateRecommendations(perCheck, unstableChecks, overallKappa, totalComparisons);

  const providerA = reportA.config?.llmProvider || "unknown";
  const providerB = reportB.config?.llmProvider || "unknown";

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      reportA: {
        path: pathA,
        runId: reportA.runId,
        llmProvider: providerA,
        timestamp: reportA.timestamp,
      },
      reportB: {
        path: pathB,
        runId: reportB.runId,
        llmProvider: providerB,
        timestamp: reportB.timestamp,
      },
      casesCompared: commonCaseIds.length,
      casesSkipped: aOnly.length + bOnly.length,
      skippedReasons,
    },
    overall: {
      totalComparisons,
      agreementCount: overallAgreement,
      agreementPct: totalComparisons > 0 ? round((overallAgreement / totalComparisons) * 100) : 100,
      cohensKappa: round(overallKappa),
      interpretation: kappaInterpretation(overallKappa),
    },
    perCheck,
    disagreements: disagreements.slice(0, 50), // cap at 50 for readability
    unstableChecks,
    recommendations,
  };
}

function round(n: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function generateRecommendations(
  perCheck: PerCheckStats[],
  unstable: PerCheckStats[],
  overallKappa: number,
  totalComparisons: number,
): string[] {
  const recs: string[] = [];

  if (totalComparisons === 0) {
    recs.push("No LLM judge comparisons found. Ensure both reports have LLM judge results for the same test cases.");
    return recs;
  }

  if (overallKappa < 0.4) {
    recs.push(
      "CRITICAL: Overall kappa < 0.4 — judges disagree too often. Eval scores are unreliable. " +
        "Consider tightening rubric descriptions, adding more concrete pass/fail criteria, or using a single judge provider.",
    );
  } else if (overallKappa < 0.6) {
    recs.push(
      "WARNING: Overall kappa < 0.6 — moderate agreement only. Score changes of <5% may be noise, not signal.",
    );
  } else if (overallKappa >= 0.8) {
    recs.push("Judges show strong agreement (kappa >= 0.8). Eval scores are reliable across providers.");
  }

  for (const check of unstable) {
    if (check.agreementPct < 50) {
      recs.push(
        `REWRITE RUBRIC: "${check.checkId}" has ${check.agreementPct}% agreement — essentially random. ` +
          `The description is too ambiguous for LLM judges to agree on.`,
      );
    } else if (check.agreementPct < 80) {
      recs.push(
        `TIGHTEN RUBRIC: "${check.checkId}" has ${check.agreementPct}% agreement. ` +
          `Add concrete examples of pass/fail to the check description.`,
      );
    }
  }

  // Check for systematic bias (one judge consistently more lenient)
  const biasedChecks = perCheck.filter(
    (c) => Math.abs(c.reportAPassPct - c.reportBPassPct) > 20 && c.totalPairs >= 3,
  );
  if (biasedChecks.length > 0) {
    const avgDiff =
      biasedChecks.reduce((sum, c) => sum + (c.reportAPassPct - c.reportBPassPct), 0) / biasedChecks.length;
    const direction = avgDiff > 0 ? "Report A is more lenient" : "Report B is more lenient";
    recs.push(
      `SYSTEMATIC BIAS detected across ${biasedChecks.length} check(s): ${direction} ` +
        `(avg pass-rate gap: ${Math.abs(round(avgDiff))}%). ` +
        `Checks: ${biasedChecks.map((c) => c.checkId).join(", ")}`,
    );
  }

  if (recs.length === 0) {
    recs.push("Agreement is acceptable. No immediate rubric changes needed.");
  }

  return recs;
}

// ─── Markdown report ────────────────────────────────────────────────────────

export function formatMarkdown(report: JudgeAgreementReport): string {
  const lines: string[] = [];

  lines.push("## Judge Agreement Report");
  lines.push("");
  lines.push(`Generated: ${report.meta.generatedAt}`);
  lines.push(`Report A: ${report.meta.reportA.llmProvider} (${report.meta.reportA.runId})`);
  lines.push(`Report B: ${report.meta.reportB.llmProvider} (${report.meta.reportB.runId})`);
  lines.push(`Cases compared: ${report.meta.casesCompared} | Skipped: ${report.meta.casesSkipped}`);
  lines.push("");

  // Overall
  lines.push("### Overall Agreement");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total comparisons | ${report.overall.totalComparisons} |`);
  lines.push(`| Agreement | ${report.overall.agreementPct}% (${report.overall.agreementCount}/${report.overall.totalComparisons}) |`);
  lines.push(`| Cohen's kappa | ${report.overall.cohensKappa} (${report.overall.interpretation}) |`);
  lines.push("");

  // Per-check table
  lines.push("### Per-Check Agreement");
  lines.push("");
  lines.push(`| Check | Agreement | Kappa | Interp. | A Pass% | B Pass% |`);
  lines.push(`|-------|-----------|-------|---------|---------|---------|`);
  for (const c of report.perCheck) {
    lines.push(
      `| ${c.checkId} | ${c.agreementPct}% | ${c.cohensKappa} | ${c.interpretation} | ${c.reportAPassPct}% | ${c.reportBPassPct}% |`,
    );
  }
  lines.push("");

  // Unstable checks
  if (report.unstableChecks.length > 0) {
    lines.push("### Unstable Rubric Dimensions (agreement < 80%)");
    lines.push("");
    for (const c of report.unstableChecks) {
      lines.push(
        `- **${c.checkId}**: ${c.agreementPct}% agreement, kappa=${c.cohensKappa} (${c.interpretation})`,
      );
    }
    lines.push("");
  }

  // Top disagreements (max 20 for markdown)
  const topDisagreements = report.disagreements.slice(0, 20);
  if (topDisagreements.length > 0) {
    lines.push(`### Top ${topDisagreements.length} Disagreements`);
    lines.push("");
    lines.push(`| Case | Check | A | B | A Evidence | B Evidence |`);
    lines.push(`|------|-------|---|---|------------|------------|`);
    for (const d of topDisagreements) {
      const aResult = d.reportAPassed ? "PASS" : "FAIL";
      const bResult = d.reportBPassed ? "PASS" : "FAIL";
      const aEv = snippet(d.reportAEvidence, 60);
      const bEv = snippet(d.reportBEvidence, 60);
      lines.push(`| ${d.testCaseId} | ${d.checkId} | ${aResult} | ${bResult} | ${aEv} | ${bEv} |`);
    }
    lines.push("");
  }

  // Recommendations
  lines.push("### Recommendations");
  lines.push("");
  for (const rec of report.recommendations) {
    lines.push(`- ${rec}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ─── CLI entry point ────────────────────────────────────────────────────────

export async function runJudgeCompare(options: {
  reportA: string;
  reportB: string;
  output?: string;
  format?: "json" | "markdown" | "both";
}): Promise<JudgeAgreementReport> {
  const resolvedA = path.isAbsolute(options.reportA)
    ? options.reportA
    : path.resolve(process.cwd(), options.reportA);
  const resolvedB = path.isAbsolute(options.reportB)
    ? options.reportB
    : path.resolve(process.cwd(), options.reportB);

  console.log(`Loading report A: ${resolvedA}`);
  const reportA: EvaluationReport = JSON.parse(await fs.readFile(resolvedA, "utf-8"));

  console.log(`Loading report B: ${resolvedB}`);
  const reportB: EvaluationReport = JSON.parse(await fs.readFile(resolvedB, "utf-8"));

  console.log(
    `Report A: ${reportA.results.length} results, provider=${reportA.config?.llmProvider || "unknown"}`,
  );
  console.log(
    `Report B: ${reportB.results.length} results, provider=${reportB.config?.llmProvider || "unknown"}`,
  );

  const agreement = compareReports(reportA, reportB, resolvedA, resolvedB);

  const format = options.format || "both";
  const outputBase = options.output
    ? path.isAbsolute(options.output)
      ? options.output
      : path.resolve(process.cwd(), options.output)
    : null;

  // Console summary
  console.log(`\n--- Judge Agreement Summary ---`);
  console.log(`Cases compared: ${agreement.meta.casesCompared}`);
  console.log(`Overall agreement: ${agreement.overall.agreementPct}%`);
  console.log(`Cohen's kappa: ${agreement.overall.cohensKappa} (${agreement.overall.interpretation})`);
  console.log(`Disagreements: ${agreement.disagreements.length}`);
  console.log(`Unstable checks: ${agreement.unstableChecks.length}`);

  if (agreement.unstableChecks.length > 0) {
    console.log(`\nUnstable checks (agreement < 80%):`);
    for (const c of agreement.unstableChecks) {
      console.log(`  - ${c.checkId}: ${c.agreementPct}% agreement`);
    }
  }

  console.log(`\nRecommendations:`);
  for (const rec of agreement.recommendations) {
    console.log(`  - ${rec}`);
  }

  // Write output files
  if (outputBase) {
    await fs.mkdir(path.dirname(outputBase), { recursive: true });

    if (format === "json" || format === "both") {
      const jsonPath = outputBase.endsWith(".json") ? outputBase : outputBase + ".json";
      await fs.writeFile(jsonPath, JSON.stringify(agreement, null, 2), "utf-8");
      console.log(`\nJSON report saved: ${jsonPath}`);
    }

    if (format === "markdown" || format === "both") {
      const mdPath = outputBase.replace(/\.json$/, "") + ".md";
      await fs.writeFile(mdPath, formatMarkdown(agreement), "utf-8");
      console.log(`Markdown report saved: ${mdPath}`);
    }
  }

  return agreement;
}
