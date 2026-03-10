import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}
  async emit(eventName: string, payload?: any, sessionId?: string) {
    await this.prisma.analyticsEvent.create({ data: { eventName, payload: payload ?? undefined, sessionId: sessionId ?? undefined } });
  }
}
