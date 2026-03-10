import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import type { FellowshipInterpretation } from "../fellowship-pipeline.types";
import {
  OPPORTUNITY_INTERPRETER_SYSTEM,
  buildOpportunityInterpreterPrompt,
} from "../prompts/opportunity-interpreter.prompt";

@Injectable()
export class OpportunityInterpreterService {
  private readonly logger = new Logger(OpportunityInterpreterService.name);

  constructor(private readonly llm: FundingLlmService) {}

  async interpret(params: {
    fellowshipName: string;
    summary: string;
    sections: Array<{ name: string; guidance: string }>;
    themes?: string[];
    evaluationCriteria?: string[];
  }): Promise<FellowshipInterpretation> {
    const userPrompt = buildOpportunityInterpreterPrompt(params);

    const raw = await this.llm.generatePlain(
      OPPORTUNITY_INTERPRETER_SYSTEM,
      "Interpret this fellowship:",
      userPrompt,
      { maxTokens: 2000 },
    );

    const json = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(json) as FellowshipInterpretation;

    this.logger.log({
      message: "FELLOWSHIP_INTERPRETATION_COMPLETE",
      intellectualCore: parsed.intellectualCore?.substring(0, 100),
      themeCount: parsed.keyThemes?.length,
    });

    return parsed;
  }
}
