// ── Dataset ──

export interface DatasetRow {
  id: string;
  query: string;
  language: string;
  intent: string;
  cancer_type: string;
  requires_disclaimer: boolean;
  requires_citations: boolean;
  expected_behavior: string;
  safety_level: string;
  notes?: string;
  paraphrase_family?: string;
}

// ── API Trace ──

export interface RetrievedChunk {
  docId: string;
  chunkId: string;
  sourceType?: string;
  isTrustedSource?: boolean;
  similarity?: number;
  vecSim?: number;
  lexSim?: number;
}

export interface Citation {
  docId: string;
  chunkId: string;
  position?: number;
}

export interface ApiTrace {
  sessionId: string;
  messageId?: string;
  responseText: string;
  safety: {
    classification: string;
    actions: string[];
  };
  citations: Citation[];
  retrievedChunks: RetrievedChunk[];
  citationConfidence?: string;
  abstentionReason?: string | null;
  latencyMs: number;
  error?: string;
}

// ── Grading ──

export interface GradeResult {
  grader: string;
  passed: boolean;
  score: number; // 0.0 – 1.0
  details: string;
  reason?: string;
}

export interface CaseResult {
  caseId: string;
  query: string;
  trace: ApiTrace;
  grades: GradeResult[];
  weightedScore: number;
  passed: boolean;
  failureCodes: string[];
}

// ── Run ──

export interface AggregateScores {
  overall: number;
  passRate: number;
  perGrader: Record<string, { mean: number; passRate: number }>;
  caseCount: number;
}

export interface RunResult {
  runId: string;
  timestamp: string;
  apiBaseUrl: string;
  datasetPath: string;
  cases: CaseResult[];
  aggregate: AggregateScores;
}

// ── Clustering ──

export type FailureCode =
  | 'DISC_MISSING'
  | 'CIT_ZERO'
  | 'CIT_ORPHAN'
  | 'SAFETY_DIAG'
  | 'SAFETY_DOSE'
  | 'SAFETY_PROG'
  | 'DIRECT_ABSTAIN'
  | 'DIRECT_OVERASK'
  | 'SUPPORT_UNGROUNDED'
  | 'COMPLETE_MISSING_SECTION';

export interface FailureCluster {
  code: FailureCode;
  label: string;
  count: number;
  caseIds: string[];
  sampleReasons: string[];
}

// ── Comparison ──

export interface CaseDelta {
  caseId: string;
  query: string;
  baselineScore: number;
  candidateScore: number;
  delta: number;
  regressions: string[];
  improvements: string[];
}

export interface ComparisonResult {
  baselineRunId: string;
  candidateRunId: string;
  timestamp: string;
  cases: CaseDelta[];
  summary: {
    totalCases: number;
    improved: number;
    regressed: number;
    unchanged: number;
    netDelta: number;
    baselineOverall: number;
    candidateOverall: number;
  };
}

// ── Scoring config ──

export type ScoringWeights = Record<string, number>;
