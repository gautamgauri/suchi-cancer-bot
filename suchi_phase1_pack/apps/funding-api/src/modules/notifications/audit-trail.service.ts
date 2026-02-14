import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { AuditLogContract } from "../contracts/funding-contracts.types";

export interface AuditTrailQuery {
  module?: string;
  status?: "accepted" | "rejected" | "noop" | "failed";
  from?: string; // ISO date
  to?: string; // ISO date
  limit?: number;
  offset?: number;
}

export interface AuditTrailEntry {
  id: string;
  eventId: string;
  eventType: string;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: Record<string, unknown>;
  reason: string | null;
  timestamp: string;
  status: string;
  preview: Record<string, unknown> | null;
  approval: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditTrailPage {
  entries: AuditTrailEntry[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist one audit event. Swallows errors so logging never breaks the request.
   */
  async persist(audit: AuditLogContract): Promise<void> {
    try {
      await this.prisma.governanceAuditEntry.upsert({
        where: { eventId: audit.eventId },
        create: {
          eventId: audit.eventId,
          eventType: audit.eventType,
          module: audit.module,
          action: audit.action,
          entityType: audit.entityType,
          entityId: audit.entityId,
          actor: audit.actor as object,
          reason: audit.reason ?? null,
          timestamp: new Date(audit.timestamp),
          status: audit.status,
          preview: (audit.preview as object) ?? null,
          approval: (audit.approval as object) ?? null,
          metadata: (audit.metadata as object) ?? null,
        },
        update: {}, // idempotent: do not overwrite
      });
    } catch (err) {
      this.logger.warn(
        `Audit persist failed for ${audit.eventId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Query audit trail with optional filters.
   */
  async query(params: AuditTrailQuery): Promise<AuditTrailPage> {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const offset = Math.max(params.offset ?? 0, 0);

    const where: Record<string, unknown> = {};
    if (params.module) where.module = params.module;
    if (params.status) where.status = params.status;
    if (params.from || params.to) {
      where.timestamp = {};
      if (params.from) (where.timestamp as Record<string, Date>).gte = new Date(params.from);
      if (params.to) (where.timestamp as Record<string, Date>).lte = new Date(params.to);
    }

    const [entries, total] = await Promise.all([
      this.prisma.governanceAuditEntry.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.governanceAuditEntry.count({ where }),
    ]);

    return {
      entries: entries.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        eventType: row.eventType,
        module: row.module,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actor: row.actor as Record<string, unknown>,
        reason: row.reason,
        timestamp: row.timestamp.toISOString(),
        status: row.status,
        preview: row.preview as Record<string, unknown> | null,
        approval: row.approval as Record<string, unknown> | null,
        metadata: row.metadata as Record<string, unknown> | null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  }
}
