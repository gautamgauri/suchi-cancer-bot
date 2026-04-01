import { Module } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { ClinicalKeywordEnforcerService } from "./clinical-keyword-enforcer";

@Module({
  providers: [LlmService, ClinicalKeywordEnforcerService],
  exports: [LlmService, ClinicalKeywordEnforcerService]
})
export class LlmModule {}
