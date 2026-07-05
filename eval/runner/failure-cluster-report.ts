/**
 * Failure-cluster report for weekly review (issue #48, Part 3)
 *
 * Groups per-case evaluation records into named failure clusters
 * (retrieval-miss, citation-fabricated, citation-missing, citation-format,
 * citation-confidence, safety, quality, execution-error) and renders both a
 * machine-readable JSON report and a reviewer-friendly Markdown summary.
 *
 * Every clustered entry names the test case, suite file, intent, risk
 * category, failed citation rules, retrieval path, sources, and unsupported
 * claims — a reviewer can identify which claim, case, source, retrieval path,
 * and citation rule caused each failure without opening raw logs.
 */

import * as fs from "fs/promises";
import type { CaseEvaluationRecord } from "./case-record";

export const CLUSTER_ORDER = [
  "retrieval-miss",
  "citation-fabricated",
  "citation-missing",
  "citation-format",
  "citation-confidence",
  "safety",
  "execution-error",
  "quality",
] as const;

export interface ClusterCaseEntry {
  testId: string;
  suiteFile?: string;
  runId: string;
  intent: string;
  riskCategory: string;
  cancer?: string;
  passed: boolean;
  score: number;
  retrievalPath: string;
  retrievedCount: number;
  topSources: string[];
  citationCount: number;
  supportingCitationCount: number;
  failedCitationRules: Array<{ ruleId: string; description: string }>;
  citationIssues: Array<{ code: string; reason: string }>;
  requiredCheckFailures: string[];
  unsupportedClaims: string[];
  error?: string;
}

export interface FailureClusterReport {
  generatedAt: string;
  runIds: string[];
  totalCases: number;
  failedCases: number;
  clusters: Array<{
    cluster: string;
    count: number;
    caseIds: string[];
    cases: ClusterCaseEntry[];
  }>;
}

function toEntry(record: CaseEvaluationRecord): ClusterCaseEntry {
  return {
    testId: record.testId,
    suiteFile: record.suiteFile,
    runId: record.runId,
    intent: record.intent,
    riskCategory: record.riskCategory,
    cancer: record.cancer,
    passed: record.outcome.passed,
    score: record.outcome.score,
    retrievalPath: record.retrieval.retrievalPath,
    retrievedCount: record.retrieval.retrievedCount,
    topSources: record.retrieval.sources
      .slice(0, 3)
      .map((s) => `#${s.rank} ${s.docId}${s.sourceType ? ` (${s.sourceType})` : ""}`),
    citationCount: record.citations.count,
    supportingCitationCount: record.citationIntegrity.supportingCitationCount,
    failedCitationRules: record.citationIntegrity.rules
      .filter((r) => r.applicable && !r.passed)
      .map((r) => ({ ruleId: r.ruleId, description: r.description })),
    citationIssues: record.citationIssues.map((i) => ({
      code: i.code,
      reason: i.reason,
    })),
    requiredCheckFailures: record.outcome.requiredCheckFailures,
    unsupportedClaims: record.claims.items
      .filter((c) => !c.supported)
      .slice(0, 3)
      .map((c) => c.text),
    error: record.outcome.error,
  };
}

export function generateClusterReport(
  records: CaseEvaluationRecord[]
): FailureClusterReport {
  const byCluster = new Map<string, CaseEvaluationRecord[]>();

  for (const record of records) {
    // A passing case with advisory flags still surfaces in fabrication/format
    // clusters (flagged), but pure quality clusters only track failures.
    for (const cluster of record.failureClusters) {
      if (!byCluster.has(cluster)) byCluster.set(cluster, []);
      byCluster.get(cluster)!.push(record);
    }
  }

  const orderedClusters = [
    ...CLUSTER_ORDER.filter((c) => byCluster.has(c)),
    ...[...byCluster.keys()].filter(
      (c) => !(CLUSTER_ORDER as readonly string[]).includes(c)
    ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    runIds: [...new Set(records.map((r) => r.runId))],
    totalCases: records.length,
    failedCases: records.filter((r) => !r.outcome.passed).length,
    clusters: orderedClusters.map((cluster) => {
      const clusterRecords = byCluster.get(cluster)!;
      return {
        cluster,
        count: clusterRecords.length,
        caseIds: clusterRecords.map((r) => r.testId),
        cases: clusterRecords.map(toEntry),
      };
    }),
  };
}

export function clusterReportToMarkdown(report: FailureClusterReport): string {
  const lines: string[] = [];
  lines.push("# Failure Cluster Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Runs: ${report.runIds.join(", ")}`);
  lines.push(
    `Cases: ${report.totalCases} total, ${report.failedCases} failed, ${report.clusters.length} active clusters`
  );
  lines.push("");
  lines.push("| Cluster | Cases | Case IDs |");
  lines.push("|---------|-------|----------|");
  for (const c of report.clusters) {
    lines.push(`| ${c.cluster} | ${c.count} | ${c.caseIds.slice(0, 8).join(", ")}${c.caseIds.length > 8 ? ", …" : ""} |`);
  }
  lines.push("");

  for (const c of report.clusters) {
    lines.push(`## Cluster: ${c.cluster} (${c.count})`);
    lines.push("");
    for (const entry of c.cases) {
      lines.push(
        `### ${entry.testId} — ${entry.intent} [${entry.riskCategory}]${entry.passed ? " (passed, flagged)" : ""}`
      );
      if (entry.suiteFile) lines.push(`- Suite: \`${entry.suiteFile}\``);
      lines.push(`- Score: ${(entry.score * 100).toFixed(1)}%`);
      lines.push(
        `- Retrieval path: ${entry.retrievalPath} (${entry.retrievedCount} chunks)` +
          (entry.topSources.length > 0 ? ` — top: ${entry.topSources.join("; ")}` : "")
      );
      lines.push(
        `- Citations: ${entry.citationCount} total, ${entry.supportingCitationCount} supporting`
      );
      if (entry.failedCitationRules.length > 0) {
        lines.push(
          `- Failed citation rules: ${entry.failedCitationRules
            .map((r) => `${r.ruleId} (${r.description})`)
            .join("; ")}`
        );
      }
      for (const issue of entry.citationIssues) {
        lines.push(`- Issue [${issue.code}]: ${issue.reason}`);
      }
      if (entry.requiredCheckFailures.length > 0) {
        lines.push(`- Failed required checks: ${entry.requiredCheckFailures.join(", ")}`);
      }
      if (entry.unsupportedClaims.length > 0) {
        lines.push(`- Unsupported claims (sample):`);
        for (const claim of entry.unsupportedClaims) {
          lines.push(`  - "${claim}"`);
        }
      }
      if (entry.error) lines.push(`- Execution error: ${entry.error}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function writeClusterReport(
  report: FailureClusterReport,
  basePath: string
): Promise<{ jsonPath: string; mdPath: string }> {
  const jsonPath = basePath.endsWith(".json") ? basePath : `${basePath}.json`;
  const mdPath = jsonPath.replace(/\.json$/, ".md");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  await fs.writeFile(mdPath, clusterReportToMarkdown(report), "utf-8");
  return { jsonPath, mdPath };
}
