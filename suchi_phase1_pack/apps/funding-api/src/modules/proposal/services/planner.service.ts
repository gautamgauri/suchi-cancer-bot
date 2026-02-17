import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserPrompt } from "../prompts/planner.prompt";
import { ProposalOutline, ProposalScope, ProposalScopeCenter, ProposalScopeDeliverable, ProposalScopeMissingInput } from "../proposal.types";

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
    /** Funder program themes from RFP */
    funderThemes?: { primary?: string[]; secondary?: string[] };
    /** Structured activities context from ProgramActivity registry */
    activitiesContext?: string;
    /** Pre-computed framework intelligence context */
    frameworkContext?: string;
  }): Promise<ProposalOutline> {
    // === DIAGNOSTIC: Step B — log what planner receives ===
    this.logger.log({
      diagnostic: "STEP_B_PLANNER_INPUT",
      mandatorySectionsCount: params.mandatorySections?.length ?? 0,
      mandatorySectionTitles: params.mandatorySections?.map((s) => s.title) ?? [],
      rfpTextLength: params.rfpText?.length ?? 0,
      funderThemesPrimary: params.funderThemes?.primary ?? [],
      hasActivitiesContext: !!params.activitiesContext,
    });

    const userPrompt = buildPlannerUserPrompt(params);
    try {
      // Planner needs more tokens for large section counts (11 sections + retrieval plan + compliance ≈ 4000 tokens)
      const raw = await this.llm.generatePlain(PLANNER_SYSTEM_PROMPT, "Generate proposal outline:", userPrompt, { maxTokens: 8000 });
      // Log raw output for debugging (first 2000 chars)
      this.logger.log({
        diagnostic: "PLANNER_RAW_OUTPUT",
        length: raw.length,
        first2000: raw.substring(0, 2000),
      });
      // Extract JSON: handle ```json blocks, trailing truncation, and whitespace
      let jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      // If JSON is truncated (common with long outputs), try to repair by closing open structures
      if (!jsonStr.endsWith("}")) {
        this.logger.warn(`Planner JSON appears truncated (ends with: "${jsonStr.slice(-40)}"), attempting repair`);
        // Strategy: find the last complete JSON value boundary (after a '}', ']', '"', number, true/false/null)
        // Then close all open structures.
        // First, strip any trailing incomplete string (truncated mid-value)
        let repaired = jsonStr;
        // Remove trailing partial string value (e.g., `"some truncated te`)
        repaired = repaired.replace(/,\s*"[^"]*$/s, "");
        // Remove trailing partial key-value pair (e.g., `"key": "some`)
        repaired = repaired.replace(/,\s*"[^"]*":\s*"[^"]*$/s, "");
        // Remove trailing partial key (e.g., `"key":`)
        repaired = repaired.replace(/,\s*"[^"]*":\s*$/s, "");
        // Find the last '}' or ']' as anchor
        const lastClose = Math.max(repaired.lastIndexOf("}"), repaired.lastIndexOf("]"));
        if (lastClose > 0) {
          repaired = repaired.substring(0, lastClose + 1);
        }
        // Count unclosed braces/brackets and close them
        let braces = 0, brackets = 0;
        let inString = false;
        let escaped = false;
        for (const ch of repaired) {
          if (escaped) { escaped = false; continue; }
          if (ch === "\\") { escaped = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === "{") braces++;
          if (ch === "}") braces--;
          if (ch === "[") brackets++;
          if (ch === "]") brackets--;
        }
        jsonStr = repaired + "]".repeat(Math.max(0, brackets)) + "}".repeat(Math.max(0, braces));
        this.logger.log(`JSON repair: original ${raw.length} chars → repaired ${jsonStr.length} chars (braces=${braces}, brackets=${brackets})`);
      }
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

      // Accept "outline", "sections", or "proposal_sections" as the sections array key (LLMs use different names)
      const rawSections = (
        Array.isArray(parsed.outline) ? parsed.outline
        : Array.isArray(parsed.sections) ? parsed.sections
        : Array.isArray(parsed.proposal_sections) ? parsed.proposal_sections
        : []
      ) as Array<Record<string, unknown>>;
      const rawScope = (parsed.proposal_scope || parsed.scope) as Record<string, unknown> | undefined;

      // Validate and normalize
      const outline: ProposalOutline = {
        outline: rawSections.map((s) => ({
              section: String(s.section || s.section_title || s.title || s.name || ""),
              target_words: typeof s.target_words === "number" ? s.target_words : 0,
              must_answer: Array.isArray(s.must_answer) ? s.must_answer : Array.isArray(s.content_outline) ? s.content_outline as string[] : Array.isArray(s.section_outline) ? s.section_outline as string[] : [],
              capability_focus: Array.isArray(s.capability_focus)
                ? s.capability_focus as string[]
                : Array.isArray(s.capability_alignment) ? s.capability_alignment as string[]
                : undefined,
            })),
        retrieval_plan: Array.isArray(parsed.retrieval_plan)
          ? (parsed.retrieval_plan as Array<Record<string, unknown>>).map((r) => ({
                section: String(r.section || r.section_title || r.title || ""),
                query_intents: Array.isArray(r.query_intents) ? r.query_intents as string[] : [],
                required_evidence_types: Array.isArray(r.required_evidence_types) ? r.required_evidence_types as string[] : [],
                capability_focus: Array.isArray(r.capability_focus) ? r.capability_focus as string[] : undefined,
              }))
          : [],
        compliance_checklist: Array.isArray(parsed.compliance_checklist)
          ? (parsed.compliance_checklist as Array<Record<string, unknown>>).map((c) => ({
              item: String(c.item || ""),
              source: String(c.source || "RFP"),
              status: String(c.status || "pending"),
            }))
          : [],
        // Extract proposal_scope from planner output (accept alternate field names)
        proposal_scope: rawScope ? this.parseProposalScope(rawScope, parsed) : undefined,
        suggested_primary_capabilities: Array.isArray(parsed.suggested_primary_capabilities)
          ? parsed.suggested_primary_capabilities as string[]
          : undefined,
        suggested_secondary_capabilities: Array.isArray(parsed.suggested_secondary_capabilities)
          ? parsed.suggested_secondary_capabilities as string[]
          : undefined,
      };

      // Validate scope quality with detailed diagnostics
      if (outline.proposal_scope) {
        const validation = this.validateScope(outline.proposal_scope, !!params.activitiesContext);
        if (!validation.valid) {
          this.logger.warn({
            diagnostic: "PLANNER_SCOPE_VALIDATION_FAILED",
            failures: validation.failures,
            scope: outline.proposal_scope,
          });
          // Don't discard — patch missing_inputs instead so downstream knows what's wrong
          outline.proposal_scope.missing_inputs = [
            ...(outline.proposal_scope.missing_inputs || []),
            ...validation.failures.map(f => ({ field: f.field, reason: f.reason, severity: f.severity as "low" | "medium" | "high" })),
          ];
        }
      }

      // Log planner output quality
      this.logger.log({
        diagnostic: "PLANNER_OUTPUT",
        parsedSections: outline.outline.length,
        sectionTitles: outline.outline.map((s) => s.section),
        retrievalPlanItems: outline.retrieval_plan.length,
        complianceItems: outline.compliance_checklist.length,
        hasProposalScope: !!outline.proposal_scope,
        scopeCenters: outline.proposal_scope?.centers?.length ?? 0,
        scopeBudgetCeiling: outline.proposal_scope?.budgetCeiling ?? "not set",
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

  /** Parse proposal_scope from planner JSON, handling both old and new schema formats. */
  private parseProposalScope(ps: Record<string, unknown>, parsed: Record<string, unknown>): ProposalScope {
    const str = (v: unknown) => (v != null && v !== "") ? String(v) : "";
    const arr = (v: unknown) => Array.isArray(v) ? v.map(String) : [];

    // Parse centers — accept array of strings OR array of objects
    const rawCenters = ps.centers || ps.sites || ps.locations || ps.hubs;
    let centers: ProposalScopeCenter[] = [];
    if (Array.isArray(rawCenters)) {
      centers = rawCenters.map((c: unknown) => {
        if (typeof c === "string") return { name: c };
        if (typeof c === "object" && c !== null) {
          const obj = c as Record<string, unknown>;
          return {
            name: str(obj.name || obj.center || obj.site),
            location: str(obj.location || obj.district) || null,
            targetGroup: str(obj.targetGroup || obj.target_group) || null,
          };
        }
        return { name: String(c) };
      });
    }

    // Parse deliverables — accept array of strings OR array of objects
    const rawDeliverables = ps.deliverables || ps.keyDeliverables || ps.key_deliverables;
    let deliverables: ProposalScopeDeliverable[] = [];
    if (Array.isArray(rawDeliverables)) {
      deliverables = rawDeliverables.map((d: unknown) => {
        if (typeof d === "string") return { name: d };
        if (typeof d === "object" && d !== null) {
          const obj = d as Record<string, unknown>;
          return {
            name: str(obj.name || obj.activity || obj.deliverable),
            quantity: typeof obj.quantity === "number" ? obj.quantity : null,
            unit: str(obj.unit) || null,
            frequency: str(obj.frequency) || null,
          };
        }
        return { name: String(d) };
      });
    }

    // Parse grant period — accept string or {start, end} object or projectDurationMonths
    const rawGrant = ps.grantPeriod || ps.grant_period || ps.duration_months || ps.duration || ps.projectDurationMonths || ps.project_duration_months;
    let grantPeriod: string | { start?: string | null; end?: string | null } = "";
    if (typeof rawGrant === "object" && rawGrant !== null) {
      const g = rawGrant as Record<string, unknown>;
      grantPeriod = { start: str(g.start) || null, end: str(g.end) || null };
    } else if (typeof rawGrant === "number") {
      grantPeriod = `${rawGrant} months`;
    } else {
      grantPeriod = str(rawGrant);
    }

    // Parse staffing
    const rawStaffing = ps.staffing as Record<string, unknown> | undefined;
    const staffing = rawStaffing ? {
      totalStaff: typeof rawStaffing.totalStaff === "number" ? rawStaffing.totalStaff
        : typeof rawStaffing.total_staff === "number" ? rawStaffing.total_staff : null,
      keyRoles: arr(rawStaffing.keyRoles || rawStaffing.key_roles),
    } : undefined;

    // Parse missing_inputs
    const rawMissing = ps.missing_inputs as Array<Record<string, unknown>> | undefined;
    const missingInputs: ProposalScopeMissingInput[] = Array.isArray(rawMissing)
      ? rawMissing.map(m => ({
          field: str(m.field),
          reason: str(m.reason),
          severity: (["low", "medium", "high"].includes(str(m.severity)) ? str(m.severity) : "medium") as "low" | "medium" | "high",
        }))
      : [];

    return {
      programName: str(ps.programName || ps.title || ps.program_name || parsed.proposal_title),
      centers,
      totalDirectBeneficiaries: str(ps.totalDirectBeneficiaries || ps.primary_beneficiaries || ps.direct_beneficiaries || ps.total_beneficiaries || ps.targetBeneficiaries || ps.target_beneficiaries || ps.beneficiaries),
      totalIndirectBeneficiaries: str(ps.totalIndirectBeneficiaries || ps.indirect_beneficiaries) || undefined,
      geographicScope: str(ps.geographicScope || ps.geographicFocus || ps.geographic_focus || ps.geography || ps.location || ps.geographic_scope),
      grantPeriod,
      budgetCeiling: str(ps.budgetCeiling || ps.budget_ceiling || ps.budget),
      deliverables,
      staffing,
      assumptions: arr(ps.assumptions),
      constraints: arr(ps.constraints),
      missing_inputs: missingInputs.length > 0 ? missingInputs : undefined,
      // Back-compat
      keyDeliverables: deliverables.map(d => d.name),
    };
  }

  /** Validate scope has minimum viable content. Returns failures list. */
  private validateScope(scope: ProposalScope, hasRegistryContext: boolean): {
    valid: boolean;
    failures: Array<{ field: string; reason: string; severity: string }>;
  } {
    const failures: Array<{ field: string; reason: string; severity: string }> = [];

    if (!scope.programName) {
      failures.push({ field: "programName", reason: "Program name is empty", severity: "high" });
    }
    if (scope.centers.length === 0 && hasRegistryContext) {
      failures.push({ field: "centers", reason: "No centers listed despite activity registry containing center data", severity: "high" });
    }
    if (!scope.totalDirectBeneficiaries && hasRegistryContext) {
      failures.push({ field: "totalDirectBeneficiaries", reason: "No beneficiary count despite registry context", severity: "high" });
    }
    if (scope.deliverables.length === 0 && hasRegistryContext) {
      failures.push({ field: "deliverables", reason: "No deliverables listed despite activity registry containing activities with frequencies", severity: "high" });
    }
    if (!scope.geographicScope) {
      failures.push({ field: "geographicScope", reason: "Geographic scope is empty", severity: "medium" });
    }

    return { valid: failures.length === 0, failures };
  }
}
