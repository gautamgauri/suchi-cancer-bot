import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { QUERY_GENERATOR_SYSTEM_PROMPT, buildQueryGeneratorUserPrompt } from "../prompts/query-generator.prompt";

@Injectable()
export class QueryGeneratorService {
  private readonly logger = new Logger(QueryGeneratorService.name);

  constructor(private readonly llm: FundingLlmService) {}

  /**
   * Generate 5-10 retrieval queries for a section based on must-answer list and evidence types.
   */
  async generateQueries(params: {
    sectionName: string;
    mustAnswer: string[];
    evidenceTypes: string[];
  }): Promise<string[]> {
    const userPrompt = buildQueryGeneratorUserPrompt(params);
    try {
      const raw = await this.llm.generatePlain(
        QUERY_GENERATOR_SYSTEM_PROMPT,
        "Generate retrieval queries:",
        userPrompt,
      );
      const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return parsed.filter((q) => typeof q === "string" && q.length > 0);
      }
      return [];
    } catch (e) {
      this.logger.warn("Failed to parse query generator JSON", (e as Error).message);
      // Fallback: generate simple queries from section name and must-answer
      const fallback: string[] = [params.sectionName];
      params.mustAnswer.forEach((q) => {
        if (q.length > 5) fallback.push(q);
      });
      return fallback.slice(0, 5);
    }
  }
}
