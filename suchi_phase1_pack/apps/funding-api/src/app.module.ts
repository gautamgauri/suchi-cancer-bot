import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { envSchema } from "./config/env.validation";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { HealthModule } from "./modules/health/health.module";
import { CoreAiModule } from "./modules/core_ai/core-ai.module";
import { DraftModule } from "./modules/draft/draft.module";
import { PipelineModule } from "./modules/pipeline/pipeline.module";
import { SheetsModule } from "./modules/sheets/sheets.module";
import { DonorModule } from "./modules/donor/donor.module";
import { AdminModule } from "./modules/admin/admin.module";
import { ApprovalsModule } from "./modules/approvals/approvals.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { SourceRegistryModule } from "./modules/source_registry/source-registry.module";
import { EvidenceIngestModule } from "./modules/evidence_ingest/evidence-ingest.module";
import { OpportunityModule } from "./modules/opportunity/opportunity.module";
import { GmailModule } from "./modules/gmail/gmail.module";
import { ProposalModule } from "./modules/proposal/proposal.module";
import { FrameworkModule } from "./modules/framework/framework.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { FunderScraperModule } from "./modules/funder_scraper/funder-scraper.module";
import { GiftModule } from "./modules/gift/gift.module";
import { ActivityRegistryModule } from "./modules/activity_registry/activity-registry.module";
import { OrchestratorModule } from "./modules/orchestrator/orchestrator.module";
import { ApplicationModule } from "./modules/application/application.module";
import { SccfIngestModule } from "./modules/sccf-ingest/sccf-ingest.module";
import { FellowshipModule } from "./modules/fellowship/fellowship.module";
import { EmailPipelineModule } from "./modules/email-pipeline/email-pipeline.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (c) => envSchema.parse(c) }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SheetsModule,
    GiftModule,
    NotificationsModule,
    HealthModule,
    CoreAiModule,
    SourceRegistryModule,
    EvidenceIngestModule,
    GmailModule,
    DraftModule,
    PipelineModule,
    OpportunityModule,
    ProposalModule,
    FrameworkModule,
    ApprovalsModule,
    ReportsModule,
    DonorModule,
    AdminModule,
    FunderScraperModule,
    ActivityRegistryModule,
    OrchestratorModule,
    ApplicationModule,
    SccfIngestModule,
    FellowshipModule,
    EmailPipelineModule,
  ],
})
export class AppModule {}
