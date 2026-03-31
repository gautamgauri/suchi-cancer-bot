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
import { ReviewModule } from "../review/review.module";
import { ResponseValidatorService } from "./response-validator.service";
import { GreetingFlowService } from "./greeting-flow.service";
import { EmpathyDetector } from "./empathy-detector";
import { StructuredExtractorService } from "./structured-extractor.service";
import { PatientStateService } from "./patient-state.service";
// Phase 3 Agentic components
import { ExecutionPlannerService } from "./execution-planner.service";
import { PlanExecutorService } from "./plan-executor.service";
import { OutputVerifierService } from "./output-verifier.service";

@Module({
  imports: [
    SafetyModule,
    RagModule,
    LlmModule,
    AnalyticsModule,
    EvidenceGateModule,
    CitationModule,
    AbstentionModule,
    PrismaModule,
    ReviewModule
  ],
  controllers: [ChatController],
  providers: [ChatService, IntentClassifier, TemplateSelector, ResponseValidatorService, GreetingFlowService, EmpathyDetector, StructuredExtractorService, PatientStateService, ExecutionPlannerService, PlanExecutorService, OutputVerifierService],
  exports: [ChatService]
})
export class ChatModule {}
