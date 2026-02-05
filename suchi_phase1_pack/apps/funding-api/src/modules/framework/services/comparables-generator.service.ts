import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { CardRetrievalService } from "./card-retrieval.service";
import { COMPARABLES_PARAGRAPH_SYSTEM, COMPARABLES_PARAGRAPH_USER } from "../prompts/comparables-paragraph.prompt";
import type { ComparablesInputDto } from "../dto";
import type { ComparableCaseDto } from "../dto";

export interface ComparablesResult {
  cases: ComparableCaseDto[];
  paragraph: string;
  transferabilityNotes: string;
}

@Injectable()
export class ComparablesGeneratorService {
  private readonly logger = new Logger(ComparablesGeneratorService.name);

  constructor(
    private readonly llm: FundingLlmService,
    private readonly cardRetrievalService: CardRetrievalService,
  ) {}

  async generate(dto: ComparablesInputDto): Promise<ComparablesResult> {
    const retrieval = await this.cardRetrievalService.retrieve({
      capabilities: dto.capabilities,
      targetGroup: dto.targetGroup,
      cardTypes: ["comparable"],
      limit: 6,
    });
    const casesContext = retrieval.comparables
      .map(
        (c) =>
          `- ${c.programName} (${c.orgName}, ${c.geography}): ${c.outcomesSummary.slice(0, 200)}... Transferability: ${c.transferabilityBihar ?? "N/A"}`,
      )
      .join("\n");
    if (!casesContext) {
      return {
        cases: [],
        paragraph: "No comparable cases found for the selected capabilities and target group. Consider adding more comparable case cards to the library.",
        transferabilityNotes: "",
      };
    }
    const userPrompt = COMPARABLES_PARAGRAPH_USER(casesContext, dto.capabilities, dto.targetGroup);
    const paragraph = await this.llm.generatePlain(COMPARABLES_PARAGRAPH_SYSTEM, "", userPrompt);
    const transferabilityNotes = retrieval.comparables
      .map((c) => (c.transferabilityBihar ? `${c.programName}: ${c.transferabilityBihar}` : null))
      .filter(Boolean)
      .join("\n\n");
    return {
      cases: retrieval.comparables,
      paragraph: paragraph.trim(),
      transferabilityNotes,
    };
  }
}
