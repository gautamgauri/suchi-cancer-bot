import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { RfpSectionRequirement, OpportunityExtractedRequirements } from "../../opportunity/opportunity.types";

@Injectable()
export class RfpParserService {
  private readonly logger = new Logger(RfpParserService.name);

  constructor(private readonly llm: FundingLlmService) {}

  /**
   * Extends existing constraint extraction to also extract section requirements,
   * evaluation criteria, and mandatory annexures.
   */
  async extractStructuredRequirements(rfpText: string, emailSubject?: string): Promise<Partial<OpportunityExtractedRequirements>> {
    if (!rfpText || rfpText.length < 100) {
      return {};
    }

    const truncated = rfpText.slice(0, 30000);
    const systemPrompt = `You are an expert at extracting structured requirements from grant RFP documents.
Extract section requirements (name, word limits, must-answer questions), evaluation criteria, and mandatory annexures.
Return valid JSON only, no markdown or explanation.

Output JSON with these keys (use null or empty array for missing):
- sections: array of { name: string, target_words?: number, must_answer?: string[] }
- evaluationCriteria: array of strings (scoring/evaluation criteria mentioned)
- mandatoryAnnexures: array of strings (required attachments/documents)

Example:
{
  "sections": [
    { "name": "Executive Summary", "target_words": 250, "must_answer": ["program overview", "key outcomes"] },
    { "name": "Need Statement", "target_words": 400 }
  ],
  "evaluationCriteria": ["alignment with funder priorities", "feasibility", "sustainability"],
  "mandatoryAnnexures": ["budget", "M&E framework", "organizational chart"]
}`;

    const userMessage = emailSubject
      ? `Email subject: ${emailSubject}\n\nRFP text:\n${truncated}`
      : truncated;

    try {
      const raw = await this.llm.generatePlain(systemPrompt, "RFP document excerpt:", userMessage);
      const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      const parsed = JSON.parse(jsonStr) as {
        sections?: Array<{ name: string; target_words?: number; must_answer?: string[] }>;
        evaluationCriteria?: string[];
        mandatoryAnnexures?: string[];
      };

      const result: Partial<OpportunityExtractedRequirements> = {};
      if (Array.isArray(parsed.sections)) {
        result.sections = parsed.sections.map((s) => ({
          name: s.name,
          targetWords: s.target_words,
          mustAnswer: s.must_answer,
        })) as RfpSectionRequirement[];
      }
      if (Array.isArray(parsed.evaluationCriteria)) {
        result.evaluationCriteria = parsed.evaluationCriteria;
      }
      if (Array.isArray(parsed.mandatoryAnnexures)) {
        result.mandatoryAnnexures = parsed.mandatoryAnnexures;
      }
      return result;
    } catch (e) {
      this.logger.warn("Failed to parse LLM structured requirements JSON", (e as Error).message);
      return {};
    }
  }
}
