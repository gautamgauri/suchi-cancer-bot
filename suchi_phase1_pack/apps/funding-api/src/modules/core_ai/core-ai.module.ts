import { Module } from "@nestjs/common";
import { FundingLlmService } from "./funding-llm.service";
import { CitationIntegrityService } from "./citation-integrity.service";

@Module({
  providers: [FundingLlmService, CitationIntegrityService],
  exports: [FundingLlmService, CitationIntegrityService],
})
export class CoreAiModule {}
