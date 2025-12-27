import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { SafetyModule } from "../safety/safety.module";
import { RagModule } from "../rag/rag.module";
import { LlmModule } from "../llm/llm.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { EvidenceGateModule } from "../evidence/evidence-gate.module";
import { CitationModule } from "../citations/citation.module";
import { AbstentionModule } from "../abstention/abstention.module";
import { PrismaModule } from "../prisma/prisma.module";

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
  providers: [ChatService]
})
export class ChatModule {}
