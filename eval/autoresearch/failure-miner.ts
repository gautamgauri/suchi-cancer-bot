/**
 * Autoresearch v0 — Failure Miner
 *
 * Reads an eval report JSON and clusters failures into ranked buckets
 * by type, severity, and frequency.
 */

import type { EvaluationReport, EvaluationResult } from "../types";
import type { FailureBucket, SeverityLevel } from "./types";

// ── Severity classification ─────────────────────────────────────────────────

const P0_CHECK_IDS = new Set([
  "no_diagnosis_language",
  "disclaimer_present",
  "no_prognosis",
  "no_dosage",
  "crisis_response",
  "emergency_response",
  "no_misinformation",
]);

const P1_CHECK_IDS = new Set([
  "citation_contract",
  "has_citations",
  "has_warning_signs",
  "has_tests",
  "has_doctor_questions",
  "completeness",
  "tone_empathetic",
  "groundedness",
  "abstention_appropriate",
]);

function classifyCheckSeverity(checkId: string): SeverityLevel {
  if (P0_CHECK_IDS.has(checkId)) return "P0";
  if (P1_CHECK_IDS.has(checkId)) return "P1";
  return "P2";
}

// ── Failure type labelling ──────────────────────────────────────────────────

function labelFailureType(checkId: string): string {
  if (checkId.startsWith("no_diagnosis") || checkId.startsWith("no_prognosis") || checkId.startsWith("no_dosage")) {
    return "safety";
  }
  if (checkId === "disclaimer_present" || checkId === "disclaimer") {
    return "disclaimer";
  }
  if (checkId === "crisis_response" || checkId === "emergency_response") {
    return "safety";
  }
  if (checkId.includes("citation") || checkId === "has_citations") {
    return "citation";
  }
  if (checkId.includes("warning_sign") || checkId.includes("tests") || checkId.includes("doctor_question")) {
    return "completeness";
  }
  if (checkId.includes("tone") || checkId.includes("empathetic")) {
    return "tone";
  }
  if (checkId.includes("grounded") || checkId === "groundedness") {
    return "grounding";
  }
  if (checkId.includes("abstention")) {
    return "abstention";
  }
  return "other";
}

// ── Mine failures from report ───────────────────────────────────────────────

export function mineFailures(report: EvaluationReport): FailureBucket[] {
  const bucketMap = new Map<string, FailureBucket>();

  for (const result of report.results) {
    if (result.passed) continue;

    // Gather all failed check IDs from deterministic + LLM judge
    const failedChecks: Array<{ checkId: string; reason: string }> = [];

    for (const dr of result.deterministicResults) {
      if (!dr.passed) {
        failedChecks.push({
          checkId: dr.checkId,
          reason: dr.error || `Deterministic check ${dr.checkId} failed`,
        });
      }
    }

    if (result.llmJudgeResults) {
      for (const lr of result.llmJudgeResults) {
        if (!lr.passed && !lr.skipped) {
          failedChecks.push({
            checkId: lr.checkId,
            reason: lr.evidence || lr.error || `LLM judge check ${lr.checkId} failed`,
          });
        }
      }
    }

    // If no specific check failures but case failed, bucket as "unknown"
    if (failedChecks.length === 0 && result.error) {
      failedChecks.push({
        checkId: result.errorStep || "execution_error",
        reason: result.error,
      });
    }

    // Group by failure type
    for (const fc of failedChecks) {
      const failureType = labelFailureType(fc.checkId);
      const key = failureType;

      if (bucketMap.has(key)) {
        const bucket = bucketMap.get(key)!;
        bucket.count++;
        if (!bucket.affectedCaseIds.includes(result.testCaseId)) {
          bucket.affectedCaseIds.push(result.testCaseId);
        }
        if (!bucket.failedCheckIds.includes(fc.checkId)) {
          bucket.failedCheckIds.push(fc.checkId);
        }
        // Update severity to worst seen
        const newSeverity = classifyCheckSeverity(fc.checkId);
        if (severityRank(newSeverity) < severityRank(bucket.severity)) {
          bucket.severity = newSeverity;
        }
      } else {
        const query = extractQuery(result);
        bucketMap.set(key, {
          failureType,
          severity: classifyCheckSeverity(fc.checkId),
          affectedCaseIds: [result.testCaseId],
          count: 1,
          representative: {
            caseId: result.testCaseId,
            query,
            responseExcerpt: result.responseText?.slice(0, 300) || "(no response)",
            failureReason: fc.reason,
          },
          failedCheckIds: [fc.checkId],
        });
      }
    }
  }

  // Sort by severity (P0 first), then by count descending
  return [...bucketMap.values()].sort((a, b) => {
    const sevDiff = severityRank(a.severity) - severityRank(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return b.count - a.count;
  });
}

// ── Score snapshot from report ───────────────────────────────────────────────

import type { ScoreSnapshot } from "./types";

export function extractScoreSnapshot(report: EvaluationReport): ScoreSnapshot {
  const perCheck: Record<string, { passRate: number; count: number }> = {};

  // Aggregate deterministic check pass rates
  const checkCounts = new Map<string, { passed: number; total: number }>();
  for (const result of report.results) {
    for (const dr of result.deterministicResults) {
      const existing = checkCounts.get(dr.checkId) || { passed: 0, total: 0 };
      existing.total++;
      if (dr.passed) existing.passed++;
      checkCounts.set(dr.checkId, existing);
    }
    if (result.llmJudgeResults) {
      for (const lr of result.llmJudgeResults) {
        if (lr.skipped) continue;
        const existing = checkCounts.get(lr.checkId) || { passed: 0, total: 0 };
        existing.total++;
        if (lr.passed) existing.passed++;
        checkCounts.set(lr.checkId, existing);
      }
    }
  }

  for (const [checkId, counts] of checkCounts) {
    perCheck[checkId] = {
      passRate: counts.total > 0 ? counts.passed / counts.total : 0,
      count: counts.total,
    };
  }

  // Count P0 failures
  let p0Failures = 0;
  for (const result of report.results) {
    if (result.passed) continue;
    for (const dr of result.deterministicResults) {
      if (!dr.passed && P0_CHECK_IDS.has(dr.checkId)) {
        p0Failures++;
        break; // count each case only once for P0
      }
    }
  }

  return {
    overall: report.summary.averageScore,
    passRate: report.summary.total > 0 ? report.summary.passed / report.summary.total : 0,
    totalCases: report.summary.total,
    passedCases: report.summary.passed,
    failedCases: report.summary.failed,
    citationCoverageRate: report.summary.retrievalQuality?.citationCoverageRate ?? 0,
    p0Failures,
    perCheck,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function severityRank(s: SeverityLevel): number {
  return s === "P0" ? 0 : s === "P1" ? 1 : 2;
}

function extractQuery(result: EvaluationResult): string {
  // The test case query is not stored in the result directly;
  // we use the testCaseId as a proxy
  return result.testCaseId;
}
