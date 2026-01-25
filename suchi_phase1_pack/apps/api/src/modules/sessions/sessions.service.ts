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
    try {
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
        currentGreetingStep: (session as any).currentGreetingStep ?? null,
        userContext: session.userContext,
        cancerType: session.cancerType,
      };
    } catch (error: any) {
      // If currentGreetingStep column doesn't exist, fetch without it
      if (error.message?.includes('currentGreetingStep') || error.code === 'P2021' || error.message?.includes('Unknown column')) {
        const session = await this.prisma.session.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            createdAt: true,
            greetingCompleted: true,
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
          currentGreetingStep: null, // Column doesn't exist yet
          userContext: session.userContext,
          cancerType: session.cancerType,
        };
      }
      throw error; // Re-throw if it's a different error
    }
  }
}
