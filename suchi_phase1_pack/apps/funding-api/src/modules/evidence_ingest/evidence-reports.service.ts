import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * P1-13: Phase 1 reporting — total docs, extraction vs needs_ocr, tier distribution,
 * top 50 Tier A with Drive links, error summary.
 */
@Injectable()
export class EvidenceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPhase1Report(): Promise<{
    totalDocs: number;
    extractionSuccess: number;
    needsOcr: number;
    tierDistribution: Record<string, number>;
    top50TierA: Array<{
      id: string;
      name: string;
      driveUrl: string | null;
      qualityScore: number | null;
      qualityTier: string | null;
    }>;
    errorSummary: { failed: number; lowText: number };
  }> {
    const totalDocs = await this.prisma.evidenceDocument.count();

    const extractionSuccess = await this.prisma.evidenceDocument.count({
      where: { extractionStatus: "success" },
    });
    const needsOcr = await this.prisma.evidenceDocument.count({
      where: { needsOcr: true },
    });
    const failed = await this.prisma.evidenceDocument.count({
      where: { extractionStatus: "failed" },
    });
    const lowText = await this.prisma.evidenceDocument.count({
      where: { extractionStatus: "LOW_TEXT" },
    });

    const byTier = await this.prisma.evidenceDocument.groupBy({
      by: ["qualityTier"],
      _count: { id: true },
      where: { qualityTier: { not: null } },
    });
    const tierDistribution: Record<string, number> = {};
    for (const row of byTier) {
      tierDistribution[row.qualityTier ?? "null"] = row._count.id;
    }

    const top50TierA = await this.prisma.evidenceDocument.findMany({
      where: { qualityTier: "A" },
      orderBy: [{ qualityScore: "desc" }, { modifiedTime: "desc" }],
      take: 50,
      select: {
        id: true,
        name: true,
        driveUrl: true,
        qualityScore: true,
        qualityTier: true,
      },
    });

    return {
      totalDocs,
      extractionSuccess,
      needsOcr,
      tierDistribution,
      top50TierA,
      errorSummary: { failed, lowText },
    };
  }
}
