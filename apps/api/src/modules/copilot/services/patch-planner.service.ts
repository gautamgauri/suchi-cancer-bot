import { Injectable, Logger } from '@nestjs/common';
import type {
  FailureFinding,
  PatchPlan,
  PatchAction,
  ApprovalBand,
  RepairActionType,
} from '../copilot.types';
import { v4 as uuid } from 'uuid';

/** Maps failure modes to repair actions and approval bands */
const REPAIR_MAP: Record<string, { type: RepairActionType; band: ApprovalBand; description: string }[]> = {
  unsafe_medical_claim: [
    { type: 'soften_claims', band: 'C', description: 'Remove or soften diagnosis/prognosis/dosage claims' },
    { type: 'regenerate_response', band: 'C', description: 'Regenerate response with stricter safety constraints' },
  ],
  missing_disclaimer: [
    { type: 'add_disclaimer', band: 'A', description: 'Append medical disclaimer to response' },
  ],
  unsupported_claim: [
    { type: 're_retrieve', band: 'B', description: 'Re-run RAG retrieval with broader query' },
    { type: 'add_citations', band: 'B', description: 'Add citations from retrieved KB chunks' },
  ],
  citation_fabrication: [
    { type: 'remove_fabrication', band: 'B', description: 'Remove fabricated citations from response' },
    { type: 're_retrieve', band: 'B', description: 'Re-retrieve and add valid citations' },
  ],
  incomplete_coverage: [
    { type: 'regenerate_response', band: 'B', description: 'Regenerate with more complete coverage' },
  ],
  inappropriate_tone: [
    { type: 'improve_tone', band: 'B', description: 'Adjust tone to be empathetic and supportive' },
  ],
  navigation_gap: [
    { type: 'add_navigation', band: 'A', description: 'Add local resource and navigation information' },
  ],
  stale_evidence: [
    { type: 're_retrieve', band: 'B', description: 'Re-retrieve with updated KB sources' },
  ],
};

@Injectable()
export class PatchPlannerService {
  private readonly logger = new Logger(PatchPlannerService.name);

  /** Generate a patch plan from failure findings */
  plan(sessionId: string, findings: FailureFinding[]): PatchPlan {
    const actions: PatchAction[] = [];
    let actionSeq = 0;

    for (const finding of findings) {
      const repairs = REPAIR_MAP[finding.mode] ?? [];
      for (const repair of repairs) {
        actions.push({
          id: `PA-${++actionSeq}`,
          type: repair.type,
          description: repair.description,
          approvalBand: repair.band,
          targetField: 'responseText',
        });
      }
    }

    // Deduplicate by type
    const seen = new Set<RepairActionType>();
    const dedupedActions = actions.filter((a) => {
      if (seen.has(a.type)) return false;
      seen.add(a.type);
      return true;
    });

    // Sort: auto-apply (A) first, then manual (B), then admin (C)
    dedupedActions.sort((a, b) => a.approvalBand.localeCompare(b.approvalBand));

    return {
      id: uuid(),
      sessionId,
      findings,
      actions: dedupedActions,
      status: 'draft',
    };
  }
}
