import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { CardRetrievalService } from "./card-retrieval.service";
import { PROGRAM_DESIGN_SYSTEM, PROGRAM_DESIGN_USER } from "../prompts/program-design.prompt";
import type { ProgramDesignInputDto } from "../dto";
import type { MethodCardDto, PatternCardDto } from "../dto";

export interface ProgramDesignResult {
  summary: string;
  theoryOfChange: {
    inputs: string[];
    activities: string[];
    outputs: string[];
    outcomes: string[];
    impact: string;
  };
  activityBlocks: Array<{
    weekRange: string;
    theme: string;
    capabilityFocus: string[];
    miFocus: string[];
    suggestedMethods: MethodCardDto[];
    suggestedPatterns: PatternCardDto[];
    assessmentApproach: string;
  }>;
  facilitatorNotes: string;
  gaps: string[];
}

@Injectable()
export class ProgramDesignGeneratorService {
  private readonly logger = new Logger(ProgramDesignGeneratorService.name);

  constructor(
    private readonly llm: FundingLlmService,
    private readonly cardRetrievalService: CardRetrievalService,
  ) {}

  async generate(dto: ProgramDesignInputDto): Promise<ProgramDesignResult> {
    const retrieval = await this.cardRetrievalService.retrieve({
      capabilities: dto.capabilities,
      miModalities: dto.miModalities,
      cardTypes: ["method", "pattern"],
      ageBand: dto.ageBand,
      setting: dto.setting,
      limit: 10,
    });
    const context = `Available methods: ${retrieval.methods.map((m) => m.title).join(", ")}. Patterns: ${retrieval.patterns.map((p) => p.title).join(", ")}.`;
    const userPrompt = PROGRAM_DESIGN_USER(
      dto.capabilities,
      dto.miModalities,
      dto.targetGroup,
      dto.ageBand,
      dto.setting,
      context,
    );
    const raw = await this.llm.generatePlain(PROGRAM_DESIGN_SYSTEM, "", userPrompt);
    const parsed = this.parseProgramDesignJson(raw, retrieval.methods, retrieval.patterns);
    return (
      parsed ?? {
        summary: "",
        theoryOfChange: { inputs: [], activities: [], outputs: [], outcomes: [], impact: "" },
        activityBlocks: [],
        facilitatorNotes: "",
        gaps: ["Could not parse program design from model response."],
      }
    );
  }

  private parseProgramDesignJson(
    raw: string,
    methods: MethodCardDto[],
    patterns: PatternCardDto[],
  ): ProgramDesignResult | null {
    const trimmed = raw.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}") + 1;
    if (start < 0 || end <= start) return null;
    try {
      const json = JSON.parse(trimmed.slice(start, end)) as Record<string, unknown>;
      const toc = json.theoryOfChange as Record<string, unknown> | undefined;
      const blocks = Array.isArray(json.activityBlocks) ? json.activityBlocks : [];
      const activityBlocks = blocks.map((b: unknown) => {
        const block = b as Record<string, unknown>;
        const methodTitles = (Array.isArray(block.suggestedMethodTitles) ? block.suggestedMethodTitles : []) as string[];
        const patternTitles = (Array.isArray(block.suggestedPatternTitles) ? block.suggestedPatternTitles : []) as string[];
        return {
          weekRange: String(block.weekRange ?? ""),
          theme: String(block.theme ?? ""),
          capabilityFocus: Array.isArray(block.capabilityFocus) ? block.capabilityFocus.map(String) : [],
          miFocus: Array.isArray(block.miFocus) ? block.miFocus.map(String) : [],
          suggestedMethods: methods.filter((m) => methodTitles.some((t) => m.title.includes(t) || t.includes(m.title))).slice(0, 3),
          suggestedPatterns: patterns.filter((p) => patternTitles.some((t) => p.title.includes(t) || t.includes(p.title))).slice(0, 3),
          assessmentApproach: String(block.assessmentApproach ?? ""),
        };
      });
      return {
        summary: String(json.summary ?? ""),
        theoryOfChange: {
          inputs: Array.isArray(toc?.inputs) ? toc.inputs.map(String) : [],
          activities: Array.isArray(toc?.activities) ? toc.activities.map(String) : [],
          outputs: Array.isArray(toc?.outputs) ? toc.outputs.map(String) : [],
          outcomes: Array.isArray(toc?.outcomes) ? toc.outcomes.map(String) : [],
          impact: String(toc?.impact ?? ""),
        },
        activityBlocks,
        facilitatorNotes: String(json.facilitatorNotes ?? ""),
        gaps: Array.isArray(json.gaps) ? json.gaps.map(String) : [],
      };
    } catch {
      return null;
    }
  }
}
