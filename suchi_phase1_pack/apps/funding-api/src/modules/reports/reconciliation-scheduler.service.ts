import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { SlackClientService } from "../proposal/services/slack-client.service";
import { ReconciliationService } from "./reconciliation.service";
import { ReportsService } from "./reports.service";

@Injectable()
export class ReconciliationSchedulerService {
  private readonly logger = new Logger(ReconciliationSchedulerService.name);

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly reportsService: ReportsService,
    private readonly configService: ConfigService,
    private readonly slackClient: SlackClientService,
  ) {}

  @Cron("0 9 1 * *") // 9:00 AM on the 1st of every month
  async runMonthlyMiniClose(): Promise<void> {
    this.logger.log("Monthly mini-close: generating reconciliation checklist");
    try {
      const m = await this.reconciliation.getMetrics();
      this.logger.log({
        message: "Monthly mini-close metrics",
        reconciliationRate: m.reconciliationRate,
        reconciliationRateByValue: m.reconciliationRateByValue,
        unmatchedCount: m.unmatchedCount,
        unmatchedValue: m.unmatchedValue,
        oldestUnmatchedAgeDays: m.oldestUnmatchedAgeDays,
        checklist: m.checklist,
      });
    } catch (e) {
      this.logger.error(
        `Monthly mini-close failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }

  @Cron("0 10 * * 1-5") // 10:00 AM, weekdays
  async runStalledProspectNudgesPreview(): Promise<void> {
    const enabled =
      (this.configService.get<string>("FUNDING_STALLED_NUDGE_ENABLED") ?? "false").toLowerCase() ===
      "true";
    if (!enabled) {
      return;
    }
    try {
      const result = await this.reportsService.getStalledProspects();
      this.logger.log({
        message: "Stalled prospect nudge preview",
        generatedAt: result.generatedAt,
        staleThresholdDays: result.staleThresholdDays,
        count: result.count,
        sample: result.nudges.slice(0, 5).map((n) => ({
          entryId: n.entryId,
          orgName: n.orgName,
          stage: n.stage,
          recommendations: n.recommendations,
        })),
      });

      if (result.count > 0 && this.slackClient.isConfigured()) {
        const token =
          this.configService.get<string>("FUNDING_WRITE_APPROVAL_TOKEN") ??
          this.configService.get<string>("FUNDING_EXPORT_TOKEN");
        const approval = token
          ? {
              approvalToken: token,
              interactionId: "stalled_nudge_cron",
              outcome: "approved" as const,
              actor: { actorType: "system" as const, actorId: "reconciliation_scheduler" },
              timestamp: new Date().toISOString(),
            }
          : undefined;
        const delivery = await this.slackClient.postStalledNudges(result.nudges, { approval });
        if (delivery.sent) {
          this.logger.log(`Stalled nudge digest posted to Slack (${result.count} prospects)`);
        } else {
          this.logger.warn(
            `Stalled nudge digest not sent: ${delivery.reason ?? "blocked"}. Set FUNDING_WRITE_APPROVAL_TOKEN to allow.`,
          );
        }
      }
    } catch (e) {
      this.logger.error(
        `Stalled prospect nudge preview failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }
}
