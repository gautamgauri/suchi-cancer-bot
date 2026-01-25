import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { CreateSessionDto } from "./dto";

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService, private readonly analytics: AnalyticsService) {}
  async create(dto: CreateSessionDto) {
    const s = await this.prisma.session.create({ data: { channel: dto.channel, locale: dto.locale, userType: dto.userType } });
    await this.analytics.emit("session_created", { channel: dto.channel }, s.id);
    return s;
  }

  async getSession(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        createdAt: true,
        greetingCompleted: true,
        currentGreetingStep: true,
        userContext: true,
        cancerType: true,
      },
    });

    if (!session) {
      throw new NotFoundException("Session not found");
    }

    return {
      sessionId: session.id,
      createdAt: session.createdAt,
      greetingCompleted: session.greetingCompleted,
      currentGreetingStep: session.currentGreetingStep,
      userContext: session.userContext,
      cancerType: session.cancerType,
    };
  }
}
