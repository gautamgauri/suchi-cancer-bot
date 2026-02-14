import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { PipelineService } from "./pipeline.service";
import { LogActivityDto } from "./activity.dto";
import {
  CreatePipelineEntryDto,
  ApprovalContextDto,
  UpdatePipelineEntryDto,
  SetLaneDto,
} from "./pipeline-entry.dto";

@Controller("pipeline")
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Get()
  async getPipeline() {
    const entries = await this.pipelineService.getEntries();
    return { entries };
  }

  @Get(":id/activities")
  async getActivitiesForEntry(@Param("id") id: string) {
    const activities = await this.pipelineService.getActivitiesForEntry(id);
    return { activities };
  }

  @Get(":id")
  async getEntry(@Param("id") id: string) {
    return this.pipelineService.getEntry(id);
  }

  @Get(":id/next-best-actions")
  async getNextBestActions(@Param("id") id: string) {
    return this.pipelineService.getNextBestActions(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createEntry(@Body() body: CreatePipelineEntryDto) {
    return this.pipelineService.createEntry(body);
  }

  @Post("set-lane")
  async setLaneByOrgOrId(
    @Body() body: { orgOrId: string; lane: string; approval?: ApprovalContextDto },
  ) {
    if (!body.orgOrId || !body.lane) {
      throw new BadRequestException("orgOrId and lane are required");
    }
    const lane = body.lane as "DOMESTIC_80G" | "CSR" | "FCRA";
    if (!["DOMESTIC_80G", "CSR", "FCRA"].includes(lane)) {
      throw new BadRequestException(
        "lane must be one of DOMESTIC_80G, CSR, FCRA",
      );
    }
    const entryId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      body.orgOrId.trim(),
    )
      ? body.orgOrId.trim()
      : (await this.pipelineService.findEntryByOrgName(body.orgOrId.trim()))
          ?.id;
    if (!entryId) {
      throw new BadRequestException(
        `No pipeline entry found for org or id: ${body.orgOrId}`,
      );
    }
    return this.pipelineService.setLane(entryId, lane, body.approval);
  }

  @Patch(":id")
  async updateEntry(
    @Param("id") id: string,
    @Body() body: UpdatePipelineEntryDto,
  ) {
    return this.pipelineService.updateEntry(id, body);
  }

  @Patch(":id/lane")
  async setLaneById(@Param("id") id: string, @Body() body: SetLaneDto) {
    return this.pipelineService.setLane(id, body.lane, body.approval);
  }

  @Post("activity")
  @HttpCode(HttpStatus.CREATED)
  async logActivity(@Body() body: LogActivityDto) {
    if (!body.donorId && !body.orgId) {
      throw new BadRequestException("Either donorId or orgId is required");
    }
    const record = await this.pipelineService.logActivity({
      donorId: body.donorId,
      orgId: body.orgId,
      type: body.type,
      notes: body.notes,
      timestamp: body.timestamp,
      createdBy: body.createdBy,
    }, body.approval);
    return record;
  }
}
