import { Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { DailyReportService } from "./daily-report.service";
import { OpsMetricsService } from "./ops-metrics.service";
import { CommsMetricsService } from "./comms-metrics.service";

@Module({
  providers: [AnalyticsService, DailyReportService, OpsMetricsService, CommsMetricsService],
  exports: [AnalyticsService, DailyReportService, OpsMetricsService, CommsMetricsService],
})
export class AnalyticsModule {}
