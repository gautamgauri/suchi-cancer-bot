import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { GmailModule } from "../gmail/gmail.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { OpportunityModule } from "../opportunity/opportunity.module";
import { OrchestratorModule } from "../orchestrator/orchestrator.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmailPipelineController } from "./email-pipeline.controller";
import { EmailPipelineService } from "./email-pipeline.service";
import { EmailClassifierService } from "./email-classifier.service";
import { DraftFormatterService } from "./draft-formatter.service";

@Module({
  imports: [
    PrismaModule,
    GmailModule,
    CoreAiModule,
    OpportunityModule,
    OrchestratorModule,
    NotificationsModule,
  ],
  controllers: [EmailPipelineController],
  providers: [
    EmailPipelineService,
    EmailClassifierService,
    DraftFormatterService,
  ],
  exports: [EmailPipelineService],
})
export class EmailPipelineModule {}
