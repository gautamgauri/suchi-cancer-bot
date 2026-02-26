import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { ApplicationController } from "./application.controller";
import { ApplicationIntakeService } from "./application-intake.service";
import { QuestionExtractorService } from "./question-extractor.service";
import { AnswerGeneratorService } from "./answer-generator.service";
import { ApplicationReviewService } from "./application-review.service";
import { BrowserPrefillService } from "./browser-prefill.service";
import { ApplicationSlackService } from "./application-slack.service";

@Module({
  imports: [PrismaModule, CoreAiModule],
  controllers: [ApplicationController],
  providers: [
    ApplicationIntakeService,
    QuestionExtractorService,
    AnswerGeneratorService,
    ApplicationReviewService,
    BrowserPrefillService,
    ApplicationSlackService,
  ],
  exports: [
    ApplicationIntakeService,
    QuestionExtractorService,
    AnswerGeneratorService,
    ApplicationReviewService,
    BrowserPrefillService,
    ApplicationSlackService,
  ],
})
export class ApplicationModule {}
