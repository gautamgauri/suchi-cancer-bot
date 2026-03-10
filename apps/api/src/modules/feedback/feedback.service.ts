import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { FeedbackDto } from "./dto";

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService, private readonly analytics: AnalyticsService) {}
  async submit(dto: FeedbackDto) {
    // Use raw SQL to check session existence (avoids schema drift issues)
    const sessions = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Session" WHERE id = ${dto.sessionId} LIMIT 1
    `;
    if (!sessions.length) throw new BadRequestException("Invalid sessionId");
    const fb = await this.prisma.feedback.create({ data: { sessionId: dto.sessionId, messageId: dto.messageId, rating: dto.rating, reason: dto.reason, comment: dto.comment } });
    await this.analytics.emit("feedback_submitted", { rating: dto.rating, reason: dto.reason ?? null }, dto.sessionId);
    return { id: fb.id, createdAt: fb.createdAt };
  }
}
