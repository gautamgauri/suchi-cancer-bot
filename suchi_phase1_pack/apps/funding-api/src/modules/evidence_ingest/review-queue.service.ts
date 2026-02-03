import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface ReviewQueueEntryDto {
  id: string;
  documentId: string;
  reviewStatus: string;
  tierOverride: string | null;
  docTypeOverride: string | null;
  notes: string | null;
  tags: string[];
  document?: { name: string; driveUrl: string | null; qualityTier: string | null };
}

export interface UpdateReviewDto {
  reviewStatus?: string;
  tierOverride?: string | null;
  docTypeOverride?: string | null;
  notes?: string | null;
  tags?: string[];
}

@Injectable()
export class ReviewQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async getQueue(status?: string): Promise<ReviewQueueEntryDto[]> {
    const entries = await this.prisma.reviewQueueEntry.findMany({
      where: status ? { reviewStatus: status } : undefined,
      include: {
        document: {
          select: { name: true, driveUrl: true, qualityTier: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    return entries.map((e) => ({
      id: e.id,
      documentId: e.documentId,
      reviewStatus: e.reviewStatus,
      tierOverride: e.tierOverride,
      docTypeOverride: e.docTypeOverride,
      notes: e.notes,
      tags: e.tags,
      document: e.document,
    }));
  }

  async upsertForDocument(
    documentId: string,
    dto: UpdateReviewDto,
  ): Promise<ReviewQueueEntryDto> {
    const entry = await this.prisma.reviewQueueEntry.upsert({
      where: { documentId },
      create: {
        documentId,
        reviewStatus: dto.reviewStatus ?? "pending",
        tierOverride: dto.tierOverride ?? null,
        docTypeOverride: dto.docTypeOverride ?? null,
        notes: dto.notes ?? null,
        tags: dto.tags ?? [],
      },
      update: {
        ...(dto.reviewStatus !== undefined && { reviewStatus: dto.reviewStatus }),
        ...(dto.tierOverride !== undefined && { tierOverride: dto.tierOverride }),
        ...(dto.docTypeOverride !== undefined && { docTypeOverride: dto.docTypeOverride }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
      },
      include: {
        document: {
          select: { name: true, driveUrl: true, qualityTier: true },
        },
      },
    });
    return {
      id: entry.id,
      documentId: entry.documentId,
      reviewStatus: entry.reviewStatus,
      tierOverride: entry.tierOverride,
      docTypeOverride: entry.docTypeOverride,
      notes: entry.notes,
      tags: entry.tags,
      document: entry.document,
    };
  }
}
