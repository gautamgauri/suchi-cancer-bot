import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check() {
    return this.healthService.check();
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





















