import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { OrchestratorService } from "./orchestrator.service";
import { OrchestratorRunDto, OrchestratorAssessDto } from "./orchestrator.dto";

@Controller("orchestrator")
export class OrchestratorController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  /**
   * POST /v1/orchestrator/run
   * Full pipeline: fit scoring → Gmail memory → budget → proposal generation
   */
  @Post("run")
  @HttpCode(HttpStatus.OK)
  async run(@Body() body: OrchestratorRunDto) {
    if (!body?.opportunityId?.trim()) {
      throw new BadRequestException("opportunityId is required");
    }

    return this.orchestrator.run(body.opportunityId.trim(), {
      skipGmail: body.skipGmail,
      skipBudget: body.skipBudget,
      skipWebEvidence: body.skipWebEvidence,
      forceGenerate: body.forceGenerate,
      proposalOptions: body.proposalOptions,
    });
  }

  /**
   * POST /v1/orchestrator/assess
   * Pre-drafting intelligence only: fit scoring + Gmail memory + budget envelope.
   * Does NOT trigger proposal generation.
   */
  @Post("assess")
  @HttpCode(HttpStatus.OK)
  async assess(@Body() body: OrchestratorAssessDto) {
    if (!body?.opportunityId?.trim()) {
      throw new BadRequestException("opportunityId is required");
    }

    return this.orchestrator.assess(body.opportunityId.trim());
  }
}
