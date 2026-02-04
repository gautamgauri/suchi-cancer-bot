import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { QA_REVIEWER_SYSTEM_PROMPT, buildQaReviewerUserPrompt } from "../prompts/qa-reviewer.prompt";
import { QaReviewResult } from "../proposal.types";

@Injectable()
export class QaReviewerService {
  private readonly logger = new Logger(QaReviewerService.name);

  constructor(private readonly llm: FundingLlmService) {}

  /**
   * Run QA review: coverage, hallucination detection, consistency checks.
   */
  async reviewProposal(params: {
    requirementsJson: string;
    draftText: string;
    citationMap: string;
  }): Promise<QaReviewResult> {
    const userPrompt = buildQaReviewerUserPrompt(params);
    try {
      const raw = await this.llm.generatePlain(QA_REVIEWER_SYSTEM_PROMPT, "Review the proposal:", userPrompt);
      const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      const parsed = JSON.parse(jsonStr) as Partial<QaReviewResult>;

      return {
        coverage_score: typeof parsed.coverage_score === "number" ? parsed.coverage_score : 0,
        missing_requirements: Array.isArray(parsed.missing_requirements) ? parsed.missing_requirements : [],
        ungrounded_claims: Array.isArray(parsed.ungrounded_claims) ? parsed.ungrounded_claims : [],
        inconsistencies: Array.isArray(parsed.inconsistencies) ? parsed.inconsistencies : [],
        revision_plan: Array.isArray(parsed.revision_plan) ? parsed.revision_plan : [],
      };
    } catch (e) {
      this.logger.warn("Failed to parse QA review JSON", (e as Error).message);
      return {
        coverage_score: 0,
        missing_requirements: ["QA review parsing failed"],
        ungrounded_claims: [],
        inconsistencies: [],
        revision_plan: [],
      };
    }
  }

  /**
   * Extract gaps from QA review and section gaps.
   */
  extractGaps(qaResult: QaReviewResult, sectionGaps: Array<{ section: string; gaps: string[] }>): Array<{
    field?: string;
    section?: string;
    question: string;
    priority?: "high" | "medium" | "low";
  }> {
    const gaps: Array<{ field?: string; section?: string; question: string; priority?: "high" | "medium" | "low" }> = [];

    // From QA missing requirements
    qaResult.missing_requirements.forEach((req) => {
      gaps.push({ question: req, priority: "high" });
    });

    // From QA ungrounded claims
    qaResult.ungrounded_claims.forEach((claim) => {
      gaps.push({
        section: claim.location,
        question: `Ungrounded claim: ${claim.text}. ${claim.suggestion}`,
        priority: "high",
      });
    });

    // From section gaps
    sectionGaps.forEach((sg) => {
      sg.gaps.forEach((g) => {
        gaps.push({ section: sg.section, question: g, priority: "medium" });
      });
    });

    return gaps;
  }
}
