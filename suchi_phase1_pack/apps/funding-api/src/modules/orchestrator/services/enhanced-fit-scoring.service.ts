import { Injectable, Logger } from "@nestjs/common";
import type { EnhancedFitScoreResult, FitScoreDimension } from "../orchestrator.types";
import { DIKSHA_STRATEGIC_PLAN } from "../data/strategic-plan";
import { ORG_CAPACITY } from "../data/org-capacity";
import { ActivityRegistryService } from "../../activity_registry/activity-registry.service";
import { RetrievalService } from "../../evidence_ingest/retrieval.service";
import type { OpportunityPayload } from "../../opportunity/opportunity.types";

/**
 * 6-dimension fit scoring rubric (0-100):
 *   Program Alignment  (0-25)  — do our programs match the opportunity themes?
 *   Strategic Plan Fit  (0-20)  — does it align with 3-year strategic priorities?
 *   Strategic Gap Bonus (0-10)  — does it unlock an unfunded priority?
 *   Evidence Strength   (0-15)  — do we have KB evidence for the themes?
 *   Bihar Feasibility   (0-15)  — is the geography compatible?
 *   Budget Fit          (0-15)  — is the grant size in our sweet spot (Rs 30-50L)?
 *
 * Decision rule:
 *   >= 75 → go (proceed to full generation)
 *   60-74 → maybe (proceed with caveats)
 *   < 60  → no (park, log, notify)
 */
@Injectable()
export class EnhancedFitScoringService {
  private readonly logger = new Logger(EnhancedFitScoringService.name);

  constructor(
    private readonly activityRegistry: ActivityRegistryService,
    private readonly retrieval: RetrievalService,
  ) {}

  async score(payload: OpportunityPayload): Promise<EnhancedFitScoreResult> {
    const activityFacts = await this.activityRegistry.buildActivityFacts("diksha");

    const [programAlignment, strategicPlanFit, strategicGapBonus, biharFeasibility, budgetFit] = [
      this.scoreProgramAlignment(payload, activityFacts),
      this.scoreStrategicPlanFit(payload),
      this.scoreStrategicGapBonus(payload),
      this.scoreBiharFeasibility(payload),
      this.scoreBudgetFit(payload),
    ];

    const evidenceStrength = await this.scoreEvidenceStrength(payload);

    const dimensions = {
      programAlignment,
      strategicPlanFit,
      strategicGapBonus,
      evidenceStrength,
      biharFeasibility,
      budgetFit,
    };

    const totalScore = Object.values(dimensions).reduce((sum, d) => sum + d.score, 0);

    let decision: "go" | "maybe" | "no";
    let gateAction: "proceed" | "proceed_with_caveats" | "park";
    if (totalScore >= 75) {
      decision = "go";
      gateAction = "proceed";
    } else if (totalScore >= 60) {
      decision = "maybe";
      gateAction = "proceed_with_caveats";
    } else {
      decision = "no";
      gateAction = "park";
    }

    const caveats: string[] = [];
    for (const dim of Object.values(dimensions)) {
      if (dim.score < dim.maxScore * 0.4) {
        caveats.push(`${dim.name}: ${dim.rationale}`);
      }
    }

    this.logger.log(
      `Fit score for ${payload.funder?.name ?? "unknown"}: ${totalScore}/100 → ${decision} | ` +
        Object.values(dimensions)
          .map((d) => `${d.name.slice(0, 8)}=${d.score}/${d.maxScore}`)
          .join(", "),
    );

    return { totalScore, decision, dimensions, gateAction, caveats };
  }

  private scoreProgramAlignment(payload: OpportunityPayload, activityFacts: Record<string, unknown>): FitScoreDimension {
    const oppThemes = [
      ...(payload.themes?.primary ?? []),
      ...(payload.themes?.secondary ?? []),
    ].map((t) => t.toLowerCase());

    if (oppThemes.length === 0) {
      return { name: "Program Alignment", score: 10, maxScore: 25, rationale: "No themes extracted from opportunity — partial default" };
    }

    // Diksha's active program areas
    const programKeywords = [
      "education", "learning", "literacy", "numeracy", "digital", "computer",
      "sports", "football", "physical", "play",
      "girls", "empowerment", "gender", "adolescent", "leadership", "life skills",
      "social emotional", "sel", "see learning", "well-being", "mental health",
      "civic", "community", "inclusion", "diversity",
      "youth", "vocational", "career", "employment",
    ];

    let matchCount = 0;
    for (const theme of oppThemes) {
      if (programKeywords.some((kw) => theme.includes(kw))) {
        matchCount++;
      }
    }

    const ratio = matchCount / oppThemes.length;
    const score = Math.min(25, Math.round(ratio * 25));

    return {
      name: "Program Alignment",
      score: Math.max(score, 5), // minimum 5 — we're a general education org
      maxScore: 25,
      rationale: `${matchCount}/${oppThemes.length} opportunity themes match Diksha program areas`,
    };
  }

  private scoreStrategicPlanFit(payload: OpportunityPayload): FitScoreDimension {
    const oppThemes = [
      ...(payload.themes?.primary ?? []),
      ...(payload.themes?.secondary ?? []),
    ].map((t) => t.toLowerCase());

    if (oppThemes.length === 0) {
      return { name: "Strategic Plan Fit", score: 5, maxScore: 20, rationale: "No themes to match" };
    }

    let bestMatchCount = 0;
    let bestPriority = "";

    for (const sp of DIKSHA_STRATEGIC_PLAN.strategicPriorities) {
      let matchCount = 0;
      for (const theme of oppThemes) {
        if (sp.themes.some((t) => theme.includes(t) || t.includes(theme))) {
          matchCount++;
        }
      }
      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestPriority = sp.priority;
      }
    }

    let score: number;
    if (bestMatchCount >= 3) score = 20;
    else if (bestMatchCount === 2) score = 14;
    else if (bestMatchCount === 1) score = 7;
    else score = 0;

    return {
      name: "Strategic Plan Fit",
      score,
      maxScore: 20,
      rationale: bestMatchCount > 0
        ? `Best match: "${bestPriority}" (${bestMatchCount} theme overlaps)`
        : "No strategic priority matched opportunity themes",
    };
  }

  private scoreStrategicGapBonus(payload: OpportunityPayload): FitScoreDimension {
    const oppThemes = [
      ...(payload.themes?.primary ?? []),
      ...(payload.themes?.secondary ?? []),
    ].map((t) => t.toLowerCase());

    // Find strategic priorities that are unfunded AND match the opportunity
    const unfundedMatches = DIKSHA_STRATEGIC_PLAN.strategicPriorities.filter(
      (sp) =>
        !sp.hasFunding &&
        sp.themes.some((t) => oppThemes.some((ot) => ot.includes(t) || t.includes(ot))),
    );

    if (unfundedMatches.length === 0) {
      return { name: "Strategic Gap Bonus", score: 0, maxScore: 10, rationale: "Opportunity does not address an unfunded strategic gap" };
    }

    const noProposal = unfundedMatches.filter((sp) => !sp.hasExistingProposal);
    if (noProposal.length > 0) {
      return {
        name: "Strategic Gap Bonus",
        score: 10,
        maxScore: 10,
        rationale: `Unlocks unfunded priority with no existing proposal: "${noProposal[0].priority}"`,
      };
    }

    return {
      name: "Strategic Gap Bonus",
      score: 5,
      maxScore: 10,
      rationale: `Matches unfunded priority (proposal exists but no funding): "${unfundedMatches[0].priority}"`,
    };
  }

  private async scoreEvidenceStrength(payload: OpportunityPayload): Promise<FitScoreDimension> {
    const themes = [
      ...(payload.themes?.primary ?? []),
    ];

    if (themes.length === 0) {
      return { name: "Evidence Strength", score: 5, maxScore: 15, rationale: "No themes to search evidence for" };
    }

    try {
      const query = `Diksha Foundation ${themes.slice(0, 3).join(" ")} program outcomes evidence`;
      const chunks = await this.retrieval.retrieve(query, {
        mode: "internal_research",
        limit: 10,
        orgId: "diksha",
      });

      const avgScore = chunks.length > 0
        ? chunks.reduce((sum, c) => sum + (c.score ?? 0), 0) / chunks.length
        : 0;
      const uniqueDocs = new Set(chunks.map((c) => c.source)).size;

      let score: number;
      if (avgScore > 0.6 && uniqueDocs > 3) score = 15;
      else if (avgScore > 0.4) score = 10;
      else if (avgScore > 0.25 || chunks.length > 0) score = 5;
      else score = 0;

      return {
        name: "Evidence Strength",
        score,
        maxScore: 15,
        rationale: `${chunks.length} chunks retrieved (avg score ${avgScore.toFixed(2)}, ${uniqueDocs} unique docs)`,
      };
    } catch (err) {
      this.logger.warn(`Evidence scoring failed: ${(err as Error).message}`);
      return { name: "Evidence Strength", score: 5, maxScore: 15, rationale: "Retrieval failed — default score" };
    }
  }

  private scoreBiharFeasibility(payload: OpportunityPayload): FitScoreDimension {
    const geos = payload.keyConstraints?.geography ?? [];
    const geoStr = (Array.isArray(geos) ? geos : [geos]).join(" ").toLowerCase();
    const rfpText = (payload.extractedRequirements?.summary ?? "").toLowerCase();
    const combinedText = `${geoStr} ${rfpText}`;

    if (combinedText.includes("bihar") || combinedText.includes("patna")) {
      return { name: "Bihar Feasibility", score: 15, maxScore: 15, rationale: "Geography explicitly includes Bihar/Patna" };
    }
    if (combinedText.includes("india") || geoStr === "" || geos.length === 0) {
      return { name: "Bihar Feasibility", score: 10, maxScore: 15, rationale: geos.length === 0 ? "No geography specified — assume India-wide" : "India-wide scope includes Bihar" };
    }
    if (combinedText.includes("rural") || combinedText.includes("eastern india")) {
      return { name: "Bihar Feasibility", score: 12, maxScore: 15, rationale: "Rural/Eastern India focus compatible with Bihar" };
    }

    return { name: "Bihar Feasibility", score: 3, maxScore: 15, rationale: `Geography "${geoStr}" may exclude Bihar` };
  }

  private scoreBudgetFit(payload: OpportunityPayload): FitScoreDimension {
    const maxAmount = payload.keyConstraints?.maxGrantAmountINR;
    const durationYears = (payload.keyConstraints?.projectDurationMonthsMax ?? 12) / 12;
    const orgCeilingPerYear = ORG_CAPACITY.maxAskINRPerYear; // ₹1Cr/year

    if (maxAmount == null) {
      return { name: "Budget Fit", score: 7, maxScore: 15, rationale: "No budget ceiling specified — neutral" };
    }

    const annualAskINR = maxAmount / durationYears;

    if (annualAskINR <= orgCeilingPerYear) {
      // Within org capacity — score by sweet spot (30-50L/yr)
      if (annualAskINR >= 3_000_000 && annualAskINR <= 5_000_000) {
        return { name: "Budget Fit", score: 15, maxScore: 15, rationale: `₹${(annualAskINR / 100000).toFixed(0)}L/yr — ideal range (30-50L/yr)` };
      }
      if (annualAskINR >= 1_000_000) {
        return { name: "Budget Fit", score: 12, maxScore: 15, rationale: `₹${(annualAskINR / 100000).toFixed(0)}L/yr — workable (10-30L/yr)` };
      }
      if (annualAskINR >= 500_000) {
        return { name: "Budget Fit", score: 10, maxScore: 15, rationale: `₹${(annualAskINR / 100000).toFixed(0)}L/yr — above ideal but feasible (50L-1Cr/yr)` };
      }
      return { name: "Budget Fit", score: 3, maxScore: 15, rationale: `₹${(annualAskINR / 100000).toFixed(1)}L/yr — below minimum viable (< 5L/yr)` };
    }

    // Exceeds org ceiling
    if (annualAskINR > orgCeilingPerYear * 3) {
      return {
        name: "Budget Fit",
        score: 0,
        maxScore: 15,
        rationale: `₹${(annualAskINR / 100000).toFixed(0)}L/yr — exceeds org capacity 3× (₹${(orgCeilingPerYear / 100000).toFixed(0)}L/yr ceiling)`,
      };
    }
    return {
      name: "Budget Fit",
      score: 3,
      maxScore: 15,
      rationale: `₹${(annualAskINR / 100000).toFixed(0)}L/yr — above org ask ceiling ₹${(orgCeilingPerYear / 100000).toFixed(0)}L/yr`,
    };
  }
}
