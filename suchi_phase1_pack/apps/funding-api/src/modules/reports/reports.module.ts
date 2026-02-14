import { Module } from "@nestjs/common";
import { PipelineModule } from "../pipeline/pipeline.module";
import { GiftModule } from "../gift/gift.module";
import { EvidenceIngestModule } from "../evidence_ingest/evidence-ingest.module";
import { ProposalModule } from "../proposal/proposal.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { ReconciliationService } from "./reconciliation.service";
import { ReconciliationSchedulerService } from "./reconciliation-scheduler.service";

@Module({
  imports: [PipelineModule, GiftModule, EvidenceIngestModule, ProposalModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReconciliationService,
    ReconciliationSchedulerService,
  ],
  exports: [ReportsService, ReconciliationService],
})
export class ReportsModule {}
