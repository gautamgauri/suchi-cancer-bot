import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import type {
  FellowshipBridge,
  FellowshipCriticResult,
  FellowshipInterpretation,
} from "../fellowship-pipeline.types";
import {
  FELLOWSHIP_CRITIC_SYSTEM,
  buildFellowshipCriticPrompt,
} from "../prompts/fellowship-critic.prompt";

@Injectable()
export class FellowshipCriticService {
  private readonly logger = new Logger(FellowshipCriticService.name);

  constructor(private readonly llm: FundingLlmService) {}

  async review(params: {
    interpretation: FellowshipInterpretation;
    bridge: FellowshipBridge;
    sections: Array<{ name: string; text: string }>;
    verifiedFacts?: Array<{ claim: string; source: string }>;
  }): Promise<FellowshipCriticResult> {
    const userPrompt = buildFellowshipCriticPrompt({
      interpretation: {
        intellectualCore: params.interpretation.intellectualCore,
        keyThemes: params.interpretation.keyThemes,
        antiPatterns: params.interpretation.antiPatterns,
      },
      bridge: { thesis: params.bridge.thesis },
      sections: params.sections,
      verifiedFacts: params.verifiedFacts,
    });

    const raw = await this.llm.generatePlain(
      FELLOWSHIP_CRITIC_SYSTEM,
      "Review this fellowship application:",
      userPrompt,
      { maxTokens: 3000 },
    );

    const json = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(json) as FellowshipCriticResult;

    this.logger.log({
      message: "FELLOWSHIP_CRITIC_RESULT",
      overallScore: parsed.overallScore,
      dimensions: parsed.dimensions?.map((d) => `${d.dimension}:${d.score}`),
      crossSectionIssues: parsed.crossSectionIssues?.length,
      tagViolations: parsed.tagViolations?.length,
    });

    return parsed;
  }
}
