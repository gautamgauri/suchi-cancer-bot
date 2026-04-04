import { Controller, Get, Patch, Query, Param, Body, UseGuards, Logger } from '@nestjs/common';
import { BasicAuthGuard } from '../../common/guards/basic-auth.guard';
import { ReviewService } from './review.service';

@Controller('review')
export class ReviewController {
  private readonly logger = new Logger(ReviewController.name);

  constructor(private readonly reviewService: ReviewService) {}

  @UseGuards(BasicAuthGuard)
  @Get('records')
  async getRecords(
    @Query('verdict') verdict?: string,
    @Query('sessionId') sessionId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.reviewService.getRecords({
      verdict,
      sessionId,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @UseGuards(BasicAuthGuard)
  @Get('records/:id')
  async getRecord(@Param('id') id: string) {
    const { records } = await this.reviewService.getRecords({ limit: 1 });
    // Use direct prisma query for single record
    return records.find((r) => r.id === id) || null;
  }

  @UseGuards(BasicAuthGuard)
  @Get('queue')
  async getReviewQueue(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.reviewService.getReviewQueue(
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  @UseGuards(BasicAuthGuard)
  @Patch('queue/:id')
  async submitHumanReview(
    @Param('id') id: string,
    @Body() body: { status: 'APPROVED' | 'REJECTED' | 'MODIFIED'; reviewerId: string; note?: string },
  ) {
    return this.reviewService.submitHumanReview(id, body);
  }

  @UseGuards(BasicAuthGuard)
  @Get('metrics')
  async getMetrics(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reviewService.getMetrics(from, to);
  }

  @UseGuards(BasicAuthGuard)
  @Get('policies')
  async getPolicies() {
    return this.reviewService.getPolicies();
  }

  @UseGuards(BasicAuthGuard)
  @Patch('policies/:id')
  async updatePolicy(
    @Param('id') id: string,
    @Body() body: { enabled?: boolean; config?: any },
  ) {
    return this.reviewService.updatePolicy(id, body);
  }
}
