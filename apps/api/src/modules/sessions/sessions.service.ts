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
      // Try with all fields including geo and isEval using raw SQL
      // This avoids Prisma schema validation issues when columns don't exist in DB
      const result = await this.prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
        INSERT INTO "Session" (id, "createdAt", channel, locale, "userType", status, city, region, country, "isEval", "userRole")
        VALUES (gen_random_uuid(), NOW(), ${dto.channel}, ${dto.locale || null}, ${dto.userType || null}, 'active',
                ${geoData?.city || null}, ${geoData?.region || null}, ${geoData?.country || null}, ${isEval},
                ${dto.userRole || 'unknown'})
        RETURNING id, "createdAt"
      `;
      s = { id: result[0].id, createdAt: result[0].createdAt };
    } catch (error: any) {
      // Fall back to basic fields using raw SQL (no geo/isEval columns)
      this.logger.warn(`Session create with geo/isEval failed, falling back to basic fields: ${error.message?.substring(0, 80)}`);
      try {
        const result = await this.prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
          INSERT INTO "Session" (id, "createdAt", channel, locale, "userType", status)
          VALUES (gen_random_uuid(), NOW(), ${dto.channel}, ${dto.locale || null}, ${dto.userType || null}, 'active')
          RETURNING id, "createdAt"
        `;
        s = { id: result[0].id, createdAt: result[0].createdAt };
      } catch (fallbackError: any) {
        // If fallback also fails, throw the fallback error (more relevant)
        this.logger.error(`Session create fallback also failed: ${fallbackError.message}`);
        throw fallbackError;
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
