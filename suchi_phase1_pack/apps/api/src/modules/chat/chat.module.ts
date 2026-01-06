import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { IntentClassifier } from "./intent-classifier";
import { TemplateSelector } from "./template-selector";
import { SafetyModule } from "../safety/safety.module";
import { RagModule } from "../rag/rag.module";
import { LlmModule } from "../llm/llm.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { EvidenceGateModule } from "../evidence/evidence-gate.module";
import { CitationModule } from "../citations/citation.module";
import { AbstentionModule } from "../abstention/abstention.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ResponseValidatorService } from "./response-validator.service";

@Module({
  imports: [
    SafetyModule,
    RagModule,
    LlmModule,
    AnalyticsModule,
    EvidenceGateModule,
    CitationModule,
    AbstentionModule,
    PrismaModule
  ],
  controllers: [ChatController],
  providers: [ChatService, IntentClassifier, TemplateSelector, ResponseValidatorService]
})
export class ChatModule {}
