import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check() {
    try {
      // Check database connectivity
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        database: "connected"
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return {
        status: "error",
        timestamp: new Date().toISOString(),
        database: "disconnected"
      };
    }
  }
}

















