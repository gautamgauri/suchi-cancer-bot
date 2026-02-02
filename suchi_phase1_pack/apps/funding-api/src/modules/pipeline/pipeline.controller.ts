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
import { CreatePipelineEntryDto } from "./pipeline-entry.dto";
import { UpdatePipelineEntryDto } from "./pipeline-entry.dto";

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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createEntry(@Body() body: CreatePipelineEntryDto) {
    return this.pipelineService.createEntry(body);
  }

  @Patch(":id")
  async updateEntry(
    @Param("id") id: string,
    @Body() body: UpdatePipelineEntryDto,
  ) {
    return this.pipelineService.updateEntry(id, body);
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
    });
    return record;
  }
}
