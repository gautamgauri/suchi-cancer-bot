import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PipelineService } from "../pipeline/pipeline.service";
import { OpportunityService, type OpportunityRecord } from "./opportunity.service";
import type { PipelineEntry } from "../pipeline/pipeline.types";
import type { OpportunityDocument, OpportunityInternalPerson, OpportunityFunder } from "./opportunity.types";
import type { Prisma } from "@prisma/client";

/**
 * Creates and links a PipelineEntry (tracker row) from an Opportunity.
 * Uses routing rules to set owner; default owner/reviewers come from opportunity internal.
 */
@Injectable()
export class OpportunityPipelineService {
  private readonly logger = new Logger(OpportunityPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelineService: PipelineService,
    private readonly opportunityService: OpportunityService,
  ) {}

  /**
   * Create a tracker row from an opportunity and link it. Idempotent if opportunity already has pipelineEntryId.
   */
  async createTrackerRowFromOpportunity(opportunityRecord: OpportunityRecord): Promise<PipelineEntry> {
    if (opportunityRecord.pipelineEntryId) {
      const existing = await this.pipelineService.getEntry(opportunityRecord.pipelineEntryId);
      return existing;
    }

    const payload = this.opportunityService.getPayload(opportunityRecord);
    const internal = payload.internal ?? {};
    const funder: OpportunityFunder = payload.funder ?? { name: "Unknown Funder" };
    const constraints = payload.keyConstraints ?? {};
    const owner = this.resolveOwner(internal.owner, payload.themes, constraints.geography);
    const estimatedGrantSize = constraints.maxGrantAmountINR
      ? `INR ${constraints.maxGrantAmountINR.toLocaleString("en-IN")}`
      : undefined;

    const entry = await this.pipelineService.createEntry({
      orgName: funder.name ?? "Unknown Funder",
      contactEmail: funder.submissionEmail,
      stage: "RFP_received",
      owner: owner?.name ?? owner?.email ?? internal.owner?.name ?? internal.owner?.email,
      nextAction: "Review RFP and draft acknowledgement",
      nextActionDate: constraints.deadline ?? undefined,
      geography: Array.isArray(constraints.geography) ? constraints.geography.join(", ") : undefined,
      estimatedGrantSize,
      deadline: constraints.deadline,
      submissionEmail: funder.submissionEmail,
      driveFolderUrl: opportunityRecord.driveFolderUrl ?? internal.driveFolder?.driveUrl,
    });

    await this.opportunityService.update(opportunityRecord.id, {
      pipelineEntryId: entry.id,
    });

    this.logger.log(`Created tracker row ${entry.id} for opportunity ${opportunityRecord.opportunityId}`);
    return entry;
  }

  /**
   * Transaction-compatible version: create tracker row within an existing transaction.
   * Used by OpportunityIntakeService to ensure atomicity.
   */
  async createTrackerRowFromOpportunityTx(
    tx: Prisma.TransactionClient,
    opportunity: { id: string; opportunityId: string; jsonBlob: OpportunityDocument },
  ): Promise<PipelineEntry> {
    const doc = opportunity.jsonBlob;
    if (!doc?.opportunity) {
      throw new Error(`Invalid opportunity jsonBlob for ${opportunity.id}`);
    }
    const payload = doc.opportunity;
    const internal = payload.internal ?? {};
    const funder: OpportunityFunder = payload.funder ?? { name: "Unknown Funder" };
    const constraints = payload.keyConstraints ?? {};
    const owner = this.resolveOwner(internal.owner, payload.themes, constraints.geography);
    const estimatedGrantSize = constraints.maxGrantAmountINR
      ? `INR ${constraints.maxGrantAmountINR.toLocaleString("en-IN")}`
      : undefined;

    const row = await tx.pipelineEntry.create({
      data: {
        orgName: funder.name ?? "Unknown Funder",
        contactEmail: funder.submissionEmail ?? null,
        stage: "RFP_received",
        owner: owner?.name ?? owner?.email ?? internal.owner?.name ?? internal.owner?.email ?? null,
        nextAction: "Review RFP and draft acknowledgement",
        nextActionDate: constraints.deadline ? new Date(constraints.deadline) : null,
        geography: Array.isArray(constraints.geography) ? constraints.geography.join(", ") : null,
        estimatedGrantSize: estimatedGrantSize ?? null,
        deadline: constraints.deadline ? new Date(constraints.deadline) : null,
        submissionEmail: funder.submissionEmail ?? null,
        driveFolderUrl: internal.driveFolder?.driveUrl ?? null,
      },
    });

    this.logger.log(`Created tracker row ${row.id} for opportunity ${opportunity.opportunityId} (in transaction)`);

    return {
      id: row.id,
      orgName: row.orgName,
      contactName: row.contactName ?? undefined,
      contactEmail: row.contactEmail ?? undefined,
      stage: row.stage as PipelineEntry["stage"],
      assignedTo: row.owner ?? undefined,
      nextAction: row.nextAction ?? undefined,
      nextActionDate: row.nextActionDate?.toISOString() ?? undefined,
      lastContactDate: row.lastContactDate?.toISOString() ?? undefined,
      probability: row.probability ?? undefined,
      notes: row.notes ?? undefined,
      sectorTags: row.sectorTags?.length ? row.sectorTags : undefined,
      geography: row.geography ?? undefined,
      estimatedGrantSize: row.estimatedGrantSize ?? undefined,
      deadline: row.deadline?.toISOString() ?? undefined,
      submissionEmail: row.submissionEmail ?? undefined,
      driveFolderUrl: row.driveFolderUrl ?? undefined,
    };
  }

  /**
   * Simple routing: prefer opportunity's internal.owner; optional future rule by theme/geography.
   */
  private resolveOwner(
    internalOwner: OpportunityInternalPerson | undefined,
    _themes: unknown,
    _geography: string[] | undefined,
  ): OpportunityInternalPerson | undefined {
    return internalOwner;
  }
}
