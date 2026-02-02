import { Module } from "@nestjs/common";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { DraftController } from "./draft.controller";
import { DraftService } from "./draft.service";

@Module({
  imports: [CoreAiModule],
  controllers: [DraftController],
  providers: [DraftService],
})
export class DraftModule {}
