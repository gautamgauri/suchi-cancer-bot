/**
 * Structured per-case evaluation records (issue #48, Part 1)
 *
 * For every executed test case we emit one machine-readable record capturing:
 *   - test ID, intent, risk category, expected concepts
 *   - retrieved source IDs and ranks (the retrieval path)
 *   - response claims that require support (heuristic extraction)
 *   - cited source IDs and how each citation resolved
 *   - missing / invalid-citation reasons (issue codes)
 *   - the citation rule results and failure clusters
 *
 * Records are written alongside the existing report as
 * `<report>.records.json` so downstream tooling (failure-cluster report,
 * autoresearch miners, weekly review) can consume them without re-parsing
 * free-form report text.
 */

import * as fs from "fs/promises";
import type { EvaluationReport, EvaluationResult, TestCase } from "../types";
import {
  CitationIntegrityResult,
  verifyCitationIntegrity,
  loadApprovedSources,
  ApprovedCitationSources,
} from "./citation-verifier";

export const CASE_RECORD_SCHEMA_VERSION = 1;

// ── Record shape ─────────────────────────────────────────────────────────────

export interface ClaimRecord {
  index: number;
  /** Claim text, truncated — never raw patient data (eval queries are synthetic) */
  text: string;
  start: number;
  end: number;
  /** docIds of citations whose anchor position falls inside/near this claim */
  citedDocIds: string[];
  supported: boolean;
}

export interface RetrievedSourceRecord {
  rank: number;
  docId: string;
  chunkId: string;
  sourceType?: string | null;
  isTrustedSource?: boolean;
  similarity?: number;
}

export interface CaseEvaluationRecord {
  schemaVersion: number;
  runId: string;
  timestamp: string;
  testId: string;
  suiteFile?: string;
  intent: string;
  riskCategory: string;
  cancer?: string;
  language?: string;
  modality?: string;
  expectedConcepts: {
    sections?: string[];
    tests?: string[];
    phrases?: string[];
    sources?: string[];
    behavior?: string;
    mustNot?: string[];
  };
  evidenceRequired: boolean;
  retrieval: {
    retrievedCount: number;
    /** "rag" when chunks were retrieved, "none" on a retrieval miss, "safety_refusal" when RAG was bypassed */
    retrievalPath: "rag" | "none" | "safety_refusal" | "unknown";
    sources: RetrievedSourceRecord[];
  };
  claims: {
    requiringSupportCount: number;
    supportedCount: number;
    items: ClaimRecord[];
  };
  citations: {
    count: number;
    citedDocIds: string[];
    entries: Array<{
      docId: string;
      chunkId: string;
      position?: number;
      resolution: string;
    }>;
  };
  citationIntegrity: CitationIntegrityResult;
  /** Missing / invalid-citation reasons, machine-readable */
  citationIssues: CitationIntegrityResult["issues"];
  failureClusters: string[];
  outcome: {
    passed: boolean;
    score: number;
    requiredCheckFailures: string[];
    failedLlmChecks: string[];
    error?: string;
    errorStep?: string;
    timedOut?: boolean;
  };
}

// ── Claim extraction ─────────────────────────────────────────────────────────

const MEDICAL_CLAIM_INDICATORS =
  /\b(cancer|tumou?r|symptom|sign|diagnos\w*|screen\w*|biops\w*|chemotherap\w*|radiation|radiotherap\w*|surger\w*|immunotherap\w*|treatment|therapy|stage|staging|prognosis|survival|risk|lump|bleeding|pain|cough|test|scan|x-ray|mri|ct|pet|mammogram|colonoscop\w*|pap|hpv|psa|cells?|lymph|metasta\w*|oncolog\w*|malignan\w*|benign)\b/i;

const NON_CLAIM_PATTERNS = [
  /\?\s*$/, // questions
  /not (a |medical )?(diagnosis|advice)/i, // disclaimers
  /not a substitute|educational purposes|informational purposes/i, // disclaimers
  /consult|talk to (a |your )?(doctor|clinician)|see a doctor/i,
  /i('|’)m sorry|i understand|i can imagine|that (sounds|must be)/i, // empathy
  /^\s*(hi|hello|namaste)\b/i,
  /https?:\/\//i, // reference/link lines, not claims
];

const MIN_CLAIM_LENGTH = 40;
const CLAIM_TEXT_TRUNCATE = 240;
const CITATION_ANCHOR_SLACK = 80; // chars after a claim in which a citation anchor still counts

interface RawSentence {
  text: string;
  start: number;
  end: number;
}

function splitSentences(text: string): RawSentence[] {
  const sentences: RawSentence[] = [];
  // Split on sentence terminators and newlines (bullets become separate units)
  const regex = /[^.!?\n]+[.!?]?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const leading = raw.length - raw.trimStart().length;
    sentences.push({
      text: trimmed,
      start: match.index + leading,
      end: match.index + leading + trimmed.length,
    });
  }
  return sentences;
}

/**
 * Heuristically extract response claims that require KB support: declarative
 * medical statements, excluding questions, disclaimers, and empathy lines.
 * Citation anchors (character positions) are mapped back onto claims.
 */
export function extractClaims(
  responseText: string,
  citations: Array<{ docId: string; position?: number }> = []
): ClaimRecord[] {
  const claims: ClaimRecord[] = [];
  let index = 0;
  for (const s of splitSentences(responseText)) {
    if (s.text.length < MIN_CLAIM_LENGTH) continue;
    if (!MEDICAL_CLAIM_INDICATORS.test(s.text)) continue;
    if (NON_CLAIM_PATTERNS.some((p) => p.test(s.text))) continue;

    const citedDocIds = [
      ...new Set(
        citations
          .filter(
            (c) =>
              typeof c.position === "number" &&
              c.position >= s.start &&
              c.position <= s.end + CITATION_ANCHOR_SLACK
          )
          .map((c) => c.docId)
      ),
    ];

    claims.push({
      index: index++,
      text: s.text.slice(0, CLAIM_TEXT_TRUNCATE),
      start: s.start,
      end: s.end,
      citedDocIds,
      supported: citedDocIds.length > 0,
    });
  }
  return claims;
}

// ── Risk category ────────────────────────────────────────────────────────────

const P0_INTENTS = ["RED_FLAG_URGENT", "CRISIS", "TREATMENT_DOSAGE", "MISINFORMATION"];

export function riskCategoryFor(testCase?: TestCase): string {
  if (testCase?.risk) return testCase.risk;
  if (!testCase) return "unknown";
  if (P0_INTENTS.includes(testCase.intent)) return "P0";
  return "P1";
}

// ── Record builder ───────────────────────────────────────────────────────────

export interface BuildRecordOptions {
  runId: string;
  timestamp?: string;
  suiteFile?: string;
  approvedSources?: ApprovedCitationSources;
}

export function buildCaseRecord(
  result: EvaluationResult,
  testCase: TestCase | undefined,
  options: BuildRecordOptions
): CaseEvaluationRecord {
  const meta = result.responseMetadata || ({} as EvaluationResult["responseMetadata"]);
  const citations = meta.citations ?? [];
  const retrievedChunks = meta.retrievedChunks ?? [];
  const intent = testCase?.intent ?? "UNKNOWN";

  // Reuse the integrity result computed at eval time; recompute for legacy
  // reports that predate the verifier.
  const integrity: CitationIntegrityResult =
    result.citationIntegrity ??
    verifyCitationIntegrity({
      intent,
      expectations: testCase?.expectations,
      responseText: result.responseText || "",
      citations,
      retrievedChunks,
      citationConfidence: meta.citationConfidence,
      abstentionReason: meta.abstentionReason,
      approvedSources: options.approvedSources ?? loadApprovedSources(),
    });

  const claims = extractClaims(result.responseText || "", citations);

  const requiredCheckFailures = (result.deterministicResults || [])
    .filter((d) => d.required && !d.passed)
    .map((d) => d.checkId);
  const failedLlmChecks = (result.llmJudgeResults || [])
    .filter((l) => !l.passed && !l.skipped)
    .map((l) => l.checkId);

  const retrievalPath: CaseEvaluationRecord["retrieval"]["retrievalPath"] =
    !integrity.applicable
      ? "safety_refusal"
      : retrievedChunks.length > 0
        ? "rag"
        : result.error
          ? "unknown"
          : "none";

  const clusters = new Set<string>(integrity.clusters);
  if (result.error) clusters.add("execution-error");
  // Non-citation failures: safety vs general quality
  for (const checkId of requiredCheckFailures) {
    if (checkId.startsWith("citation") || checkId === "citations_present") continue;
    if (/diagnos|prognos|staging|dosage|crisis|emergency|misinformation|safety/.test(checkId)) {
      clusters.add("safety");
    } else {
      clusters.add("quality");
    }
  }
  if (failedLlmChecks.length > 0 && !result.passed) clusters.add("quality");

  const exp = testCase?.expectations;

  return {
    schemaVersion: CASE_RECORD_SCHEMA_VERSION,
    runId: options.runId,
    timestamp: options.timestamp ?? new Date().toISOString(),
    testId: result.testCaseId,
    suiteFile: options.suiteFile,
    intent,
    riskCategory: riskCategoryFor(testCase),
    cancer: testCase?.cancer,
    language: testCase?.language,
    modality: testCase?.modality,
    expectedConcepts: {
      sections: exp?.required_sections,
      tests: exp?.must_mention_tests,
      phrases: exp?.must_include_any_phrases,
      sources: exp?.expected_sources,
      behavior: exp?.expected_behavior ?? exp?.notes,
      mustNot: exp?.must_not,
    },
    evidenceRequired: integrity.evidenceRequired,
    retrieval: {
      retrievedCount: retrievedChunks.length,
      retrievalPath,
      sources: retrievedChunks.map((c, i) => ({
        rank: i + 1,
        docId: c.docId,
        chunkId: c.chunkId,
        sourceType: c.sourceType,
        isTrustedSource: c.isTrustedSource,
        similarity: c.similarity,
      })),
    },
    claims: {
      requiringSupportCount: claims.length,
      supportedCount: claims.filter((c) => c.supported).length,
      items: claims,
    },
    citations: {
      count: citations.length,
      citedDocIds: [...new Set(citations.map((c) => c.docId))],
      entries: integrity.resolvedCitations.map((c) => ({
        docId: c.docId,
        chunkId: c.chunkId,
        position: c.position,
        resolution: c.resolution,
      })),
    },
    citationIntegrity: integrity,
    citationIssues: integrity.issues,
    failureClusters: [...clusters],
    outcome: {
      passed: result.passed,
      score: result.score,
      requiredCheckFailures,
      failedLlmChecks,
      error: result.error,
      errorStep: result.errorStep,
      timedOut: result.timedOut,
    },
  };
}

/**
 * Build records for a whole report. `casesById` enriches records with test
 * case metadata (intent, risk, expected concepts); results without a matching
 * case still produce a (leaner) record so legacy reports remain analyzable.
 */
export function recordsFromReport(
  report: EvaluationReport,
  casesById: Map<string, TestCase> = new Map(),
  suiteFile?: string
): CaseEvaluationRecord[] {
  const approvedSources = loadApprovedSources();
  return report.results.map((result) =>
    buildCaseRecord(result, casesById.get(result.testCaseId), {
      runId: report.runId,
      timestamp: report.timestamp,
      suiteFile,
      approvedSources,
    })
  );
}

export function recordsPathFor(reportPath: string): string {
  return reportPath.replace(/\.json$/i, "") + ".records.json";
}

export async function writeRecords(
  records: CaseEvaluationRecord[],
  filePath: string
): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(records, null, 2), "utf-8");
}
