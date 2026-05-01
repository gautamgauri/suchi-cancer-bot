import { Module } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { ClinicalKeywordEnforcerService } from "./clinical-keyword-enforcer";
import { ObservabilityModule } from "../observability/observability.module";

@Module({
  imports: [ObservabilityModule],
  providers: [LlmService, ClinicalKeywordEnforcerService],
  exports: [LlmService, ClinicalKeywordEnforcerService]
})
export class LlmModule {}
