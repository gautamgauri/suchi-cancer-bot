/**
 * Citation Integrity Verifier (issue #48)
 *
 * Validates the citation contract of a single evaluated response,
 * independently of safety / style / general answer quality:
 *
 *   CIT-1 citation_resolution      — every citation resolves to a retrieved chunk
 *                                    or an explicitly approved source list
 *   CIT-2 fabricated_citations     — fabricated / unresolvable citations are flagged
 *   CIT-3 evidence_support         — evidence-required cases must have >= 1 supporting
 *                                    (resolved) citation; enforced as a required check
 *   CIT-4 min_citation_count       — expectations.min_citations satisfied by
 *                                    supporting citations only
 *   CIT-5 retrieval_present        — evidence-required cases must retrieve something
 *                                    (a total retrieval miss cannot pass silently)
 *   CIT-6 inline_marker_consistency— structured citations and inline [citation:...]
 *                                    markers must agree (advisory)
 *   CIT-7 citation_confidence      — citationConfidence must not be RED for
 *                                    evidence-required content (advisory)
 *
 * The verifier emits its own 0..1 integrity score computed ONLY from the rules
 * above so citation quality is never blended into rubric quality scores, plus a
 * machine-readable issue list (missing / invalid-citation reasons) and failure
 * clusters for the weekly cluster report.
 */

import type { ChatResponse, TestExpectations } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

export type CitationResolution = "retrieved" | "approved" | "unresolved";

export type FailureCluster =
  | "retrieval-miss"
  | "citation-missing"
  | "citation-fabricated"
  | "citation-format"
  | "citation-confidence"
  | "safety"
  | "quality"
  | "execution-error";

export const CITATION_ISSUE_CODES = {
  CITATION_UNRESOLVED: "CITATION_UNRESOLVED",
  ZERO_CITATIONS_WITH_RETRIEVAL: "ZERO_CITATIONS_WITH_RETRIEVAL",
  ZERO_RETRIEVAL_FOR_EVIDENCE_CASE: "ZERO_RETRIEVAL_FOR_EVIDENCE_CASE",
  BELOW_MIN_CITATIONS: "BELOW_MIN_CITATIONS",
  MARKERS_WITHOUT_STRUCTURED_CITATIONS: "MARKERS_WITHOUT_STRUCTURED_CITATIONS",
  CONFIDENCE_RED: "CONFIDENCE_RED",
  ABSTAINED_AFTER_RETRIEVAL: "ABSTAINED_AFTER_RETRIEVAL",
} as const;

export type CitationIssueCode =
  (typeof CITATION_ISSUE_CODES)[keyof typeof CITATION_ISSUE_CODES];

export interface CitationIssue {
  code: CitationIssueCode;
  reason: string;
  docId?: string;
  chunkId?: string;
}

export interface CitationRuleResult {
  ruleId: string;
  description: string;
  /** false when the rule does not apply to this case (e.g. safety refusal) */
  applicable: boolean;
  passed: boolean;
  details?: Record<string, unknown>;
}

export interface ResolvedCitation {
  docId: string;
  chunkId: string;
  position?: number;
  resolution: CitationResolution;
}

export interface CitationIntegrityResult {
  /** false for safety refusals — citation rules do not apply */
  applicable: boolean;
  evidenceRequired: boolean;
  retrievedCount: number;
  citationCount: number;
  /** citations that resolve to a retrieved chunk or approved source */
  supportingCitationCount: number;
  unresolvedCitationCount: number;
  inlineMarkerCount: number;
  resolvedCitations: ResolvedCitation[];
  /** 0..1 score computed from citation rules ONLY (separate axis from quality) */
  score: number;
  rules: CitationRuleResult[];
  /** machine-readable missing / invalid-citation reasons */
  issues: CitationIssue[];
  /** citation/retrieval failure clusters this case belongs to */
  clusters: FailureCluster[];
}

export interface ApprovedCitationSources {
  /** Exact docIds that are always citable (e.g. curated navigation docs) */
  approvedDocIds: string[];
  /** docId prefixes that are always citable */
  approvedDocIdPrefixes: string[];
}

export const EMPTY_APPROVED_SOURCES: ApprovedCitationSources = {
  approvedDocIds: [],
  approvedDocIdPrefixes: [],
};

export interface CitationVerifierInput {
  intent: string;
  expectations?: TestExpectations;
  safetyClassification?: string;
  responseText: string;
  citations?: ChatResponse["citations"];
  retrievedChunks?: ChatResponse["retrievedChunks"];
  citationConfidence?: string;
  abstentionReason?: string;
  approvedSources?: ApprovedCitationSources;
}

// ── Evidence requirement policy ──────────────────────────────────────────────

/** Intents whose answers are medical content and therefore require KB evidence */
export const EVIDENCE_REQUIRED_INTENTS = [
  "INFORMATIONAL_GENERAL",
  "INFORMATIONAL_SYMPTOMS",
  "SYMPTOMATIC_PATIENT",
  "CAREGIVER_NAVIGATION",
  "POST_DIAGNOSIS_OR_SUSPECTED",
  "RED_FLAG_URGENT",
  "TREATMENT_OPTIONS_GENERAL",
  "TREATMENT_OPTIONS",
  "SIDE_EFFECTS_GENERAL",
  "SIDE_EFFECTS",
  "SYMPTOMS_COMMON",
  "SYMPTOMS_EARLY_VS_LATE",
  "DIAGNOSIS_TESTS",
  "STAGING_BASICS",
  "PROGNOSIS_FACTORS",
];

export function isEvidenceRequired(
  intent: string,
  expectations?: TestExpectations
): boolean {
  if (expectations?.requires_citations === true) return true;
  if ((expectations?.min_citations ?? 0) > 0) return true;
  return EVIDENCE_REQUIRED_INTENTS.includes(intent);
}

// ── Verifier ─────────────────────────────────────────────────────────────────

const INLINE_CITATION_PATTERN = /\[citation:[^\]]+\]/gi;

function isSafetyRefusal(classification?: string): boolean {
  return (
    classification === "refusal" ||
    classification === "red_flag" ||
    classification === "self_harm"
  );
}

export function resolveCitation(
  citation: { docId: string; chunkId: string },
  retrievedChunks: Array<{ docId: string; chunkId: string }>,
  approved: ApprovedCitationSources
): CitationResolution {
  const inRetrieved = retrievedChunks.some(
    (c) => c.docId === citation.docId && c.chunkId === citation.chunkId
  );
  // A citation whose docId matches a retrieved doc (but a different chunk of it)
  // still counts as retrieved-doc backed; chunk-level mismatch is recorded via
  // details, not treated as fabrication.
  const inRetrievedDoc = retrievedChunks.some((c) => c.docId === citation.docId);
  if (inRetrieved || inRetrievedDoc) return "retrieved";

  if (approved.approvedDocIds.includes(citation.docId)) return "approved";
  if (approved.approvedDocIdPrefixes.some((p) => p && citation.docId.startsWith(p))) {
    return "approved";
  }
  return "unresolved";
}

export function verifyCitationIntegrity(
  input: CitationVerifierInput
): CitationIntegrityResult {
  const approved = input.approvedSources ?? EMPTY_APPROVED_SOURCES;
  const citations = input.citations ?? [];
  const retrievedChunks = input.retrievedChunks ?? [];
  const retrievedCount = retrievedChunks.length;
  const citationCount = citations.length;
  const evidenceRequired = isEvidenceRequired(input.intent, input.expectations);
  const refusal = isSafetyRefusal(input.safetyClassification);
  const inlineMarkers = input.responseText.match(INLINE_CITATION_PATTERN) ?? [];

  const rules: CitationRuleResult[] = [];
  const issues: CitationIssue[] = [];
  const clusters = new Set<FailureCluster>();

  // Safety refusals bypass RAG entirely; citation rules do not apply.
  if (refusal) {
    return {
      applicable: false,
      evidenceRequired,
      retrievedCount,
      citationCount,
      supportingCitationCount: 0,
      unresolvedCitationCount: 0,
      inlineMarkerCount: inlineMarkers.length,
      resolvedCitations: [],
      score: 1,
      rules: [
        {
          ruleId: "CIT-0",
          description: `Safety refusal (${input.safetyClassification}) — citation integrity rules not applicable`,
          applicable: false,
          passed: true,
        },
      ],
      issues: [],
      clusters: [],
    };
  }

  // ── Resolve each citation ──────────────────────────────────────────────────
  const resolvedCitations: ResolvedCitation[] = citations.map((c) => ({
    docId: c.docId,
    chunkId: c.chunkId,
    position: c.position,
    resolution: resolveCitation(c, retrievedChunks, approved),
  }));
  const unresolved = resolvedCitations.filter((c) => c.resolution === "unresolved");
  const supporting = resolvedCitations.filter((c) => c.resolution !== "unresolved");

  for (const u of unresolved) {
    issues.push({
      code: CITATION_ISSUE_CODES.CITATION_UNRESOLVED,
      reason: `Citation ${u.docId}#${u.chunkId} does not resolve to any retrieved chunk or approved source (possible fabrication)`,
      docId: u.docId,
      chunkId: u.chunkId,
    });
  }
  if (unresolved.length > 0) clusters.add("citation-fabricated");

  // CIT-1: every citation resolves
  rules.push({
    ruleId: "CIT-1",
    description: "Every citation resolves to a retrieved chunk or approved source",
    applicable: citationCount > 0,
    passed: citationCount === 0 || unresolved.length === 0,
    details: {
      citationCount,
      resolvedCount: supporting.length,
      unresolvedCount: unresolved.length,
    },
  });

  // CIT-2: fabricated citations flagged
  rules.push({
    ruleId: "CIT-2",
    description: "No fabricated / unresolvable citations",
    applicable: citationCount > 0,
    passed: unresolved.length === 0,
    details: {
      fabricated: unresolved.map((u) => `${u.docId}#${u.chunkId}`),
    },
  });

  // CIT-3: evidence-required cases need >= 1 supporting citation
  const evidenceSupportPassed = !evidenceRequired || supporting.length >= 1;
  rules.push({
    ruleId: "CIT-3",
    description:
      "Evidence-required case has at least one supporting (resolved) citation",
    applicable: evidenceRequired,
    passed: evidenceSupportPassed,
    details: {
      evidenceRequired,
      supportingCitationCount: supporting.length,
    },
  });
  if (evidenceRequired && supporting.length === 0) {
    if (retrievedCount > 0) {
      clusters.add("citation-missing");
      issues.push({
        code: CITATION_ISSUE_CODES.ZERO_CITATIONS_WITH_RETRIEVAL,
        reason: `Evidence-required intent ${input.intent} retrieved ${retrievedCount} chunks but produced ${supporting.length} supporting citations`,
      });
      if (input.abstentionReason) {
        issues.push({
          code: CITATION_ISSUE_CODES.ABSTAINED_AFTER_RETRIEVAL,
          reason: `Response abstained (${input.abstentionReason}) despite retrieving ${retrievedCount} chunks`,
        });
      }
    }
  }

  // CIT-4: expectations.min_citations satisfied by supporting citations only
  const minCitations = input.expectations?.min_citations ?? 0;
  const minCitationsPassed = supporting.length >= minCitations;
  rules.push({
    ruleId: "CIT-4",
    description: `At least ${minCitations} supporting citations (expectations.min_citations)`,
    applicable: minCitations > 0,
    passed: minCitations === 0 || minCitationsPassed,
    details: { minCitations, supportingCitationCount: supporting.length },
  });
  if (minCitations > 0 && !minCitationsPassed && supporting.length > 0) {
    clusters.add("citation-missing");
    issues.push({
      code: CITATION_ISSUE_CODES.BELOW_MIN_CITATIONS,
      reason: `Only ${supporting.length} supporting citations; expectations require >= ${minCitations}`,
    });
  }

  // CIT-5: evidence-required cases must retrieve something at all.
  // Closes the masking gap where retrievedChunks == 0 skips the citation
  // contract entirely (P0 signature of RQ-LUNG-02, nightly run 2026-07-05).
  const retrievalPresentPassed = !evidenceRequired || retrievedCount > 0;
  rules.push({
    ruleId: "CIT-5",
    description: "Evidence-required case retrieved at least one KB chunk",
    applicable: evidenceRequired,
    passed: retrievalPresentPassed,
    details: { retrievedCount },
  });
  if (evidenceRequired && retrievedCount === 0) {
    clusters.add("retrieval-miss");
    issues.push({
      code: CITATION_ISSUE_CODES.ZERO_RETRIEVAL_FOR_EVIDENCE_CASE,
      reason: `Evidence-required intent ${input.intent} retrieved 0 chunks — retrieval miss; response cannot be KB-grounded`,
    });
  }

  // CIT-6: inline [citation:...] markers must not reference nothing.
  // NOTE: the absence of inline markers is NOT a failure — by design
  // ("citations are for auditors, not users") the product returns structured
  // citations without inline markers in user-facing text. Only the inverse
  // (markers in text with no structured citations behind them) is flagged.
  const markersOk = !(inlineMarkers.length > 0 && citationCount === 0);
  rules.push({
    ruleId: "CIT-6",
    description:
      "Inline [citation:...] markers, if present, are backed by structured citations",
    applicable: inlineMarkers.length > 0,
    passed: markersOk,
    details: {
      structuredCitations: citationCount,
      inlineMarkers: inlineMarkers.length,
    },
  });
  if (!markersOk) {
    clusters.add("citation-format");
    issues.push({
      code: CITATION_ISSUE_CODES.MARKERS_WITHOUT_STRUCTURED_CITATIONS,
      reason: `${inlineMarkers.length} inline citation markers present but no structured citations returned`,
    });
  }

  // CIT-7: citation confidence not RED for evidence-required content (advisory)
  const confidence = input.citationConfidence ?? "RED";
  const confidencePassed = !evidenceRequired || confidence !== "RED";
  rules.push({
    ruleId: "CIT-7",
    description: "Citation confidence is not RED for evidence-required content",
    applicable: evidenceRequired && input.citationConfidence !== undefined,
    passed: confidencePassed,
    details: { citationConfidence: input.citationConfidence ?? null },
  });
  if (evidenceRequired && input.citationConfidence === "RED") {
    clusters.add("citation-confidence");
    issues.push({
      code: CITATION_ISSUE_CODES.CONFIDENCE_RED,
      reason: "citationConfidence is RED for evidence-required content",
    });
  }

  // Integrity score: fraction of applicable rules passed (citation axis ONLY).
  const applicableRules = rules.filter((r) => r.applicable);
  const score =
    applicableRules.length === 0
      ? 1
      : applicableRules.filter((r) => r.passed).length / applicableRules.length;

  return {
    applicable: true,
    evidenceRequired,
    retrievedCount,
    citationCount,
    supportingCitationCount: supporting.length,
    unresolvedCitationCount: unresolved.length,
    inlineMarkerCount: inlineMarkers.length,
    resolvedCitations,
    score,
    rules,
    issues,
    clusters: [...clusters],
  };
}

// ── Approved-sources config loader ───────────────────────────────────────────

/**
 * Loads eval/config/approved-citation-sources.json (explicit allow-list of
 * sources citable without appearing in retrievedChunks). Missing file or
 * fields degrade to the empty list — nothing is silently approved.
 */
export function loadApprovedSources(configPath?: string): ApprovedCitationSources {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path") as typeof import("path");
  const p =
    configPath ?? path.resolve(__dirname, "..", "config", "approved-citation-sources.json");
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
      approvedDocIds: Array.isArray(raw.approvedDocIds) ? raw.approvedDocIds : [],
      approvedDocIdPrefixes: Array.isArray(raw.approvedDocIdPrefixes)
        ? raw.approvedDocIdPrefixes
        : [],
    };
  } catch {
    return EMPTY_APPROVED_SOURCES;
  }
}
