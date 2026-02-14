import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { FunderScraperService } from "./funder-scraper.service";

@Injectable()
export class ScheduledFunderScraperService {
  private readonly logger = new Logger(ScheduledFunderScraperService.name);
  private readonly enabled: boolean;
  private readonly maxOrgsPerRun: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly funderScraper: FunderScraperService,
  ) {
    this.enabled = this.configService.get<string>("FUNDING_FUNDER_SCRAPER_ENABLED") === "true";
    this.maxOrgsPerRun = Math.min(
      5,
      Math.max(1, Number(this.configService.get<string>("FUNDING_FUNDER_SCRAPER_MAX_ORGS_PER_RUN")) || 2),
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async runScheduledScrape(): Promise<void> {
    if (!this.enabled || !this.funderScraper.isEnabled()) {
      return;
    }

    const pending = await this.prisma.funderOrg.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: this.maxOrgsPerRun,
    });

    if (pending.length === 0) {
      return;
    }

    this.logger.log(`Funder scraper: processing ${pending.length} org(s)`);

    for (const org of pending) {
      try {
        await this.prisma.funderOrg.update({
          where: { id: org.id },
          data: { status: "in_progress", error: null },
        });

        const facts = await this.funderScraper.scrapeOrg({
          id: org.id,
          orgName: org.orgName,
          orgWebsite: org.orgWebsite,
          network: org.network,
        });

        await this.prisma.$transaction([
          this.prisma.funderFact.deleteMany({ where: { funderOrgId: org.id } }),
          this.prisma.funderFact.createMany({
            data: facts.map((f) => ({
              funderOrgId: org.id,
              orgName: f.org_name,
              orgWebsite: f.org_website,
              network: f.network,
              funderName: f.funder_name,
              funderType: f.funder_type,
              evidenceType: f.evidence_type,
              evidenceExcerpt: f.evidence_excerpt,
              evidenceUrl: f.evidence_url,
              financialAmount: f.financial_amount,
              grantYears: f.grant_years,
              programFocus: f.program_focus,
              geography: f.geography,
              confidenceScore: f.confidence_score,
              notes: f.notes,
              normalizedFunder: f.normalized_funder,
              matchConfidence: f.match_confidence,
            })),
          }),
        ]);

        await this.prisma.funderOrg.update({
          where: { id: org.id },
          data: { status: "done", lastRunAt: new Date(), error: null },
        });

        this.logger.log(`Funder scraper: ${org.orgName} (${org.network}) – ${facts.length} funder(s)`);
      } catch (e) {
        const message = (e as Error).message;
        this.logger.error(`Funder scraper failed for ${org.orgName}: ${message}`);
        await this.prisma.funderOrg.update({
          where: { id: org.id },
          data: { status: "failed", lastRunAt: new Date(), error: message },
        });
      }
    }
  }
}
