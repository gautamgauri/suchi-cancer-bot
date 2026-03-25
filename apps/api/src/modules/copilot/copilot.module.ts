import { Module } from '@nestjs/common';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { EvalBridgeService } from './services/eval-bridge.service';
import { FailureClassifierService } from './services/failure-classifier.service';
import { PatchPlannerService } from './services/patch-planner.service';
import { PatchExecutorService } from './services/patch-executor.service';
import { SafetyModule } from '../safety/safety.module';
import { RagModule } from '../rag/rag.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [SafetyModule, RagModule, LlmModule],
  controllers: [CopilotController],
  providers: [
    CopilotService,
    EvalBridgeService,
    FailureClassifierService,
    PatchPlannerService,
    PatchExecutorService,
  ],
  exports: [CopilotService],
})
export class CopilotModule {}
