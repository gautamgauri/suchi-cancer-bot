import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { EvidenceIngestModule } from "../evidence_ingest/evidence-ingest.module";
import { OpportunityModule } from "../opportunity/opportunity.module";
import { ProposalController } from "./proposal.controller";
import { ProposalService } from "./proposal.service";
import { RfpParserService } from "./services/rfp-parser.service";
import { PlannerService } from "./services/planner.service";
import { QueryGeneratorService } from "./services/query-generator.service";
import { SectionWriterService } from "./services/section-writer.service";
import { QaReviewerService } from "./services/qa-reviewer.service";
import { ArtifactExporterService } from "./services/artifact-exporter.service";
import { SlackClientService } from "./services/slack-client.service";

@Module({
  imports: [PrismaModule, CoreAiModule, EvidenceIngestModule, OpportunityModule],
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
  ],
  exports: [ProposalService],
})
export class ProposalModule {}
