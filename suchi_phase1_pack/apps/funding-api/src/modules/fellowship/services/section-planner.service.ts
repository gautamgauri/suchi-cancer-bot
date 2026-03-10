import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import type {
  ApplicantNarrative,
  FellowshipBridge,
  FellowshipInterpretation,
  SectionPlan,
} from "../fellowship-pipeline.types";
import {
  SECTION_PLANNER_SYSTEM,
  buildSectionPlannerPrompt,
} from "../prompts/section-planner.prompt";

@Injectable()
export class SectionPlannerService {
  private readonly logger = new Logger(SectionPlannerService.name);

  constructor(private readonly llm: FundingLlmService) {}

  async plan(params: {
    bridge: FellowshipBridge;
    narrative: ApplicantNarrative;
    interpretation: FellowshipInterpretation;
    sections: Array<{
      name: string;
      guidance: string;
      wordLimit?: number;
      archetype?: { owns: string; avoids: string };
    }>;
  }): Promise<SectionPlan> {
    const userPrompt = buildSectionPlannerPrompt({
      bridge: {
        thesis: params.bridge.thesis,
        sectionAnchors: params.bridge.sectionAnchors,
      },
      narrative: {
        originMoment: params.narrative.originMoment,
        leadershipExamples: params.narrative.leadershipExamples,
        numericFacts: params.narrative.numericFacts,
        tensionsNavigated: params.narrative.tensionsNavigated,
      },
      interpretation: {
        intellectualCore: params.interpretation.intellectualCore,
        keyThemes: params.interpretation.keyThemes,
        antiPatterns: params.interpretation.antiPatterns,
      },
      sections: params.sections,
    });

    const raw = await this.llm.generatePlain(
      SECTION_PLANNER_SYSTEM,
      "Plan section content allocation:",
      userPrompt,
      { maxTokens: 4000 },
    );

    const json = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(json) as SectionPlan;

    this.logger.log({
      message: "FELLOWSHIP_SECTIONS_PLANNED",
      sectionCount: parsed.sections?.length,
      sections: parsed.sections?.map((s) => s.name),
    });

    return parsed;
  }
}
