import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { FrameworkController } from "./framework.controller";
import { CapabilityService } from "./services/capability.service";
import { MiService } from "./services/mi.service";
import { MethodCardService } from "./services/method-card.service";
import { PatternCardService } from "./services/pattern-card.service";
import { ComparableCaseService } from "./services/comparable-case.service";
import { CardRetrievalService } from "./services/card-retrieval.service";
import { ProjectTaggingService } from "./services/project-tagging.service";
import { CardIngesterService } from "./services/card-ingester.service";
import { MelPackGeneratorService } from "./services/mel-pack-generator.service";
import { ProgramDesignGeneratorService } from "./services/program-design-generator.service";
import { ComparablesGeneratorService } from "./services/comparables-generator.service";
import { ConsistencyCheckerService } from "./services/consistency-checker.service";
import { AnalyticsService } from "./services/analytics.service";
import { MethodCardExtractor } from "./extractors/method-card.extractor";
import { PatternCardExtractor } from "./extractors/pattern-card.extractor";
import { ComparableCaseExtractor } from "./extractors/comparable-case.extractor";

@Module({
  imports: [PrismaModule, CoreAiModule],
  controllers: [FrameworkController],
  providers: [
    CapabilityService,
    MiService,
    MethodCardService,
    PatternCardService,
    ComparableCaseService,
    CardRetrievalService,
    ProjectTaggingService,
    CardIngesterService,
    MelPackGeneratorService,
    ProgramDesignGeneratorService,
    ComparablesGeneratorService,
    ConsistencyCheckerService,
    AnalyticsService,
    MethodCardExtractor,
    PatternCardExtractor,
    ComparableCaseExtractor,
  ],
  exports: [
    CapabilityService,
    MiService,
    MethodCardService,
    PatternCardService,
    ComparableCaseService,
    CardRetrievalService,
    ProjectTaggingService,
    CardIngesterService,
    MelPackGeneratorService,
    ProgramDesignGeneratorService,
    ComparablesGeneratorService,
    ConsistencyCheckerService,
    AnalyticsService,
    MethodCardExtractor,
    PatternCardExtractor,
    ComparableCaseExtractor,
  ],
})
export class FrameworkModule {}
