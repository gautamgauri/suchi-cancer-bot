import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Query,
} from "@nestjs/common";
import { EmailPipelineService } from "./email-pipeline.service";

@Controller("email-pipeline")
export class EmailPipelineController {
  constructor(private readonly pipelineService: EmailPipelineService) {}

  /**
   * Poll Gmail inbox for unprocessed messages and run the pipeline on each.
   * Called manually or by Cloud Scheduler.
   */
  @Post("poll")
  @HttpCode(HttpStatus.OK)
  async poll() {
    return this.pipelineService.poll();
  }

  /**
   * Process a single email message by Gmail message ID.
   */
  @Post("process")
  @HttpCode(HttpStatus.OK)
  async process(@Body() body: { messageId: string }) {
    if (!body?.messageId?.trim()) {
      throw new BadRequestException("messageId is required");
    }
    return this.pipelineService.processMessage(body.messageId.trim());
  }

  /**
   * List recent processed emails and their pipeline status.
   */
  @Get("status")
  async status(@Query("limit") limit?: string) {
    const n = limit ? Math.min(parseInt(limit, 10) || 20, 100) : 20;
    return this.pipelineService.getStatus(n);
  }
}
