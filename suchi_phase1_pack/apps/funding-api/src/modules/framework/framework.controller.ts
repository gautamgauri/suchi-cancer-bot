import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CapabilityService } from "./services/capability.service";
import { MiService } from "./services/mi.service";
import { MethodCardService } from "./services/method-card.service";
import { PatternCardService } from "./services/pattern-card.service";
import { ComparableCaseService } from "./services/comparable-case.service";
import { CardRetrievalService } from "./services/card-retrieval.service";
import { ProjectTaggingService } from "./services/project-tagging.service";
import { CardIngesterService } from "./services/card-ingester.service";
import { MethodCardExtractor } from "./extractors/method-card.extractor";
import { PatternCardExtractor } from "./extractors/pattern-card.extractor";
import { ComparableCaseExtractor } from "./extractors/comparable-case.extractor";
import { MelPackGeneratorService } from "./services/mel-pack-generator.service";
import { ProgramDesignGeneratorService } from "./services/program-design-generator.service";
import { ComparablesGeneratorService } from "./services/comparables-generator.service";
import { ConsistencyCheckerService } from "./services/consistency-checker.service";
import { AnalyticsService } from "./services/analytics.service";
import type {
  CreateMethodCardDto,
  UpdateMethodCardDto,
  MethodCardQueryDto,
  CreatePatternCardDto,
  UpdatePatternCardDto,
  PatternCardQueryDto,
  CreateComparableCaseDto,
  UpdateComparableCaseDto,
  ComparableCaseQueryDto,
  TagProjectDto,
  MelPackInputDto,
  ProgramDesignInputDto,
  ComparablesInputDto,
  ConsistencyCheckInputDto,
} from "./dto";

function parseStringArray(v: string | string[] | undefined): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseNumber(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

@Controller("framework")
export class FrameworkController {
  constructor(
    private readonly capabilityService: CapabilityService,
    private readonly miService: MiService,
    private readonly methodCardService: MethodCardService,
    private readonly patternCardService: PatternCardService,
    private readonly comparableCaseService: ComparableCaseService,
    private readonly cardRetrievalService: CardRetrievalService,
    private readonly projectTaggingService: ProjectTaggingService,
    private readonly cardIngesterService: CardIngesterService,
    private readonly methodCardExtractor: MethodCardExtractor,
    private readonly patternCardExtractor: PatternCardExtractor,
    private readonly comparableCaseExtractor: ComparableCaseExtractor,
    private readonly melPackGenerator: MelPackGeneratorService,
    private readonly programDesignGenerator: ProgramDesignGeneratorService,
    private readonly comparablesGenerator: ComparablesGeneratorService,
    private readonly consistencyChecker: ConsistencyCheckerService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get("capabilities")
  async listCapabilities() {
    return this.capabilityService.list();
  }

  @Get("mi-modalities")
  async listMIModalities() {
    return this.miService.list();
  }

  @Get("method-cards")
  async listMethodCards(
    @Query("capabilities") capabilities?: string | string[],
    @Query("miModalities") miModalities?: string | string[],
    @Query("ageBand") ageBand?: string,
    @Query("setting") setting?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const query: MethodCardQueryDto = {
      capabilities: parseStringArray(capabilities),
      miModalities: parseStringArray(miModalities),
      ageBand,
      setting,
      status,
      limit: parseNumber(limit),
      offset: parseNumber(offset),
    };
    return this.methodCardService.list(query);
  }

  @Get("method-cards/:id")
  async getMethodCard(@Param("id") id: string) {
    const card = await this.methodCardService.findById(id);
    if (!card) return { error: "Not found" };
    return card;
  }

  @Post("method-cards")
  async createMethodCard(@Body() dto: CreateMethodCardDto) {
    return this.methodCardService.create(dto);
  }

  @Patch("method-cards/:id")
  async updateMethodCard(@Param("id") id: string, @Body() dto: UpdateMethodCardDto) {
    return this.methodCardService.update(id, dto);
  }

  @Get("pattern-cards")
  async listPatternCards(
    @Query("capabilities") capabilities?: string | string[],
    @Query("miModalities") miModalities?: string | string[],
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const query: PatternCardQueryDto = {
      capabilities: parseStringArray(capabilities),
      miModalities: parseStringArray(miModalities),
      status,
      limit: parseNumber(limit),
      offset: parseNumber(offset),
    };
    return this.patternCardService.list(query);
  }

  @Get("pattern-cards/:id")
  async getPatternCard(@Param("id") id: string) {
    const card = await this.patternCardService.findById(id);
    if (!card) return { error: "Not found" };
    return card;
  }

  @Post("pattern-cards")
  async createPatternCard(@Body() dto: CreatePatternCardDto) {
    return this.patternCardService.create(dto);
  }

  @Patch("pattern-cards/:id")
  async updatePatternCard(@Param("id") id: string, @Body() dto: UpdatePatternCardDto) {
    return this.patternCardService.update(id, dto);
  }

  @Get("comparable-cases")
  async listComparableCases(
    @Query("capabilities") capabilities?: string | string[],
    @Query("targetGroup") targetGroup?: string,
    @Query("geography") geography?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const query: ComparableCaseQueryDto = {
      capabilities: parseStringArray(capabilities),
      targetGroup,
      geography,
      status,
      limit: parseNumber(limit),
      offset: parseNumber(offset),
    };
    return this.comparableCaseService.list(query);
  }

  @Get("comparable-cases/:id")
  async getComparableCase(@Param("id") id: string) {
    const row = await this.comparableCaseService.findById(id);
    if (!row) return { error: "Not found" };
    return row;
  }

  @Post("comparable-cases")
  async createComparableCase(@Body() dto: CreateComparableCaseDto) {
    return this.comparableCaseService.create(dto);
  }

  @Patch("comparable-cases/:id")
  async updateComparableCase(@Param("id") id: string, @Body() dto: UpdateComparableCaseDto) {
    return this.comparableCaseService.update(id, dto);
  }

  @Post("tag-project/:projectId")
  async tagProject(@Param("projectId") projectId: string, @Body() dto: TagProjectDto) {
    const result = await this.projectTaggingService.tagProject(projectId, dto);
    await this.analytics.track({
      eventType: "capability_tag_applied",
      projectId,
      metadata: { capabilityCount: dto.tags?.length ?? 0 },
    });
    return result;
  }

  @Get("project-tags/:projectId")
  async getProjectTags(@Param("projectId") projectId: string) {
    return this.projectTaggingService.getProjectTags(projectId);
  }

  @Get("recommend/methods")
  async recommendMethods(
    @Query("ageBand") ageBand: string,
    @Query("setting") setting: string,
    @Query("capabilities") capabilities?: string,
    @Query("miModalities") miModalities?: string,
    @Query("methodLimit") methodLimit?: number,
    @Query("patternLimit") patternLimit?: number,
  ) {
    const caps = capabilities ? capabilities.split(",").map((s) => s.trim()) : [];
    const mis = miModalities ? miModalities.split(",").map((s) => s.trim()) : undefined;
    return this.cardRetrievalService.recommendMethodsAndPatterns({
      ageBand,
      setting,
      capabilities: caps,
      miModalities: mis,
      methodLimit: methodLimit ? Number(methodLimit) : undefined,
      patternLimit: patternLimit ? Number(patternLimit) : undefined,
    });
  }

  @Get("recommend/patterns")
  async recommendPatterns(
    @Query("ageBand") ageBand: string,
    @Query("setting") setting: string,
    @Query("capabilities") capabilities?: string,
    @Query("miModalities") miModalities?: string,
  ) {
    const caps = capabilities ? capabilities.split(",").map((s) => s.trim()) : [];
    const mis = miModalities ? miModalities.split(",").map((s) => s.trim()) : undefined;
    return this.cardRetrievalService.recommendMethodsAndPatterns({
      ageBand,
      setting,
      capabilities: caps,
      miModalities: mis,
      patternLimit: 5,
    });
  }

  @Post("retrieve")
  async retrieve(
    @Body("capabilities") capabilities?: string[],
    @Body("miModalities") miModalities?: string[],
    @Body("cardTypes") cardTypes?: ("method" | "pattern" | "comparable")[],
    @Body("targetGroup") targetGroup?: string,
    @Body("ageBand") ageBand?: string,
    @Body("setting") setting?: string,
    @Body("limit") limit?: number,
  ) {
    return this.cardRetrievalService.retrieve({
      capabilities,
      miModalities,
      cardTypes,
      targetGroup,
      ageBand,
      setting,
      limit,
    });
  }

  @Post("ingest/url")
  async ingestFromUrl(
    @Body("url") url: string,
    @Body("storeRaw") storeRaw?: boolean,
    @Body("extractAs") extractAs?: "method" | "pattern" | "comparable",
  ) {
    const result = await this.cardIngesterService.ingestFromUrl(url, { storeRaw });
    if (!result.ok || !result.text) return result;
    if (extractAs === "method") {
      const card = await this.methodCardExtractor.extractAndCreate(result.text, url);
      return { ...result, card: card ?? null };
    }
    if (extractAs === "pattern") {
      const card = await this.patternCardExtractor.extractAndCreate(result.text, url);
      return { ...result, card: card ?? null };
    }
    if (extractAs === "comparable") {
      const card = await this.comparableCaseExtractor.extractAndCreate(result.text, url);
      return { ...result, card: card ?? null };
    }
    return result;
  }

  @Post("generate/mel-pack")
  async generateMelPack(@Body() dto: MelPackInputDto) {
    const start = Date.now();
    const result = await this.melPackGenerator.generate(dto);
    await this.analytics.track({
      eventType: "mel_pack_generated",
      projectId: dto.projectId,
      durationMs: Date.now() - start,
      metadata: { capabilityCount: dto.capabilities.length },
    });
    return result;
  }

  @Post("generate/program-design")
  async generateProgramDesign(@Body() dto: ProgramDesignInputDto) {
    const start = Date.now();
    const result = await this.programDesignGenerator.generate(dto);
    await this.analytics.track({
      eventType: "program_design_generated",
      projectId: dto.projectId,
      durationMs: Date.now() - start,
    });
    return result;
  }

  @Post("generate/comparables-paragraph")
  async generateComparablesParagraph(@Body() dto: ComparablesInputDto) {
    const start = Date.now();
    const result = await this.comparablesGenerator.generate(dto);
    await this.analytics.track({
      eventType: "comparables_generated",
      durationMs: Date.now() - start,
      metadata: { caseCount: result.cases.length },
    });
    return result;
  }

  @Post("check/consistency")
  async checkConsistency(@Body() dto: ConsistencyCheckInputDto) {
    const start = Date.now();
    const result = await this.consistencyChecker.check(dto);
    await this.analytics.track({
      eventType: "consistency_check_run",
      projectId: dto.projectId,
      durationMs: Date.now() - start,
      metadata: {
        score: result.overallScore,
        passesQualityGate: result.passesQualityGate,
        flagCount: result.flags.length,
      },
    });
    if (result.passesQualityGate) {
      await this.analytics.track({ eventType: "quality_gate_passed", projectId: dto.projectId });
    } else if (result.flags.some((f) => f.severity === "error")) {
      await this.analytics.track({ eventType: "quality_gate_failed", projectId: dto.projectId });
    }
    return result;
  }
}
