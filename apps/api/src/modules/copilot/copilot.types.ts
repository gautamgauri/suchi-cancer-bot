// ── Failure modes specific to cancer bot responses ──────────────────────────

export type FailureModeId =
  | 'unsafe_medical_claim'
  | 'missing_disclaimer'
  | 'unsupported_claim'
  | 'citation_fabrication'
  | 'incomplete_coverage'
  | 'inappropriate_tone'
  | 'navigation_gap'
  | 'stale_evidence';

export interface FailureFinding {
  id: string;
  mode: FailureModeId;
  severity: 'critical' | 'major' | 'minor';
  evidence: string;
  location?: string;
}

// ── Approval bands ──────────────────────────────────────────────────────────

export type ApprovalBand = 'A' | 'B' | 'C';
// A = auto-apply (minor, low-risk fixes like adding disclaimers)
// B = manual review required (moderate changes like citation fixes)
// C = admin-only (critical changes like safety guardrail modifications)

// ── Repair actions ──────────────────────────────────────────────────────────

export type RepairActionType =
  | 're_retrieve'
  | 'add_disclaimer'
  | 'soften_claims'
  | 'add_citations'
  | 'improve_tone'
  | 'add_navigation'
  | 'remove_fabrication'
  | 'regenerate_response';

export interface PatchAction {
  id: string;
  type: RepairActionType;
  description: string;
  approvalBand: ApprovalBand;
  targetField: string;
}

export interface PatchPlan {
  id: string;
  sessionId: string;
  findings: FailureFinding[];
  actions: PatchAction[];
  status: 'draft' | 'approved' | 'rejected' | 'executed';
  approvedBy?: string;
  approvedAt?: string;
}

// ── Review session ──────────────────────────────────────────────────────────

export interface ReviewMetrics {
  safetyScore: number;
  citationScore: number;
  disclaimerPresent: boolean;
  toneScore: number;
  completenessScore: number;
  overallScore: number;
}

export interface ReviewSession {
  id: string;
  chatSessionId: string;
  messageId: string;
  query: string;
  responseText: string;
  createdAt: string;
  status: 'created' | 'diagnosed' | 'planned' | 'executed' | 'compared';
  metrics?: ReviewMetrics;
  findings?: FailureFinding[];
  patchPlan?: PatchPlan;
  repairedResponse?: string;
  comparisonDelta?: number;
}
