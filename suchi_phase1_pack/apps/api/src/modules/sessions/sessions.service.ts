import { Injectable } from "@nestjs/common";
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
}
