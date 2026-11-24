import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { HealthService } from "./health.service";

// Probes (Cloud Run, uptime checks, deploy gate) arrive from shared Google
// addresses and must never be answered with 429.
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Deep health. Returns 503 with the usual body when the database is
   * unreachable, so an uptime probe that reads only the status code sees the
   * outage. "degraded" stays HTTP 200 (the gated pipeline reads the body).
   */
  @Get()
  async check() {
    const result = await this.healthService.check();
    if (result.status === "error") {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  /**
   * Liveness. Answers 200 whenever the process is serving HTTP and touches no
   * dependency. Container startup and liveness probes belong here, so that a
   * brief database blip cannot stop a container from starting.
   */
  @Get("live")
  live() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  /**
   * Retrieval readiness (issue #92).
   *
   * Returns 503 while the lexical (FTS) arm of hybrid retrieval is unavailable,
   * so a dropped `KbChunk.content_tsv` column shows up as a failing probe instead
   * of an error line nobody reads. Kept separate from GET /v1/health on purpose —
   * the deploy health gate must stay green on a degradation that is survivable
   * (vector-only retrieval still answers, just with worse ranking).
   */
  @Get("retrieval")
  async checkRetrieval() {
    const result = await this.healthService.checkRetrieval();
    if (result.fullTextSearch.status === "unavailable") {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}





















