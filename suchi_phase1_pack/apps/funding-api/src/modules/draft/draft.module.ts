import { Module } from "@nestjs/common";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { SourceRegistryModule } from "../source_registry/source-registry.module";
import { DraftController } from "./draft.controller";
import { DraftService } from "./draft.service";

@Module({
  imports: [CoreAiModule, SourceRegistryModule],
  controllers: [DraftController],
  providers: [DraftService],
})
export class DraftModule {}
