import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PipelineEntry, ActivityRecord, ActivityPayload } from "./pipeline.types";
import { PrismaService } from "../prisma/prisma.service";
import { SheetsClientService } from "../sheets/sheets-client.service";
import type { CreatePipelineEntryDto } from "./pipeline-entry.dto";
import type { UpdatePipelineEntryDto } from "./pipeline-entry.dto";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string | undefined): boolean {
  return typeof s === "string" && UUID_REGEX.test(s);
}

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetsClient: SheetsClientService,
  ) {}

  async getEntries(): Promise<PipelineEntry[]> {
    const rows = await this.prisma.pipelineEntry.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(dbToPipelineEntry);
  }

  async logActivity(payload: ActivityPayload): Promise<ActivityRecord> {
    const donorOrOrg = payload.donorId ?? payload.orgId ?? "unknown";
    let pipelineEntryId: string | null = null;
    if (isUuid(payload.donorId)) {
      pipelineEntryId = payload.donorId;
    } else if (isUuid(payload.orgId)) {
      pipelineEntryId = payload.orgId;
    }

    const timestamp = payload.timestamp
      ? new Date(payload.timestamp)
      : new Date();

    const activity = await this.prisma.activity.create({
      data: {
        pipelineEntryId,
        donorId: payload.donorId ?? undefined,
        orgId: payload.orgId ?? undefined,
        type: payload.type,
        notes: payload.notes ?? undefined,
        timestamp,
        createdBy: payload.createdBy ?? undefined,
      },
    });

    this.logger.log(`Activity logged: ${payload.type} for ${donorOrOrg} (${activity.id})`);

    return {
      id: activity.id,
      donorId: activity.donorId ?? undefined,
      orgId: activity.orgId ?? undefined,
      type: activity.type as ActivityRecord["type"],
      notes: activity.notes ?? undefined,
      timestamp: activity.timestamp.toISOString(),
      createdBy: activity.createdBy ?? undefined,
    };
  }

  async createEntry(dto: CreatePipelineEntryDto): Promise<PipelineEntry> {
    const row = await this.prisma.pipelineEntry.create({
      data: {
        orgName: dto.orgName,
        contactName: dto.contactName ?? null,
        contactEmail: dto.contactEmail ?? null,
        stage: dto.stage,
        owner: dto.owner ?? null,
        nextAction: dto.nextAction ?? null,
        nextActionDate: dto.nextActionDate
          ? new Date(dto.nextActionDate)
          : null,
        lastContactDate: dto.lastContactDate
          ? new Date(dto.lastContactDate)
          : null,
        probability: dto.probability ?? null,
        notes: dto.notes ?? null,
        sectorTags: dto.sectorTags ?? [],
        geography: dto.geography ?? null,
        estimatedGrantSize: dto.estimatedGrantSize ?? null,
      },
    });
    return dbToPipelineEntry(row);
  }

  async updateEntry(
    id: string,
    dto: UpdatePipelineEntryDto,
  ): Promise<PipelineEntry> {
    const existing = await this.prisma.pipelineEntry.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Pipeline entry ${id} not found`);
    }
    if (existing.version !== dto.version) {
      throw new ConflictException(
        "Version mismatch; reload the entry and retry",
      );
    }
    const row = await this.prisma.pipelineEntry.update({
      where: { id },
      data: {
        ...(dto.orgName !== undefined && { orgName: dto.orgName }),
        ...(dto.contactName !== undefined && { contactName: dto.contactName }),
        ...(dto.contactEmail !== undefined && {
          contactEmail: dto.contactEmail,
        }),
        ...(dto.stage !== undefined && { stage: dto.stage }),
        ...(dto.owner !== undefined && { owner: dto.owner }),
        ...(dto.nextAction !== undefined && { nextAction: dto.nextAction }),
        ...(dto.nextActionDate !== undefined && {
          nextActionDate: new Date(dto.nextActionDate),
        }),
        ...(dto.lastContactDate !== undefined && {
          lastContactDate: new Date(dto.lastContactDate),
        }),
        ...(dto.probability !== undefined && { probability: dto.probability }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.sectorTags !== undefined && { sectorTags: dto.sectorTags }),
        ...(dto.geography !== undefined && { geography: dto.geography }),
        ...(dto.estimatedGrantSize !== undefined && {
          estimatedGrantSize: dto.estimatedGrantSize,
        }),
        version: { increment: 1 },
      },
    });
    return dbToPipelineEntry(row);
  }

  async getEntry(id: string): Promise<PipelineEntry> {
    const row = await this.prisma.pipelineEntry.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException(`Pipeline entry ${id} not found`);
    }
    return dbToPipelineEntry(row);
  }

  async getActivitiesForEntry(id: string): Promise<ActivityRecord[]> {
    const existing = await this.prisma.pipelineEntry.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Pipeline entry ${id} not found`);
    }
    const activities = await this.prisma.activity.findMany({
      where: { pipelineEntryId: id },
      orderBy: { timestamp: "desc" },
    });
    return activities.map(dbToActivityRecord);
  }

  /** All activities (for export to Sheets), ordered by timestamp desc. */
  async getAllActivities(): Promise<ActivityRecord[]> {
    const activities = await this.prisma.activity.findMany({
      orderBy: { timestamp: "desc" },
    });
    return activities.map(dbToActivityRecord);
  }
}

function dbToActivityRecord(a: {
  id: string;
  donorId: string | null;
  orgId: string | null;
  type: string;
  notes: string | null;
  timestamp: Date;
  createdBy: string | null;
}): ActivityRecord {
  return {
    id: a.id,
    donorId: a.donorId ?? undefined,
    orgId: a.orgId ?? undefined,
    type: a.type as ActivityRecord["type"],
    notes: a.notes ?? undefined,
    timestamp: a.timestamp.toISOString(),
    createdBy: a.createdBy ?? undefined,
  };
}

function dbToPipelineEntry(row: {
  id: string;
  orgName: string;
  contactName: string | null;
  contactEmail: string | null;
  stage: string;
  owner: string | null;
  nextAction: string | null;
  nextActionDate: Date | null;
  lastContactDate: Date | null;
  probability: number | null;
  notes: string | null;
  sectorTags: string[];
  geography: string | null;
  estimatedGrantSize: string | null;
}): PipelineEntry {
  return {
    id: row.id,
    orgName: row.orgName,
    contactName: row.contactName ?? undefined,
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
  };
}
