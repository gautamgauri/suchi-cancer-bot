import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * PrismaService — singleton Prisma client with connection pool management.
 *
 * Cloud Run containers can scale to multiple instances, each opening its own
 * pool of DB connections.  PostgreSQL on Cloud SQL (tiny plan) has a hard cap
 * of ~25 connections.  Without an explicit limit Prisma defaults to
 * `num_cpus * 2 + 1` which, when multiplied by concurrent Cloud Run instances
 * and parallel eval traffic, exhausts all slots → 500 errors.
 *
 * Fix: cap the pool at 5 connections per instance (via datasource URL param)
 * and add a 10 s queue timeout so requests wait for a free slot instead of
 * crashing immediately.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = process.env.DATABASE_URL || "";

    // Append connection_limit and pool_timeout if not already present
    const separator = url.includes("?") ? "&" : "?";
    const hasPoolLimit = /connection_limit/i.test(url);
    const hasPoolTimeout = /pool_timeout/i.test(url);

    let datasourceUrl = url;
    const params: string[] = [];
    if (!hasPoolLimit) params.push("connection_limit=5");
    if (!hasPoolTimeout) params.push("pool_timeout=10");
    if (params.length > 0) {
      datasourceUrl = `${url}${separator}${params.join("&")}`;
    }

    super({
      datasources: { db: { url: datasourceUrl } },
    });

    if (params.length > 0) {
      PrismaService.logger.log(
        `Prisma pool configured: ${params.join(", ")} (original URL had ${hasPoolLimit ? "" : "no "}connection_limit)`
      );
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
