import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { HealthService } from "./health.service";

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Versioned endpoints (under /v1)
  @Get("health")
  async check() {
    return this.healthService.check();
  }

  @Get("version")
  getVersion() {
    return this.healthService.getVersion();
  }

  // Root-level endpoints (excluded from /v1 prefix)
  // Used by Cloud Run, load balancers, uptime checks
  @Get("live")
  live() {
    // Liveness: server is up (no DB check)
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    // Readiness: server is up AND DB is connected
    const ready = await this.healthService.checkReadiness();
    if (!ready.ok) {
      throw new HttpException(
        { status: "not_ready", reason: ready.reason },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return { status: "ready", db: ready.db };
  }
}
