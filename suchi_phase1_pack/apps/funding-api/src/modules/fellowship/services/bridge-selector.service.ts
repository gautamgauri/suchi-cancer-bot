import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import type { FellowshipBridge, FellowshipInterpretation } from "../fellowship-pipeline.types";
import {
  BRIDGE_SELECTOR_SYSTEM,
  buildBridgeSelectorPrompt,
} from "../prompts/bridge-selector.prompt";

@Injectable()
export class BridgeSelectorService {
  private readonly logger = new Logger(BridgeSelectorService.name);

  constructor(private readonly llm: FundingLlmService) {}

  async selectBridge(params: {
    interpretation: FellowshipInterpretation;
    applicantProfile: string;
    pastAnswers: string;
    sectionNames: string[];
  }): Promise<FellowshipBridge> {
    const userPrompt = buildBridgeSelectorPrompt(params);

    const raw = await this.llm.generatePlain(
      BRIDGE_SELECTOR_SYSTEM,
      "Find the strongest bridge:",
      userPrompt,
      { maxTokens: 2000 },
    );

    const json = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(json) as FellowshipBridge;

    this.logger.log({
      message: "FELLOWSHIP_BRIDGE_SELECTED",
      thesis: parsed.thesis?.substring(0, 120),
      bridgeType: parsed.bridgeType,
      anchorCount: Object.keys(parsed.sectionAnchors ?? {}).length,
    });

    return parsed;
  }
}
