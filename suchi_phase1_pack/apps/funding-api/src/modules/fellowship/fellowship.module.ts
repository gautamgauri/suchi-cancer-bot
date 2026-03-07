import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { EvidenceIngestModule } from "../evidence_ingest/evidence-ingest.module";
import { OpportunityModule } from "../opportunity/opportunity.module";
import { ApplicationModule } from "../application/application.module";
import { FellowshipService } from "./fellowship.service";

@Module({
  imports: [
    PrismaModule,
    CoreAiModule,
    EvidenceIngestModule,
    OpportunityModule,
    ApplicationModule,
  ],
  providers: [FellowshipService],
  exports: [FellowshipService],
})
export class FellowshipModule {}
