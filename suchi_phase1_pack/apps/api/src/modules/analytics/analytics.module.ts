import { Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { DailyReportService } from "./daily-report.service";

@Module({
  providers: [AnalyticsService, DailyReportService],
  exports: [AnalyticsService, DailyReportService],
})
export class AnalyticsModule {}
