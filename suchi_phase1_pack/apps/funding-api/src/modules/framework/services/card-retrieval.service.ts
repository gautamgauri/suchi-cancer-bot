import { Injectable } from "@nestjs/common";
import { MethodCardService } from "./method-card.service";
import { PatternCardService } from "./pattern-card.service";
import { ComparableCaseService } from "./comparable-case.service";
import type { MethodCardDto, PatternCardDto, ComparableCaseDto } from "../dto";

export interface FrameworkRetrievalOptions {
  capabilities?: string[];
  miModalities?: string[];
  cardTypes?: ("method" | "pattern" | "comparable")[];
  targetGroup?: string;
  geography?: string;
  ageBand?: string;
  setting?: string;
  limit?: number;
  status?: string;
}

export interface FrameworkRetrievalResult {
  methods: MethodCardDto[];
  patterns: PatternCardDto[];
  comparables: ComparableCaseDto[];
}

@Injectable()
export class CardRetrievalService {
  constructor(
    private readonly methodCardService: MethodCardService,
    private readonly patternCardService: PatternCardService,
    private readonly comparableCaseService: ComparableCaseService,
  ) {}

  async retrieve(options: FrameworkRetrievalOptions): Promise<FrameworkRetrievalResult> {
    const types = options.cardTypes ?? ["method", "pattern", "comparable"];
    const limit = options.limit ?? 10;
    const status = options.status ?? "validated";

    const [methods, patterns, comparables] = await Promise.all([
      types.includes("method")
        ? this.methodCardService.list({
            capabilities: options.capabilities,
            miModalities: options.miModalities,
            ageBand: options.ageBand,
            setting: options.setting,
            status,
            limit,
          })
        : Promise.resolve([]),
      types.includes("pattern")
        ? this.patternCardService.list({
            capabilities: options.capabilities,
            miModalities: options.miModalities,
            status,
            limit,
          })
        : Promise.resolve([]),
      types.includes("comparable")
        ? this.comparableCaseService.list({
            capabilities: options.capabilities,
            targetGroup: options.targetGroup,
            geography: options.geography,
            status,
            limit,
          })
        : Promise.resolve([]),
    ]);

    return { methods, patterns, comparables };
  }

  async recommendMethodsAndPatterns(options: {
    ageBand: string;
    setting: string;
    capabilities: string[];
    miModalities?: string[];
    methodLimit?: number;
    patternLimit?: number;
  }): Promise<{ methodCards: MethodCardDto[]; patternCards: PatternCardDto[] }> {
    const [methodCards, patternCards] = await Promise.all([
      this.methodCardService.list({
        capabilities: options.capabilities,
        miModalities: options.miModalities,
        ageBand: options.ageBand,
        setting: options.setting,
        status: "validated",
        limit: options.methodLimit ?? 5,
      }),
      this.patternCardService.list({
        capabilities: options.capabilities,
        miModalities: options.miModalities,
        status: "validated",
        limit: options.patternLimit ?? 5,
      }),
    ]);
    return { methodCards, patternCards };
  }
}
