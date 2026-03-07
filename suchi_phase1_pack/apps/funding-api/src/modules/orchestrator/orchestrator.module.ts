import { Module } from "@nestjs/common";
import { EvidenceIngestModule } from "../evidence_ingest/evidence-ingest.module";
import { ActivityRegistryModule } from "../activity_registry/activity-registry.module";
import { GmailModule } from "../gmail/gmail.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { GoogleSearchModule } from "../google_search/google-search.module";
import { OpportunityModule } from "../opportunity/opportunity.module";
import { ProposalModule } from "../proposal/proposal.module";
import { FellowshipModule } from "../fellowship/fellowship.module";
import { OrchestratorController } from "./orchestrator.controller";
import { OrchestratorService } from "./orchestrator.service";
import { EnhancedFitScoringService } from "./services/enhanced-fit-scoring.service";
import { GmailMemoryService } from "./services/gmail-memory.service";
import { BudgetEnvelopeService } from "./services/budget-envelope.service";
import { WebEvidenceService } from "./services/web-evidence.service";
import { DeadlineCheckService } from "./services/deadline-check.service";

@Module({
  imports: [
    EvidenceIngestModule,
    ActivityRegistryModule,
    GmailModule,
    CoreAiModule,
    GoogleSearchModule,
    OpportunityModule,
    ProposalModule,
    FellowshipModule,
  ],
  controllers: [OrchestratorController],
  providers: [
    OrchestratorService,
    EnhancedFitScoringService,
    GmailMemoryService,
    BudgetEnvelopeService,
    WebEvidenceService,
    DeadlineCheckService,
  ],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
