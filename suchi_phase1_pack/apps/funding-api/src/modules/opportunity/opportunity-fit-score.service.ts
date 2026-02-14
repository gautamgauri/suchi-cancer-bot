import { Injectable, NotFoundException } from "@nestjs/common";
import type { ExtractedConstraints } from "./extract/rfp-constraints-extract.service";
import type { OpportunityCard, OpportunityFitAssessment, OpportunityPayload } from "./opportunity.types";
import type { OpportunityRecord } from "./opportunity.service";
import { OpportunityIntelligenceService } from "./extract/opportunity-intelligence.service";
import { OpportunityService } from "./opportunity.service";

export interface FitScoreResult {
  triageCard: OpportunityCard;
  fitAssessment: OpportunityFitAssessment;
}

export interface GetFitScoreOptions {
  /** If true, recompute even when stored assessment exists. Default false. */
  refresh?: boolean;
  /** If true, persist triageCard and fitAssessment back to opportunity jsonBlob. Default false. */
  persist?: boolean;
}

@Injectable()
export class OpportunityFitScoreService {
  constructor(
    private readonly opportunityService: OpportunityService,
    private readonly intelligence: OpportunityIntelligenceService,
  ) {}

  /**
   * Get fit score, reasons, and missing info for an opportunity.
   * Uses stored triageCard/fitAssessment when present unless refresh=true.
   */
  async getFitScore(
    idOrOpportunityId: string,
    options: GetFitScoreOptions = {},
  ): Promise<FitScoreResult> {
    const record = await this.resolveRecord(idOrOpportunityId);
    const payload = this.opportunityService.getPayload(record);

    const { refresh = false, persist = false } = options;
    const hasStored = payload.triageCard && payload.fitAssessment && !refresh;

    if (hasStored) {
      return {
        triageCard: payload.triageCard,
        fitAssessment: payload.fitAssessment,
      };
    }

    const constraints = this.payloadToConstraints(payload);
    const sourceLink =
      (payload.internal?.driveFolder?.driveUrl as string) ??
      (record.driveFolderUrl ?? undefined);

    const triageCard = this.intelligence.buildCard({
      payload,
      constraints,
      rfpText: payload.eligibility?.notes,
      sourceLink,
    });

    const fitAssessment = this.intelligence.buildFitAssessment({
      payload,
      constraints,
      card: triageCard,
    });

    if (persist) {
      await this.persistFitScore(record.id, payload, triageCard, fitAssessment);
    }

    return { triageCard, fitAssessment };
  }

  private async resolveRecord(idOrOpportunityId: string): Promise<OpportunityRecord> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrOpportunityId);
    if (isUuid) {
      try {
        return await this.opportunityService.findById(idOrOpportunityId);
      } catch {
        // fall through to try by opportunityId
      }
    }
    const byOppId = await this.opportunityService.findByOpportunityId(idOrOpportunityId);
    if (byOppId) return byOppId;
    throw new NotFoundException(`Opportunity ${idOrOpportunityId} not found`);
  }

  private payloadToConstraints(payload: OpportunityPayload): ExtractedConstraints {
    const geo = payload.keyConstraints?.geography;
    const geography = Array.isArray(geo) ? geo : typeof geo === "string" ? [geo] : undefined;
    return {
      funderName: payload.funder?.name,
      programName: payload.funder?.programName,
      submissionEmail: payload.funder?.submissionEmail,
      maxGrantAmountINR: payload.keyConstraints?.maxGrantAmountINR,
      projectDurationMonthsMax: payload.keyConstraints?.projectDurationMonthsMax,
      deadline:
        typeof payload.keyConstraints?.deadline === "string"
          ? payload.keyConstraints.deadline
          : payload.keyConstraints?.deadline != null
            ? new Date(payload.keyConstraints.deadline).toISOString()
            : undefined,
      geography,
      themes: payload.themes,
    };
  }

  private async persistFitScore(
    opportunityDbId: string,
    currentPayload: OpportunityPayload,
    triageCard: OpportunityCard,
    fitAssessment: OpportunityFitAssessment,
  ): Promise<void> {
    const updatedPayload: OpportunityPayload = {
      ...currentPayload,
      triageCard,
      fitAssessment,
      automationPlan: {
        ...currentPayload.automationPlan,
        missingInputs: fitAssessment.missingInfo ?? [],
      },
    };
    const doc = {
      schemaVersion: "1.0",
      opportunity: updatedPayload,
    };
    await this.opportunityService.update(opportunityDbId, { jsonBlob: doc });
  }
}
