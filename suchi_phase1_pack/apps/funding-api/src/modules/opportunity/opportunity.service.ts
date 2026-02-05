import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { OpportunityDocument, OpportunityPayload } from "./opportunity.types";
import type { CreateOpportunityDto } from "./opportunity.dto";
import type { UpdateOpportunityDto } from "./opportunity.dto";

export interface OpportunityRecord {
  id: string;
  opportunityId: string;
  schemaVersion: string;
  emailMessageId?: string;
  threadId?: string;
  driveFolderId?: string;
  driveFolderUrl?: string;
  jsonBlob: OpportunityDocument;
  status: string;
  missingInputs?: Array<{ field: string; question: string; priority: string }>;
  pipelineEntryId?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OpportunityService {
  private readonly logger = new Logger(OpportunityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOpportunityDto): Promise<OpportunityRecord> {
    const existing = await this.prisma.opportunity.findUnique({
      where: { opportunityId: dto.opportunityId },
    });
    if (existing) {
      throw new ConflictException(
        `Opportunity ${dto.opportunityId} already exists`,
      );
    }
    if (dto.emailMessageId) {
      const byMessage = await this.prisma.opportunity.findUnique({
        where: { emailMessageId: dto.emailMessageId },
      });
      if (byMessage) {
        throw new ConflictException(
          `Opportunity already exists for message ${dto.emailMessageId}`,
        );
      }
    }

    const row = await this.prisma.opportunity.create({
      data: {
        opportunityId: dto.opportunityId,
        schemaVersion: dto.schemaVersion ?? "1.0",
        emailMessageId: dto.emailMessageId ?? null,
        threadId: dto.threadId ?? null,
        driveFolderId: dto.driveFolderId ?? null,
        driveFolderUrl: dto.driveFolderUrl ?? null,
        jsonBlob: dto.jsonBlob as object,
        status: dto.status ?? "received",
        missingInputs: (dto.missingInputs ?? null) as object | null,
        pipelineEntryId: dto.pipelineEntryId ?? null,
      },
    });
    return this.toRecord(row);
  }

  async update(id: string, dto: UpdateOpportunityDto): Promise<OpportunityRecord> {
    const existing = await this.prisma.opportunity.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Opportunity ${id} not found`);
    }

    const row = await this.prisma.opportunity.update({
      where: { id },
      data: {
        ...(dto.driveFolderId !== undefined && { driveFolderId: dto.driveFolderId }),
        ...(dto.driveFolderUrl !== undefined && { driveFolderUrl: dto.driveFolderUrl }),
        ...(dto.jsonBlob !== undefined && { jsonBlob: dto.jsonBlob as object }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.missingInputs !== undefined && { missingInputs: dto.missingInputs as object }),
        ...(dto.pipelineEntryId !== undefined && { pipelineEntryId: dto.pipelineEntryId }),
      },
    });
    return this.toRecord(row);
  }

  async findById(id: string): Promise<OpportunityRecord> {
    const row = await this.prisma.opportunity.findUnique({
      where: { id },
      include: { auditEvents: true },
    });
    if (!row) {
      throw new NotFoundException(`Opportunity ${id} not found`);
    }
    return this.toRecord(row);
  }

  async findByOpportunityId(opportunityId: string): Promise<OpportunityRecord | null> {
    const row = await this.prisma.opportunity.findUnique({
      where: { opportunityId },
    });
    return row ? this.toRecord(row) : null;
  }

  async findByEmailMessageId(emailMessageId: string): Promise<OpportunityRecord | null> {
    const row = await this.prisma.opportunity.findUnique({
      where: { emailMessageId },
    });
    return row ? this.toRecord(row) : null;
  }

  async list(options: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: OpportunityRecord[]; total: number }> {
    const where = options.status ? { status: options.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: options.limit ?? 50,
        skip: options.offset ?? 0,
      }),
      this.prisma.opportunity.count({ where }),
    ]);
    return {
      items: items.map((row) => this.toRecord(row)),
      total,
    };
  }

  async appendAuditEvent(
    opportunityId: string,
    action: string,
    status: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const opp = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
    });
    if (!opp) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }
    await this.prisma.opportunityAuditEvent.create({
      data: {
        opportunityId,
        action,
        status,
        details: details ? (details as object) : undefined,
      },
    });
    this.logger.log(`Audit: ${opportunityId} ${action} ${status}`);
  }

  /** Get the inner opportunity payload from jsonBlob for downstream use. */
  getPayload(record: OpportunityRecord): OpportunityPayload {
    const doc = record.jsonBlob as OpportunityDocument;
    if (!doc?.opportunity) {
      throw new Error(`Invalid opportunity jsonBlob for ${record.id}`);
    }
    return doc.opportunity;
  }

  private toRecord(row: {
    id: string;
    opportunityId: string;
    schemaVersion: string;
    emailMessageId: string | null;
    threadId: string | null;
    driveFolderId: string | null;
    driveFolderUrl: string | null;
    jsonBlob: unknown;
    status: string;
    missingInputs: unknown;
    pipelineEntryId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): OpportunityRecord {
    return {
      id: row.id,
      opportunityId: row.opportunityId,
      schemaVersion: row.schemaVersion,
      emailMessageId: row.emailMessageId ?? undefined,
      threadId: row.threadId ?? undefined,
      driveFolderId: row.driveFolderId ?? undefined,
      driveFolderUrl: row.driveFolderUrl ?? undefined,
      jsonBlob: row.jsonBlob as OpportunityDocument,
      status: row.status,
      missingInputs: row.missingInputs as OpportunityRecord["missingInputs"],
      pipelineEntryId: row.pipelineEntryId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
