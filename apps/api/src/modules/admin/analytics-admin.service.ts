import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AnalyticsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // FR-ANALYTICS-001: Top N cancer types / topics by session count
  async getTopics(since?: string, limit = 20) {
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.$queryRaw<Array<{ cancerType: string | null; count: bigint }>>`
      SELECT "cancerType", COUNT(*) as count
      FROM "Session"
      WHERE "createdAt" >= ${sinceDate}
        AND "isEval" = false
      GROUP BY "cancerType"
      ORDER BY count DESC
      LIMIT ${limit}
    `;

    return {
      period: { since: sinceDate },
      topics: rows.map((r) => ({
        topic: r.cancerType ?? "general",
        sessionCount: Number(r.count),
      })),
    };
  }

  // FR-ANALYTICS-002: Content gaps — messages where the evidence gate abstained
  async getContentGaps(since?: string, limit = 50) {
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const messages = await this.prisma.message.findMany({
      where: {
        role: "user",
        createdAt: { gte: sinceDate },
        session: { isEval: false },
        OR: [
          { abstentionReason: { not: null } },
          { evidenceGatePassed: false },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        text: true,
        abstentionReason: true,
        sessionId: true,
        session: { select: { cancerType: true, locale: true } },
      },
    });

    // Group by abstention reason
    const byReason: Record<string, number> = {};
    for (const m of messages) {
      const key = m.abstentionReason ?? "no_kb_match";
      byReason[key] = (byReason[key] ?? 0) + 1;
    }

    return {
      period: { since: sinceDate },
      totalGaps: messages.length,
      byReason,
      recentGaps: messages.slice(0, 20).map((m) => ({
        messageId: m.id,
        createdAt: m.createdAt,
        query: m.text.substring(0, 120),
        abstentionReason: m.abstentionReason,
        cancerType: m.session?.cancerType ?? null,
        locale: m.session?.locale ?? null,
      })),
    };
  }

  // FR-ANALYTICS-003: Language distribution
  async getLanguages(since?: string) {
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.$queryRaw<Array<{ locale: string | null; count: bigint }>>`
      SELECT locale, COUNT(*) as count
      FROM "Session"
      WHERE "createdAt" >= ${sinceDate}
        AND "isEval" = false
      GROUP BY locale
      ORDER BY count DESC
    `;

    const total = rows.reduce((sum, r) => sum + Number(r.count), 0);

    return {
      period: { since: sinceDate },
      total,
      distribution: rows.map((r) => ({
        locale: r.locale ?? "unknown",
        count: Number(r.count),
        pct: total > 0 ? Math.round((Number(r.count) / total) * 100) : 0,
      })),
    };
  }
}
