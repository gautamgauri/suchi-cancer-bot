import { Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { DailyReportService } from "./daily-report.service";
import { OpsMetricsService } from "./ops-metrics.service";

@Module({
  providers: [AnalyticsService, DailyReportService, OpsMetricsService],
  exports: [AnalyticsService, DailyReportService, OpsMetricsService],
})
export class AnalyticsModule {}
