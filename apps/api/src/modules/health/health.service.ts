import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KbFtsHealthService, KbFtsHealth } from "../rag/kb-fts-health.service";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kbFts: KbFtsHealthService
  ) {}

  async check() {
    try {
      // Check database connectivity
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        database: "connected",
        // Retrieval sub-status is reported here but deliberately does NOT change the
        // top-level `status`: the Cloud Build health gate (cloudbuild.gated.yaml,
        // `curl -fsS $candidate_url/v1/health`) only checks for a 2xx, and a degraded
        // lexical arm must not block a deploy that might be the fix. Alerting reads
        // `retrieval.fullTextSearch.status` / GET /v1/health/retrieval instead.
        retrieval: {
          fullTextSearch: this.kbFts.getHealth()
        }
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

  /**
   * Retrieval readiness (issue #92). Re-probes the FTS schema so the answer is
   * live rather than a cached boot verdict, and reports whether the lexical arm
   * of hybrid retrieval is actually contributing.
   */
  async checkRetrieval(): Promise<{ status: string; timestamp: string; fullTextSearch: KbFtsHealth }> {
    const fullTextSearch = await this.kbFts.probe();
    return {
      status: fullTextSearch.status === "ok" ? "ok" : fullTextSearch.status,
      timestamp: new Date().toISOString(),
      fullTextSearch
    };
  }
}





















