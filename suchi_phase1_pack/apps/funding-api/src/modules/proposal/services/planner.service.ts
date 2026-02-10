import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserPrompt } from "../prompts/planner.prompt";
import { ProposalOutline, RetrievalPlanItem } from "../proposal.types";

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(private readonly llm: FundingLlmService) {}

  /**
   * Generate proposal outline and retrieval plan from RFP.
   * When capabilityContext is provided, outline and retrieval_plan are aligned to those capabilities.
   */
  async generateOutline(params: {
    rfpText: string;
    orgProfileSummary: string;
    userOverrides: string;
    capabilityContext?: { primary: string[]; secondary?: string[] };
    /** Mandatory sections from the opportunity's extractedRequirements */
    mandatorySections?: Array<{ title: string; description?: string }>;
    /** Funder name for context */
    funderName?: string;
  }): Promise<ProposalOutline> {
    // === DIAGNOSTIC: Step B — log what planner receives ===
    this.logger.log({
      diagnostic: "STEP_B_PLANNER_INPUT",
      mandatorySectionsCount: params.mandatorySections?.length ?? 0,
      mandatorySectionTitles: params.mandatorySections?.map((s) => s.title) ?? [],
      rfpTextLength: params.rfpText?.length ?? 0,
    });

    const userPrompt = buildPlannerUserPrompt(params);
    try {
      // Planner needs more tokens for large section counts (11 sections + retrieval plan + compliance ≈ 4000 tokens)
      const raw = await this.llm.generatePlain(PLANNER_SYSTEM_PROMPT, "Generate proposal outline:", userPrompt, { maxTokens: 4000 });
      // Extract JSON: handle ```json blocks, trailing truncation, and whitespace
      let jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      // If JSON is truncated (common with long outputs), try to repair by closing open structures
      if (!jsonStr.endsWith("}")) {
        this.logger.warn(`Planner JSON appears truncated (ends with: "${jsonStr.slice(-20)}"), attempting repair`);
        // Find the last valid JSON object boundary
        const lastBrace = jsonStr.lastIndexOf("}");
        if (lastBrace > 0) {
          // Count unclosed braces/brackets and close them
          let braces = 0, brackets = 0;
          const truncated = jsonStr.substring(0, lastBrace + 1);
          for (const ch of truncated) {
            if (ch === "{") braces++;
            if (ch === "}") braces--;
            if (ch === "[") brackets++;
            if (ch === "]") brackets--;
          }
          jsonStr = truncated + "]".repeat(Math.max(0, brackets)) + "}".repeat(Math.max(0, braces));
        }
      }
      const parsed = JSON.parse(jsonStr) as Partial<ProposalOutline>;

      // Validate and normalize
      const outline: ProposalOutline = {
        outline: Array.isArray(parsed.outline)
          ? parsed.outline.map((s) => ({
              section: s.section || "",
              target_words: typeof s.target_words === "number" ? s.target_words : 0,
              must_answer: Array.isArray(s.must_answer) ? s.must_answer : [],
              capability_focus: Array.isArray((s as { capability_focus?: string[] }).capability_focus)
                ? (s as { capability_focus?: string[] }).capability_focus
                : undefined,
            }))
          : [],
        retrieval_plan: Array.isArray(parsed.retrieval_plan)
          ? parsed.retrieval_plan.map((r) => {
              const item = r as RetrievalPlanItem & { capability_focus?: string[] };
              return {
                section: item.section || "",
                query_intents: Array.isArray(item.query_intents) ? item.query_intents : [],
                required_evidence_types: Array.isArray(item.required_evidence_types) ? item.required_evidence_types : [],
                capability_focus: Array.isArray(item.capability_focus) ? item.capability_focus : undefined,
              };
            })
          : [],
        compliance_checklist: Array.isArray(parsed.compliance_checklist)
          ? parsed.compliance_checklist.map((c) => ({
              item: c.item || "",
              source: c.source || "RFP",
              status: c.status || "pending",
            }))
          : [],
        suggested_primary_capabilities: Array.isArray(parsed.suggested_primary_capabilities)
          ? parsed.suggested_primary_capabilities
          : undefined,
        suggested_secondary_capabilities: Array.isArray(parsed.suggested_secondary_capabilities)
          ? parsed.suggested_secondary_capabilities
          : undefined,
      };

      // Log planner output quality
      this.logger.log({
        diagnostic: "PLANNER_OUTPUT",
        parsedSections: outline.outline.length,
        sectionTitles: outline.outline.map((s) => s.section),
        retrievalPlanItems: outline.retrieval_plan.length,
        complianceItems: outline.compliance_checklist.length,
      });

      return outline;
    } catch (e) {
      this.logger.warn("Failed to parse planner JSON, using fallback outline", (e as Error).message);
      // Fallback: use mandatory sections from opportunity if available, otherwise generic
      if (params.mandatorySections?.length) {
        this.logger.log(`Using ${params.mandatorySections.length} mandatory sections from opportunity as fallback`);
        return {
          outline: params.mandatorySections.map((s) => ({
            section: s.title,
            target_words: 400,
            must_answer: s.description ? [s.description] : [],
          })),
          retrieval_plan: params.mandatorySections.map((s) => ({
            section: s.title,
            query_intents: [s.title, s.description || ""].filter(Boolean),
            required_evidence_types: ["org_data", "program_report"],
          })),
          compliance_checklist: params.mandatorySections.map((s) => ({
            item: `Include "${s.title}" section`,
            source: "RFP",
            status: "pending",
          })),
        };
      }
      return {
        outline: [
          { section: "Executive Summary", target_words: 250, must_answer: [] },
          { section: "Need Statement", target_words: 400, must_answer: [] },
          { section: "Project Design", target_words: 600, must_answer: [] },
          { section: "Implementation Plan", target_words: 500, must_answer: [] },
          { section: "M&E Framework", target_words: 400, must_answer: [] },
          { section: "Budget Narrative", target_words: 300, must_answer: [] },
        ],
        retrieval_plan: [],
        compliance_checklist: [],
      };
    }
  }
}
