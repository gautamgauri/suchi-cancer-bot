import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KbFtsHealthService, KbFtsHealth } from "../rag/kb-fts-health.service";
import { getHospitalDirectoryStatus } from "../../common/hospital-directory-file";

/**
 * `status` semantics:
 *   - "ok"       — database reachable AND the hospital directory loaded
 *   - "degraded" — database reachable but a non-fatal dependency is missing
 *                  (today: the hospital directory, issue #123). Still HTTP 200 so
 *                  the Cloud Run startup probe is unaffected, but the gated
 *                  pipeline refuses to promote a revision that is not "ok".
 *   - "error"    — database unreachable
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kbFts: KbFtsHealthService
  ) {}

  async check() {
    const hospitalDirectory = getHospitalDirectoryStatus();
    try {
      // Check database connectivity
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: hospitalDirectory.loaded ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        database: "connected",
        hospitalDirectory,
        // Retrieval sub-status is reported here but deliberately does NOT change the
        // top-level `status` (the gated pipeline now promotes only on
        // `"status":"ok"`, #124): a degraded lexical arm must not block a deploy that
        // might be the fix. Alerting reads `retrieval.fullTextSearch.status` /
        // GET /v1/health/retrieval instead.
        retrieval: {
          fullTextSearch: this.kbFts.getHealth()
        }
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return {
        status: "error",
        timestamp: new Date().toISOString(),
        database: "disconnected",
        hospitalDirectory,
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
