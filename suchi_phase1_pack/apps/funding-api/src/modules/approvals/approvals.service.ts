import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type {
  ApprovalRecord,
  ApprovalStatus,
  DraftArtifactRecord,
  DraftArtifactType,
  DraftVersionRecord,
} from "./approvals.types";

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async createArtifact(
    pipelineEntryId: string,
    type: DraftArtifactType
  ): Promise<DraftArtifactRecord> {
    const row = await this.prisma.draftArtifact.create({
      data: { pipelineEntryId, type },
    });
    return this.toArtifactRecord(row);
  }

  async createVersion(
    artifactId: string,
    content: string,
    createdBy?: string
  ): Promise<DraftVersionRecord> {
    const row = await this.prisma.draftVersion.create({
      data: { artifactId, content, createdBy: createdBy ?? undefined },
      include: { approval: true },
    });
    return this.toVersionRecord(row);
  }

  async submitApproval(
    versionId: string,
    status: ApprovalStatus,
    decidedBy?: string,
    comment?: string
  ): Promise<ApprovalRecord> {
    const version = await this.prisma.draftVersion.findUnique({
      where: { id: versionId },
      include: { approval: true },
    });
    if (!version) throw new NotFoundException("Draft version not found");
    if (version.approval) {
      const updated = await this.prisma.approval.update({
        where: { id: version.approval.id },
        data: { status, decidedBy: decidedBy ?? undefined, comment: comment ?? undefined, decidedAt: new Date() },
      });
      return this.toApprovalRecord(updated);
    }
    const row = await this.prisma.approval.create({
      data: { versionId, status, decidedBy: decidedBy ?? undefined, comment: comment ?? undefined },
    });
    return this.toApprovalRecord(row);
  }

  async getPendingForEntry(pipelineEntryId: string): Promise<DraftVersionRecord[]> {
    const versions = await this.prisma.draftVersion.findMany({
      where: {
        artifact: { pipelineEntryId },
        approval: null,
      },
      include: { artifact: true, approval: true },
      orderBy: { createdAt: "desc" },
    });
    return versions.map((v) => this.toVersionRecord(v));
  }

  async getArtifactsForEntry(pipelineEntryId: string): Promise<DraftArtifactRecord[]> {
    const rows = await this.prisma.draftArtifact.findMany({
      where: { pipelineEntryId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toArtifactRecord(r));
  }

  async getVersionsForArtifact(artifactId: string): Promise<DraftVersionRecord[]> {
    const rows = await this.prisma.draftVersion.findMany({
      where: { artifactId },
      include: { approval: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toVersionRecord(r));
  }

  private toArtifactRecord(row: { id: string; pipelineEntryId: string; type: string; createdAt: Date }): DraftArtifactRecord {
    return {
      id: row.id,
      pipelineEntryId: row.pipelineEntryId,
      type: row.type as DraftArtifactType,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toVersionRecord(row: {
    id: string;
    artifactId: string;
    content: string;
    createdBy: string | null;
    createdAt: Date;
    approval: { id: string; versionId: string; status: string; decidedBy: string | null; decidedAt: Date; comment: string | null } | null;
  }): DraftVersionRecord {
    return {
      id: row.id,
      artifactId: row.artifactId,
      content: row.content,
      createdBy: row.createdBy ?? undefined,
      createdAt: row.createdAt.toISOString(),
      approval: row.approval ? this.toApprovalRecord(row.approval) : undefined,
    };
  }

  private toApprovalRecord(row: {
    id: string;
    versionId: string;
    status: string;
    decidedBy: string | null;
    decidedAt: Date;
    comment: string | null;
  }): ApprovalRecord {
    return {
      id: row.id,
      versionId: row.versionId,
      status: row.status as ApprovalStatus,
      decidedBy: row.decidedBy ?? undefined,
      decidedAt: row.decidedAt.toISOString(),
      comment: row.comment ?? undefined,
    };
  }
}
