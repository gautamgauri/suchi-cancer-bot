import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { EvidenceIngestModule } from "../evidence_ingest/evidence-ingest.module";
import { OpportunityModule } from "../opportunity/opportunity.module";
import { ApplicationModule } from "../application/application.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FellowshipService } from "./fellowship.service";
import { OpportunityInterpreterService } from "./services/opportunity-interpreter.service";
import { BridgeSelectorService } from "./services/bridge-selector.service";
import { NarrativeSynthesizerService } from "./services/narrative-synthesizer.service";
import { SectionPlannerService } from "./services/section-planner.service";
import { FellowshipCriticService } from "./services/fellowship-critic.service";

@Module({
  imports: [
    PrismaModule,
    CoreAiModule,
    EvidenceIngestModule,
    OpportunityModule,
    ApplicationModule,
    NotificationsModule,
  ],
  providers: [
    FellowshipService,
    OpportunityInterpreterService,
    BridgeSelectorService,
    NarrativeSynthesizerService,
    SectionPlannerService,
    FellowshipCriticService,
  ],
  exports: [FellowshipService],
})
export class FellowshipModule {}
