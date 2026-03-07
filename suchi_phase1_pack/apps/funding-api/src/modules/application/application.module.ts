import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { ApplicationController } from "./application.controller";
import { ApplicationIntakeService } from "./application-intake.service";
import { QuestionExtractorService } from "./question-extractor.service";
import { AnswerGeneratorService } from "./answer-generator.service";
import { ApplicationReviewService } from "./application-review.service";
import { BrowserPrefillService } from "./browser-prefill.service";
import { PlaywrightScraperService } from "./playwright-scraper.service";
import { ApplicationSlackService } from "./application-slack.service";
import { SlackSignatureGuard } from "./slack-signature.guard";

@Module({
  imports: [PrismaModule, CoreAiModule],
  controllers: [ApplicationController],
  providers: [
    ApplicationIntakeService,
    QuestionExtractorService,
    AnswerGeneratorService,
    ApplicationReviewService,
    BrowserPrefillService,
    PlaywrightScraperService,
    ApplicationSlackService,
    SlackSignatureGuard,
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
