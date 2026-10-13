import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { SafetyModule } from "../safety/safety.module";
import { AbstentionModule } from "../abstention/abstention.module";
import { SafetyClassifierService } from "./safety-classifier.service";
import { SafetyClassifierShadowService } from "./safety-classifier-shadow.service";

/**
 * AI safety classifier — Phase 1, shadow mode only. See docs/safety-classifier.md.
 * Off unless SAFETY_CLASSIFIER_SHADOW_ENABLED=true.
 */
@Module({
  imports: [LlmModule, AnalyticsModule, SafetyModule, AbstentionModule],
  providers: [SafetyClassifierService, SafetyClassifierShadowService],
  exports: [SafetyClassifierService, SafetyClassifierShadowService],
})
export class SafetyClassifierModule {}
