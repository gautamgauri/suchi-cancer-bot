import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { CopilotService } from './copilot.service';
import { CreateSessionDto, ApproveDto, RejectDto } from './copilot.dto';

@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('sessions')
  async createSession(@Body() dto: CreateSessionDto) {
    return this.copilot.createSession(dto.chatSessionId, dto.messageId);
  }

  @Get('sessions/:id')
  getSession(@Param('id') id: string) {
    return this.copilot.getSession(id);
  }

  @Post('sessions/:id/diagnose')
  async diagnose(@Param('id') id: string) {
    return this.copilot.diagnose(id);
  }

  @Post('sessions/:id/plan')
  plan(@Param('id') id: string) {
    return this.copilot.plan(id);
  }

  @Post('sessions/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveDto) {
    return this.copilot.approve(id, dto.approvedBy);
  }

  @Post('sessions/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.copilot.reject(id, dto.reason);
  }

  @Post('sessions/:id/execute')
  async execute(@Param('id') id: string) {
    return this.copilot.execute(id);
  }

  @Post('sessions/:id/compare')
  async compare(@Param('id') id: string) {
    return this.copilot.compare(id);
  }
}
