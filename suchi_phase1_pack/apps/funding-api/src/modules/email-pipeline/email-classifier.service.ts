import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../core_ai/funding-llm.service";

export type EmailIntent =
  | "fellowship_lead"
  | "proposal_lead"
  | "draft_request"
  | "unknown";

export interface ClassificationResult {
  intent: EmailIntent;
  confidence: number;
  fellowshipUrl?: string;
  opportunityUrl?: string;
  instructions?: string;
}

const CLASSIFY_SYSTEM = `You classify incoming emails for a funding/fellowship bot.
Respond with ONLY valid JSON — no markdown, no explanation.

Output schema:
{
  "intent": "fellowship_lead" | "proposal_lead" | "draft_request" | "unknown",
  "confidence": 0.0-1.0,
  "fellowshipUrl": "<URL if fellowship application link found>",
  "opportunityUrl": "<URL if RFP/grant opportunity link found>",
  "instructions": "<any specific drafting instructions from sender>"
}

Rules:
- "fellowship_lead": email contains a fellowship/scholarship application URL or forwards a fellowship call
- "proposal_lead": email contains an RFP, grant opportunity, or funding call (not fellowship/scholarship)
- "draft_request": email explicitly asks to draft/write/prepare a proposal or application
- "unknown": none of the above — general correspondence, spam, etc.`;

@Injectable()
export class EmailClassifierService {
  private readonly logger = new Logger(EmailClassifierService.name);

  constructor(private readonly llm: FundingLlmService) {}

  async classify(params: {
    subject: string;
    bodyPlain?: string;
    from: string;
    snippet?: string;
  }): Promise<ClassificationResult> {
    const emailContent = [
      `From: ${params.from}`,
      `Subject: ${params.subject}`,
      "",
      params.bodyPlain?.substring(0, 3000) || params.snippet || "(empty body)",
    ].join("\n");

    try {
      const raw = await this.llm.generatePlain(
        CLASSIFY_SYSTEM,
        "Classify this email:",
        emailContent,
        { maxTokens: 500 },
      );

      const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);

      return {
        intent: parsed.intent || "unknown",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        fellowshipUrl: parsed.fellowshipUrl || undefined,
        opportunityUrl: parsed.opportunityUrl || undefined,
        instructions: parsed.instructions || undefined,
      };
    } catch (err) {
      this.logger.warn(`Classification failed: ${(err as Error).message}`);
      return { intent: "unknown", confidence: 0 };
    }
  }
}
