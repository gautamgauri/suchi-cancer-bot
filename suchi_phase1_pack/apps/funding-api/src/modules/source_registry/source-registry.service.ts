import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface SourceDocumentRecord {
  docId: string;
  url?: string;
  title?: string;
  retrievedAt: string;
  trustTier?: string;
  snapshotUrl?: string;
}

export interface UpsertSourceInput {
  docId: string;
  url?: string | null;
  title?: string | null;
  trustTier?: string | null;
}

@Injectable()
export class SourceRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertFromEvidence(input: UpsertSourceInput): Promise<SourceDocumentRecord | null> {
    const { docId, url, title, trustTier } = input;
    if (!docId || !docId.trim()) return null;
    const row = await this.prisma.sourceDocument.upsert({
      where: { docId: docId.trim() },
      create: {
        docId: docId.trim(),
        url: url?.trim() || null,
        title: title?.trim() || null,
        trustTier: trustTier?.trim() || null,
      },
      update: {
        url: url?.trim() ?? undefined,
        title: title?.trim() ?? undefined,
        trustTier: trustTier?.trim() ?? undefined,
        updatedAt: new Date(),
      },
    });
    return this.toRecord(row);
  }

  async getByDocId(docId: string): Promise<SourceDocumentRecord | null> {
    if (!docId?.trim()) return null;
    const row = await this.prisma.sourceDocument.findUnique({
      where: { docId: docId.trim() },
    });
    return row ? this.toRecord(row) : null;
  }

  async getByDocIds(docIds: string[]): Promise<SourceDocumentRecord[]> {
    const trimmed = [...new Set(docIds.map((id) => id.trim()).filter(Boolean))];
    if (trimmed.length === 0) return [];
    const rows = await this.prisma.sourceDocument.findMany({
      where: { docId: { in: trimmed } },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async setSnapshotUrl(docId: string, snapshotUrl: string): Promise<SourceDocumentRecord | null> {
    if (!docId?.trim() || !snapshotUrl?.trim()) return null;
    const row = await this.prisma.sourceDocument.upsert({
      where: { docId: docId.trim() },
      create: {
        docId: docId.trim(),
        snapshotUrl: snapshotUrl.trim(),
      },
      update: {
        snapshotUrl: snapshotUrl.trim(),
        updatedAt: new Date(),
      },
    });
    return this.toRecord(row);
  }

  private toRecord(row: {
    docId: string;
    url: string | null;
    title: string | null;
    retrievedAt: Date;
    trustTier: string | null;
    snapshotUrl: string | null;
  }): SourceDocumentRecord {
    return {
      docId: row.docId,
      url: row.url ?? undefined,
      title: row.title ?? undefined,
      retrievedAt: row.retrievedAt.toISOString(),
      trustTier: row.trustTier ?? undefined,
      snapshotUrl: row.snapshotUrl ?? undefined,
    };
  }
}
