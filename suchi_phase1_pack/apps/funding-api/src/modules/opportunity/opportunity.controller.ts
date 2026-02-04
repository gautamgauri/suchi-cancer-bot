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
import { CreateOpportunityDto } from "./opportunity.dto";
import { UpdateOpportunityDto } from "./opportunity.dto";

@Controller("opportunities")
export class OpportunityController {
  constructor(
    private readonly opportunityService: OpportunityService,
    private readonly intakeService: OpportunityIntakeService,
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
