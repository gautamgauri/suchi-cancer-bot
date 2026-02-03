import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  check() {
    return { ok: true };
  }

  getVersion() {
    const gitSha = process.env.GIT_SHA || process.env.BUILD_ID || "dev";
    return {
      service: "funding-api",
      gitSha,
      env: process.env.NODE_ENV || "development",
      dbConnected: this.prisma.isConnected(),
    };
  }

  async checkReadiness(): Promise<{ ok: boolean; db?: string; reason?: string }> {
    // Check if PrismaService reports connected
    if (!this.prisma.isConnected()) {
      return { ok: false, reason: "db_connecting" };
    }

    // Verify DB is actually reachable with a simple query
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: "connected" };
    } catch (err: any) {
      return { ok: false, reason: `db_error: ${err.message?.slice(0, 100)}` };
    }
  }
}
