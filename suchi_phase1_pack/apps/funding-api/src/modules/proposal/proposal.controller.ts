import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
} from "@nestjs/common";
import { ProposalService } from "./proposal.service";
import { GenerateProposalDto, RegenerateSectionDto, ExportProposalDto } from "./proposal.dto";

@Controller("proposals")
export class ProposalController {
  constructor(private readonly proposalService: ProposalService) {}

  /**
   * Generate full proposal from opportunity.
   */
  @Post("generate")
  @HttpCode(HttpStatus.OK)
  async generate(@Body() body: GenerateProposalDto) {
    if (!body?.opportunityId?.trim()) {
      throw new BadRequestException("opportunityId is required");
    }
    return this.proposalService.generateProposal(body.opportunityId.trim(), body.options, body.approval);
  }

  /**
   * Regenerate a single section.
   */
  @Post(":runId/sections/:sectionName/regenerate")
  @HttpCode(HttpStatus.OK)
  async regenerateSection(
    @Param("runId", ParseUUIDPipe) runId: string,
    @Param("sectionName") sectionName: string,
    @Body() body: RegenerateSectionDto,
  ) {
    return this.proposalService.regenerateSection(runId, sectionName, body);
  }

  /**
   * Get proposal run status.
   */
  @Get(":runId")
  async getRun(@Param("runId", ParseUUIDPipe) runId: string) {
    return this.proposalService.getRun(runId);
  }

  /**
   * Get gaps/missing inputs.
   */
  @Get(":runId/gaps")
  async getGaps(@Param("runId", ParseUUIDPipe) runId: string) {
    return this.proposalService.getGaps(runId);
  }

  /**
   * Export proposal (placeholder - actual export happens during generation).
   */
  @Post(":runId/export")
  @HttpCode(HttpStatus.OK)
  async export(@Param("runId", ParseUUIDPipe) runId: string, @Body() body: ExportProposalDto) {
    const run = await this.proposalService.getRun(runId);
    // Export already happened during generation, return artifacts
    return {
      artifacts: run.artifacts,
      message: "Artifacts were exported during generation. Check Drive folder.",
    };
  }
}
