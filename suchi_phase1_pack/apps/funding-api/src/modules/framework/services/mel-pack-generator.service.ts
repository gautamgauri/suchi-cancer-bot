import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { CapabilityService } from "./capability.service";
import { CardRetrievalService } from "./card-retrieval.service";
import { MEL_PACK_SYSTEM, MEL_PACK_USER } from "../prompts/mel-pack.prompt";
import type { MelPackInputDto } from "../dto";

export interface MelPackIndicator {
  type: "quantitative" | "qualitative";
  indicator: string;
  frequency: string;
  disaggregation: string[];
  tool: string;
  risks: string[];
}

export interface MelPackCapabilityBlock {
  capability: string;
  capabilityName: string;
  mechanism: string;
  expectedFunctionings: string[];
  indicators: MelPackIndicator[];
}

export interface MelPackResult {
  capabilityIndicators: MelPackCapabilityBlock[];
  gaps: string[];
}

@Injectable()
export class MelPackGeneratorService {
  private readonly logger = new Logger(MelPackGeneratorService.name);

  constructor(
    private readonly llm: FundingLlmService,
    private readonly capabilityService: CapabilityService,
    private readonly cardRetrievalService: CardRetrievalService,
  ) {}

  async generate(dto: MelPackInputDto, context?: string): Promise<MelPackResult> {
    const capabilities = await this.capabilityService.list();
    const capNames = capabilities
      .filter((c) => dto.capabilities.includes(c.capabilityId))
      .map((c) => `${c.capabilityId} (${c.name})`)
      .join("; ");
    const retrieval = await this.cardRetrievalService.retrieve({
      capabilities: dto.capabilities,
      cardTypes: ["method", "comparable"],
      limit: 5,
    });
    const contextParts: string[] = [];
    if (retrieval.methods.length)
      contextParts.push("Relevant method cards: " + retrieval.methods.map((m) => m.title).join(", "));
    if (retrieval.comparables.length)
      contextParts.push("Relevant comparables: " + retrieval.comparables.map((c) => c.programName).join(", "));
    const fullContext = [context, ...contextParts].filter(Boolean).join("\n");

    const userPrompt = MEL_PACK_USER(
      dto.capabilities,
      dto.targetGroup,
      dto.geography ?? "Bihar",
      fullContext,
    );
    const raw = await this.llm.generatePlain(MEL_PACK_SYSTEM, "", userPrompt);
    const parsed = this.parseMelPackJson(raw);
    return parsed ?? { capabilityIndicators: [], gaps: ["Could not parse MEL pack from model response."] };
  }

  private parseMelPackJson(raw: string): MelPackResult | null {
    const trimmed = raw.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}") + 1;
    if (start < 0 || end <= start) return null;
    try {
      const json = JSON.parse(trimmed.slice(start, end)) as {
        capabilityIndicators?: unknown[];
        gaps?: string[];
      };
      const capabilityIndicators: MelPackCapabilityBlock[] = Array.isArray(json.capabilityIndicators)
        ? json.capabilityIndicators.map((block: unknown) => {
            const b = block as Record<string, unknown>;
            return {
              capability: String(b.capability ?? ""),
              capabilityName: String(b.capabilityName ?? ""),
              mechanism: String(b.mechanism ?? ""),
              expectedFunctionings: Array.isArray(b.expectedFunctionings) ? b.expectedFunctionings.map(String) : [],
              indicators: Array.isArray(b.indicators)
                ? (b.indicators as Array<Record<string, unknown>>).map((i) => ({
                    type: (i.type === "qualitative" ? "qualitative" : "quantitative") as "quantitative" | "qualitative",
                    indicator: String(i.indicator ?? ""),
                    frequency: String(i.frequency ?? ""),
                    disaggregation: Array.isArray(i.disaggregation) ? i.disaggregation.map(String) : [],
                    tool: String(i.tool ?? ""),
                    risks: Array.isArray(i.risks) ? i.risks.map(String) : [],
                  }))
                : [],
            };
          })
        : [];
      const gaps = Array.isArray(json.gaps) ? json.gaps.map(String) : [];
      return { capabilityIndicators, gaps };
    } catch {
      return null;
    }
  }
}
