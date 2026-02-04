import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EvidenceIngestModule } from "../evidence_ingest/evidence-ingest.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { PipelineModule } from "../pipeline/pipeline.module";
import { GmailModule } from "../gmail/gmail.module";
import { OpportunityController } from "./opportunity.controller";
import { OpportunityService } from "./opportunity.service";
import { OpportunityArchiveService } from "./opportunity-archive.service";
import { OpportunityPipelineService } from "./opportunity-pipeline.service";
import { OpportunityIntakeService } from "./opportunity-intake.service";
import { RfpTextExtractService } from "./extract/rfp-text-extract.service";
import { RfpConstraintsExtractService } from "./extract/rfp-constraints-extract.service";
import { AnnexureSchemaService } from "./extract/annexure-schema.service";
import { OpportunityExtractService } from "./extract/opportunity-extract.service";

@Module({
  imports: [PrismaModule, EvidenceIngestModule, CoreAiModule, PipelineModule, GmailModule],
  controllers: [OpportunityController],
  providers: [
    OpportunityService,
    OpportunityArchiveService,
    OpportunityPipelineService,
    OpportunityIntakeService,
    RfpTextExtractService,
    RfpConstraintsExtractService,
    AnnexureSchemaService,
    OpportunityExtractService,
  ],
  exports: [OpportunityService, OpportunityArchiveService, OpportunityPipelineService, OpportunityExtractService],
})
export class OpportunityModule {}
