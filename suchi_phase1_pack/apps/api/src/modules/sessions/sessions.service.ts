import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { CreateSessionDto } from "./dto";

export interface GeoData {
  city: string | null;
  region: string | null;
  country: string | null;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService, private readonly analytics: AnalyticsService) {}
  async create(dto: CreateSessionDto, geoData?: GeoData, isEval = false) {
    let s;
    try {
      // Try with all fields including geo and isEval
      s = await this.prisma.session.create({
        data: {
          channel: dto.channel,
          locale: dto.locale,
          userType: dto.userType,
          city: geoData?.city,
          region: geoData?.region,
          country: geoData?.country,
          isEval,
        },
      });
    } catch (error: any) {
      // Fall back to basic fields for ANY Prisma error (handles missing columns gracefully)
      this.logger.warn(`Session create with geo/isEval failed (${error.code || 'unknown'}), falling back to basic fields: ${error.message?.substring(0, 100)}`);
      try {
        s = await this.prisma.session.create({
          data: {
            channel: dto.channel,
            locale: dto.locale,
            userType: dto.userType,
          },
        });
      } catch (fallbackError: any) {
        // If fallback also fails, throw original error
        this.logger.error(`Session create fallback also failed: ${fallbackError.message}`);
        throw error;
      }
    }
    await this.analytics.emit("session_created", {
      channel: dto.channel,
      city: geoData?.city,
      country: geoData?.country,
      isEval,
    }, s.id);
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
