import { Module } from "@nestjs/common";
import { FundingLlmService } from "./funding-llm.service";

@Module({
  providers: [FundingLlmService],
  exports: [FundingLlmService],
})
export class CoreAiModule {}
