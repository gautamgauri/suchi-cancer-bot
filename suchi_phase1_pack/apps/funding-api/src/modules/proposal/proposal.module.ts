import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { EvidenceIngestModule } from "../evidence_ingest/evidence-ingest.module";
import { OpportunityModule } from "../opportunity/opportunity.module";
import { PipelineModule } from "../pipeline/pipeline.module";
import { ActivityRegistryModule } from "../activity_registry/activity-registry.module";
import { FrameworkModule } from "../framework/framework.module";
import { ApplicationModule } from "../application/application.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ProposalController } from "./proposal.controller";
import { ProposalService } from "./proposal.service";
import { RfpParserService } from "./services/rfp-parser.service";
import { PlannerService } from "./services/planner.service";
import { QueryGeneratorService } from "./services/query-generator.service";
import { SectionWriterService } from "./services/section-writer.service";
import { QaReviewerService } from "./services/qa-reviewer.service";
import { ArtifactExporterService } from "./services/artifact-exporter.service";
import { SlackClientService } from "./services/slack-client.service";
import { CitationRepairService } from "./services/citation-repair.service";
import { FunderPriorityExtractorService } from "./services/funder-priority-extractor.service";
import { FrameworkIntelligenceService } from "./services/framework-intelligence.service";
import { FactsheetBuilderService } from "./services/factsheet-builder.service";

@Module({
  imports: [
    PrismaModule,
    CoreAiModule,
    EvidenceIngestModule,
    OpportunityModule,
    PipelineModule,
    ActivityRegistryModule,
    FrameworkModule,
    ApplicationModule,
    NotificationsModule,
  ],
  controllers: [ProposalController],
  providers: [
    ProposalService,
    RfpParserService,
    PlannerService,
    QueryGeneratorService,
    SectionWriterService,
    QaReviewerService,
    ArtifactExporterService,
    SlackClientService,
    CitationRepairService,
    FunderPriorityExtractorService,
    FrameworkIntelligenceService,
    FactsheetBuilderService,
  ],
  exports: [ProposalService, SlackClientService],
})
export class ProposalModule {}
