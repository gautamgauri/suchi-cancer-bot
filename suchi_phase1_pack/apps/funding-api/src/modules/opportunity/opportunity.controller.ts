import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { OpportunityService } from "./opportunity.service";
import { OpportunityIntakeService } from "./opportunity-intake.service";
import { OpportunityFitScoreService } from "./opportunity-fit-score.service";
import { CreateOpportunityDto } from "./opportunity.dto";
import { UpdateOpportunityDto } from "./opportunity.dto";

@Controller("opportunities")
export class OpportunityController {
  constructor(
    private readonly opportunityService: OpportunityService,
    private readonly intakeService: OpportunityIntakeService,
    private readonly fitScoreService: OpportunityFitScoreService,
  ) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const result = await this.opportunityService.list({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { items: result.items, total: result.total };
  }

  @Get("by-opportunity-id/:opportunityId")
  async getByOpportunityId(@Param("opportunityId") opportunityId: string) {
    const record = await this.opportunityService.findByOpportunityId(opportunityId);
    if (!record) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }
    return record;
  }

  /**
   * Get fit score, 3–5 reason bullets, and missing info for an opportunity (by DB id or opportunityId).
   * Query: refresh=true to recompute; persist=true to save back to opportunity.
   */
  @Get("by-opportunity-id/:opportunityId/fit-score")
  async getFitScoreByOpportunityId(
    @Param("opportunityId") opportunityId: string,
    @Query("refresh") refresh?: string,
    @Query("persist") persist?: string,
  ) {
    return this.fitScoreService.getFitScore(opportunityId, {
      refresh: refresh === "true" || refresh === "1",
      persist: persist === "true" || persist === "1",
    });
  }

  @Get(":id/fit-score")
  async getFitScoreById(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("refresh") refresh?: string,
    @Query("persist") persist?: string,
  ) {
    return this.fitScoreService.getFitScore(id, {
      refresh: refresh === "true" || refresh === "1",
      persist: persist === "true" || persist === "1",
    });
  }

  @Get(":id")
  async getById(@Param("id", ParseUUIDPipe) id: string) {
    return this.opportunityService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateOpportunityDto) {
    return this.opportunityService.create(body);
  }

  @Post("ingest-from-email")
  @HttpCode(HttpStatus.OK)
  async ingestFromEmail(@Body() body: { messageId: string }) {
    if (!body?.messageId?.trim()) {
      throw new BadRequestException("messageId is required");
    }
    return this.intakeService.intakeFromEmail(body.messageId.trim());
  }

  @Patch(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateOpportunityDto,
  ) {
    return this.opportunityService.update(id, body);
  }
}
