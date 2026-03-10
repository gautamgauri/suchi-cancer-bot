import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import type { ApplicantNarrative, FellowshipInterpretation } from "../fellowship-pipeline.types";
import {
  NARRATIVE_SYNTHESIZER_SYSTEM,
  buildNarrativeSynthesizerPrompt,
} from "../prompts/narrative-synthesizer.prompt";

@Injectable()
export class NarrativeSynthesizerService {
  private readonly logger = new Logger(NarrativeSynthesizerService.name);

  constructor(private readonly llm: FundingLlmService) {}

  async synthesize(params: {
    applicantProfile: string;
    pastAnswers: string;
    dbSnippets: string;
    interpretation: FellowshipInterpretation;
  }): Promise<ApplicantNarrative> {
    const userPrompt = buildNarrativeSynthesizerPrompt({
      applicantProfile: params.applicantProfile,
      pastAnswers: params.pastAnswers,
      dbSnippets: params.dbSnippets,
      interpretation: {
        intellectualCore: params.interpretation.intellectualCore,
        keyThemes: params.interpretation.keyThemes,
      },
    });

    const raw = await this.llm.generatePlain(
      NARRATIVE_SYNTHESIZER_SYSTEM,
      "Synthesize narrative assets:",
      userPrompt,
      { maxTokens: 3000 },
    );

    const json = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(json) as ApplicantNarrative;

    this.logger.log({
      message: "FELLOWSHIP_NARRATIVE_SYNTHESIZED",
      leadershipExamples: parsed.leadershipExamples?.length,
      numericFacts: parsed.numericFacts?.length,
      tensions: parsed.tensionsNavigated?.length,
    });

    return parsed;
  }
}
