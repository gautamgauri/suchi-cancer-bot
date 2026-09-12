import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
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

  constructor(private readonly prisma: PrismaService) {}

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
}
