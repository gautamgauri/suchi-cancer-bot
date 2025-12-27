import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { FeedbackDto } from "./dto";

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService, private readonly analytics: AnalyticsService) {}
  async submit(dto: FeedbackDto) {
    const session = await this.prisma.session.findUnique({ where: { id: dto.sessionId } });
    if (!session) throw new BadRequestException("Invalid sessionId");
    const fb = await this.prisma.feedback.create({ data: { sessionId: dto.sessionId, messageId: dto.messageId, rating: dto.rating, reason: dto.reason, comment: dto.comment } });
    await this.analytics.emit("feedback_submitted", { rating: dto.rating, reason: dto.reason ?? null }, dto.sessionId);
    return { id: fb.id, createdAt: fb.createdAt };
  }
}
