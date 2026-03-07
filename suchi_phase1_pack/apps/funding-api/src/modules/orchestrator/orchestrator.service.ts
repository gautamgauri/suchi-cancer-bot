import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  OrchestratorRunState,
  OrchestratorContext,
  EnhancedFitScoreResult,
  GmailMemoryResult,
  BudgetEnvelope,
} from "./orchestrator.types";
import { ORG_CAPACITY } from "./data/org-capacity";
import { EnhancedFitScoringService } from "./services/enhanced-fit-scoring.service";
import { GmailMemoryService } from "./services/gmail-memory.service";
import { BudgetEnvelopeService } from "./services/budget-envelope.service";
import { WebEvidenceService, type WebEvidenceResult } from "./services/web-evidence.service";
import { DeadlineCheckService } from "./services/deadline-check.service";
import { OpportunityService } from "../opportunity/opportunity.service";
import { ProposalService } from "../proposal/proposal.service";
import { FellowshipService } from "../fellowship/fellowship.service";
import type { OpportunityPayload, DocTypeCategory } from "../opportunity/opportunity.types";

/**
 * Orchestrator conductor — runs the "Gautam-style" gated pipeline:
 *
 *   Stage A: Enhanced Fit Scoring (6 dimensions, 0-100)
 *   Stage B: Gmail Memory Search (reusable proposal blocks)
 *   Stage C: Budget Envelope (template-based line items)
 *   Gate:    Decision → go / maybe / no
 *   Stage D: Web Evidence Search (Gemini grounding + CSE)
 *   Stage E: Proposal Generation (existing pipeline, enriched with context)
 *
 * Future stages (Slice 2):
 *   Stage F: MI/Capabilities Alignment
 *   Stage G: Traceability Metadata
 *   Stage H: Final Assembly
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly fitScoring: EnhancedFitScoringService,
    private readonly gmailMemory: GmailMemoryService,
    private readonly budgetEnvelope: BudgetEnvelopeService,
    private readonly webEvidence: WebEvidenceService,
    private readonly deadlineCheck: DeadlineCheckService,
    private readonly opportunityService: OpportunityService,
    private readonly proposalService: ProposalService,
    private readonly fellowshipService: FellowshipService,
  ) {}

  /**
   * Run the full orchestrator pipeline for an opportunity.
   *
   * @param opportunityId - the opportunity to process
   * @param options - override flags
   * @returns run state with all stage results
   */
  async run(
    opportunityId: string,
    options?: {
      skipGmail?: boolean;
      skipBudget?: boolean;
      skipWebEvidence?: boolean;
      forceGenerate?: boolean; // proceed even if fit = "no"
      proposalOptions?: {
        focusGeography?: string;
        targetGroup?: string;
        budgetCeiling?: string;
        dontMention?: string[];
        sectionOnly?: string;
        skipFramework?: boolean;
      };
    },
  ): Promise<OrchestratorRunState> {
    const runState: OrchestratorRunState = {
      opportunityId,
      stage: "deadline_check",
      startedAt: new Date().toISOString(),
    };

    try {
      // Load opportunity
      const opportunity = await this.opportunityService.findByOpportunityId(opportunityId);
      if (!opportunity) {
        throw new NotFoundException(`Opportunity ${opportunityId} not found`);
      }
      const payload: OpportunityPayload = opportunity.jsonBlob.opportunity;

      // --- Pre-flight: Size Mismatch Gate ---
      const durationMonths = payload.keyConstraints?.projectDurationMonthsMax ?? 12;
      const durationYears = durationMonths / 12;
      const orgCapacityINR = ORG_CAPACITY.maxAskINRPerYear * durationYears;

      const funderMinINR =
        payload.keyConstraints?.funderMinGrantINR ??
        (payload.keyConstraints?.funderMinGrantUSD
          ? Math.round(payload.keyConstraints.funderMinGrantUSD * ORG_CAPACITY.planningFxUSDtoINR)
          : undefined);

      if (funderMinINR !== undefined && funderMinINR > orgCapacityINR) {
        this.logger.warn(
          `[${opportunityId}] Size mismatch: funderMin ₹${(funderMinINR / 100000).toFixed(0)}L > orgCapacity ₹${(orgCapacityINR / 100000).toFixed(0)}L (ratio ${(funderMinINR / orgCapacityINR).toFixed(1)}×)`,
        );
        runState.stage = "size_mismatch";
        runState.sizeMismatch = {
          funderMinINR,
          orgCapacityINR,
          ratio: funderMinINR / orgCapacityINR,
          options: [
            `Option A: Do not pursue — funder minimum ₹${(funderMinINR / 100000).toFixed(0)}L exceeds Diksha ask ceiling ₹${(orgCapacityINR / 100000).toFixed(0)}L (${durationYears.toFixed(1)} yr)`,
            `Option B: Apply as consortium/implementation partner — Diksha budget share capped at ₹${(orgCapacityINR / 100000).toFixed(0)}L; lead applicant carries remainder`,
            `Option C: Scope expansion — add implementation partners, more geographies, or more programme features to justify the grant minimum`,
          ],
        };
        runState.completedAt = new Date().toISOString();
        return runState;
      }

      // --- Stage 0: Deadline Verification ---
      this.logger.log(`[${opportunityId}] Stage 0: Deadline Check`);
      const deadlineResult = await this.deadlineCheck.check(payload);
      runState.deadlineCheck = {
        storedDeadline: deadlineResult.storedDeadline,
        storedConfidence: deadlineResult.storedConfidence,
        webFoundDeadline: deadlineResult.webFoundDeadline,
        match: deadlineResult.match,
        warning: deadlineResult.warning,
      };

      if (deadlineResult.warning) {
        this.logger.warn(`[${opportunityId}] ${deadlineResult.warning}`);
      }

      // --- Stage A: Enhanced Fit Scoring ---
      this.logger.log(`[${opportunityId}] Stage A: Fit Scoring`);
      runState.stage = "fit_scoring";
      const fitScore = await this.fitScoring.score(payload);
      runState.fitScore = fitScore;

      // Gate check
      if (fitScore.decision === "no" && !options?.forceGenerate) {
        this.logger.warn(
          `[${opportunityId}] Fit score ${fitScore.totalScore}/100 → PARKED`,
        );
        runState.stage = "parked";
        runState.completedAt = new Date().toISOString();
        return runState;
      }

      // --- Stage B: Gmail Memory ---
      let gmailMemory: GmailMemoryResult = {
        blocksFound: 0,
        blocks: [],
        searchQueries: [],
        searched: false,
      };

      if (!options?.skipGmail) {
        this.logger.log(`[${opportunityId}] Stage B: Gmail Memory Search`);
        runState.stage = "gmail_memory";
        gmailMemory = await this.gmailMemory.search(payload);
        runState.gmailMemory = gmailMemory;
      }

      // --- Stage C: Budget Envelope ---
      let budgetEnvelope: BudgetEnvelope | undefined;

      if (!options?.skipBudget) {
        this.logger.log(`[${opportunityId}] Stage C: Budget Envelope`);
        runState.stage = "budget_envelope";
        budgetEnvelope = await this.budgetEnvelope.generate(payload);
        runState.budgetEnvelope = budgetEnvelope;
      }

      // --- Stage D: Web Evidence Search ---
      let webEvidenceResult: WebEvidenceResult | undefined;

      if (!options?.skipWebEvidence) {
        this.logger.log(`[${opportunityId}] Stage D: Web Evidence Search`);
        runState.stage = "web_evidence";
        webEvidenceResult = await this.webEvidence.gather(payload);
        runState.webEvidence = {
          funderIntel: webEvidenceResult.funderIntel.summary.slice(0, 500),
          comparablePrograms: webEvidenceResult.comparablePrograms.summary.slice(0, 500),
          themeEvidence: webEvidenceResult.themeEvidence.summary.slice(0, 500),
          sources: [
            ...webEvidenceResult.funderIntel.sources,
            ...webEvidenceResult.comparablePrograms.sources,
            ...webEvidenceResult.themeEvidence.sources,
          ].slice(0, 15),
          queriesUsed: webEvidenceResult.queriesUsed,
        };
      }

      // --- Build OrchestratorContext for proposal pipeline ---
      const orchestratorContext = this.buildContext(fitScore, gmailMemory, budgetEnvelope, webEvidenceResult, payload.docTypeCategory);

      // --- Stage E: Proposal Generation ---
      this.logger.log(`[${opportunityId}] Stage E: Proposal Generation (decision: ${fitScore.decision})`);
      runState.stage = "proposal_generation";

      // Use budget envelope ceiling as budget constraint if available
      const effectiveBudgetCeiling = options?.proposalOptions?.budgetCeiling
        ?? (budgetEnvelope
          ? `INR ${budgetEnvelope.targetCeilingINR.toLocaleString("en-IN")}`
          : undefined);

      // Route: fellowship pipeline for fellowship category, standard pipeline otherwise
      if (payload.docTypeCategory === "fellowship") {
        const fellowshipRun = await this.fellowshipService.generateFellowship(
          opportunityId,
        );
        runState.proposalRunId = fellowshipRun.id;
      } else {
        const proposalRun = await this.proposalService.generateProposal(
          opportunityId,
          {
            ...options?.proposalOptions,
            budgetCeiling: effectiveBudgetCeiling,
          },
          undefined, // approval context
          orchestratorContext,
        );
        runState.proposalRunId = proposalRun.id;
      }
      runState.stage = "complete";
      runState.completedAt = new Date().toISOString();

      this.logger.log(
        `[${opportunityId}] Orchestrator complete: fit=${fitScore.totalScore}/100 (${fitScore.decision}), ` +
          `gmail=${gmailMemory.blocksFound} blocks, ` +
          `budget=₹${budgetEnvelope ? (budgetEnvelope.grandTotal / 100000).toFixed(1) + "L" : "n/a"}, ` +
          `webEvidence=${webEvidenceResult?.queriesUsed ?? 0} queries, ` +
          `proposal=${runState.proposalRunId}`,
      );

      return runState;
    } catch (err) {
      runState.stage = "failed";
      runState.error = (err as Error).message;
      runState.completedAt = new Date().toISOString();
      this.logger.error(
        `[${opportunityId}] Orchestrator failed at stage ${runState.stage}: ${(err as Error).message}`,
      );
      return runState;
    }
  }

  /**
   * Run only the pre-drafting intelligence stages (fit + gmail + budget)
   * without triggering proposal generation. Useful for quick assessment.
   */
  async assess(opportunityId: string): Promise<{
    fitScore: EnhancedFitScoreResult;
    gmailMemory: GmailMemoryResult;
    budgetEnvelope: BudgetEnvelope;
    webEvidence: WebEvidenceResult;
  }> {
    const opportunity = await this.opportunityService.findByOpportunityId(opportunityId);
    if (!opportunity) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }
    const payload: OpportunityPayload = opportunity.jsonBlob.opportunity;

    const [fitScore, gmailMemory, budgetEnvelope, webEvidence] = await Promise.all([
      this.fitScoring.score(payload),
      this.gmailMemory.search(payload),
      this.budgetEnvelope.generate(payload),
      this.webEvidence.gather(payload),
    ]);

    return { fitScore, gmailMemory, budgetEnvelope, webEvidence };
  }

  private buildContext(
    fitScore: EnhancedFitScoreResult,
    gmailMemory: GmailMemoryResult,
    budgetEnvelope?: BudgetEnvelope,
    webEvidence?: WebEvidenceResult,
    docTypeCategory?: DocTypeCategory,
  ): OrchestratorContext {
    const context: OrchestratorContext = {};

    // Document type category (fellowship, tech_accelerator, etc.)
    if (docTypeCategory) {
      context.docTypeCategory = docTypeCategory;
    }

    // Fit score summary
    context.fitScore = {
      totalScore: fitScore.totalScore,
      decision: fitScore.decision,
      caveats: fitScore.caveats,
      dimensionSummary: Object.values(fitScore.dimensions)
        .map((d) => `${d.name}: ${d.score}/${d.maxScore} — ${d.rationale}`)
        .join("\n"),
    };

    // Gmail memory blocks (top 5 for context window size)
    if (gmailMemory.blocksFound > 0) {
      context.gmailMemoryBlocks = gmailMemory.blocks.slice(0, 5).map((b) => ({
        topic: b.topic,
        content: b.content,
        source: b.source,
      }));
    }

    // Budget envelope
    if (budgetEnvelope) {
      context.projectCategory = budgetEnvelope.projectCategory;
      context.budgetEnvelope = {
        lineItems: budgetEnvelope.lineItems.map((li) => ({
          category: li.category,
          item: li.item,
          unitCostINR: li.unitCostINR,
          unit: li.unit,
          quantity: li.quantity,
          months: li.months,
          amount: li.amount,
          notes: li.notes,
        })),
        targetCeilingINR: budgetEnvelope.targetCeilingINR,
        grandTotal: budgetEnvelope.grandTotal,
        subtotal: budgetEnvelope.subtotal,
        contingencyAmount: budgetEnvelope.contingencyAmount,
        grantPeriodMonths: budgetEnvelope.grantPeriodMonths,
        perChildCostPerYearINR: budgetEnvelope.perChildCostPerYearINR,
        programIntensity: budgetEnvelope.programIntensity,
        beneficiaryCount: budgetEnvelope.beneficiaryCount,
        projectCategory: budgetEnvelope.projectCategory,
      };
    }

    // Web evidence
    if (webEvidence) {
      context.webEvidence = {
        funderIntel: webEvidence.funderIntel.summary,
        comparablePrograms: webEvidence.comparablePrograms.summary,
        themeEvidence: webEvidence.themeEvidence.summary,
        sources: [
          ...webEvidence.funderIntel.sources,
          ...webEvidence.comparablePrograms.sources,
          ...webEvidence.themeEvidence.sources,
        ].slice(0, 15),
      };
    }

    return context;
  }
}
