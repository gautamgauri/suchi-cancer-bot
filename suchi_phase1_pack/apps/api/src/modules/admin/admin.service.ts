import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listConversations(opts: { from?: string; to?: string; filter?: string }) {
    const from = parseDate(opts.from);
    const to = parseDate(opts.to);
    const filter = opts.filter ?? "";

    const sessions = await this.prisma.session.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 50 }, feedback: true, safetyEvents: true }
    });

    const filtered = sessions.filter((s) => {
      if (filter === "thumbs_down") return s.feedback.some((f) => f.rating === "down");
      if (filter === "safety") return s.safetyEvents.length > 0;
      return true;
    });

    return filtered.map((s) => ({
      sessionId: s.id,
      createdAt: s.createdAt,
      channel: s.channel,
      locale: s.locale,
      userType: s.userType,
      feedback: s.feedback,
      safetyEvents: s.safetyEvents,
      messages: s.messages
    }));
  }

  async metrics(opts: { from?: string; to?: string }) {
    const from = parseDate(opts.from);
    const to = parseDate(opts.to);

    const [sessions, up, down, safety] = await Promise.all([
      this.prisma.session.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.feedback.count({ where: { createdAt: { gte: from, lte: to }, rating: "up" } }),
      this.prisma.feedback.count({ where: { createdAt: { gte: from, lte: to }, rating: "down" } }),
      this.prisma.safetyEvent.count({ where: { createdAt: { gte: from, lte: to } } })
    ]);

    return { sessions, feedback: { up, down }, safetyEvents: safety };
  }

  async kbStats() {
    // Count NCI documents
    const nciDocCount = await this.prisma.kbDocument.count({
      where: { sourceType: '02_nci_core', status: 'active' }
    });

    // Count NCI chunks
    const nciChunkResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count 
      FROM "KbChunk" c
      INNER JOIN "KbDocument" d ON c."docId" = d.id
      WHERE d."sourceType" = '02_nci_core' 
        AND d.status = 'active'
    `;
    const nciChunkCount = Number(nciChunkResult[0].count);

    // Count NCI chunks with embeddings
    const nciEmbeddedResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count 
      FROM "KbChunk" c
      INNER JOIN "KbDocument" d ON c."docId" = d.id
      WHERE d."sourceType" = '02_nci_core' 
        AND d.status = 'active'
        AND c.embedding IS NOT NULL
    `;
    const nciEmbeddedCount = Number(nciEmbeddedResult[0].count);

    // Breakdown by source type (documents)
    const sourceTypeBreakdown = await this.prisma.$queryRaw<Array<{ sourceType: string | null; count: bigint }>>`
      SELECT d."sourceType", COUNT(*) as count
      FROM "KbDocument" d
      WHERE d.status = 'active'
      GROUP BY d."sourceType"
      ORDER BY count DESC
    `;

    // Breakdown by source type (chunks)
    const chunkBreakdown = await this.prisma.$queryRaw<Array<{ sourceType: string | null; count: bigint; embedded: bigint }>>`
      SELECT 
        d."sourceType",
        COUNT(*) as count,
        COUNT(c.embedding) as embedded
      FROM "KbChunk" c
      INNER JOIN "KbDocument" d ON c."docId" = d.id
      WHERE d.status = 'active'
      GROUP BY d."sourceType"
      ORDER BY count DESC
    `;

    // Total counts
    const totalDocs = await this.prisma.kbDocument.count({ where: { status: 'active' } });
    const totalChunks = await this.prisma.kbChunk.count();
    const totalEmbedded = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "KbChunk" WHERE embedding IS NOT NULL
    `;
    const totalEmbeddedCount = Number(totalEmbedded[0].count);

    return {
      nci: {
        documents: nciDocCount,
        chunks: nciChunkCount,
        chunksWithEmbeddings: nciEmbeddedCount,
        embeddingPercentage: nciChunkCount > 0 ? ((nciEmbeddedCount / nciChunkCount) * 100).toFixed(1) : '0.0'
      },
      bySourceType: {
        documents: sourceTypeBreakdown.map(r => ({
          sourceType: r.sourceType || 'unknown',
          count: Number(r.count)
        })),
        chunks: chunkBreakdown.map(r => ({
          sourceType: r.sourceType || 'unknown',
          count: Number(r.count),
          embedded: Number(r.embedded),
          embeddingPercentage: Number(r.count) > 0 ? ((Number(r.embedded) / Number(r.count)) * 100).toFixed(1) : '0.0'
        }))
      },
      totals: {
        documents: totalDocs,
        chunks: totalChunks,
        chunksWithEmbeddings: totalEmbeddedCount,
        embeddingPercentage: totalChunks > 0 ? ((totalEmbeddedCount / totalChunks) * 100).toFixed(1) : '0.0',
        nciPercentage: totalChunks > 0 ? ((nciChunkCount / totalChunks) * 100).toFixed(1) : '0.0'
      }
    };
  }
}
