import { Injectable, Logger } from "@nestjs/common";
import type { BudgetEnvelope, BudgetLineItem } from "../orchestrator.types";
import {
  UNIT_COST_BENCHMARKS,
  BUDGET_TEMPLATES,
  BUDGET_CATEGORY_DISTRIBUTION,
  type BudgetTemplate,
} from "../data/budget-templates";
import { ORG_CAPACITY } from "../data/org-capacity";
import { ActivityRegistryService } from "../../activity_registry/activity-registry.service";
import type { OpportunityPayload, ProjectCategory } from "../../opportunity/opportunity.types";

/**
 * Pre-drafting budget envelope generator.
 *
 * BUDGET ANCHOR PRINCIPLE
 * -----------------------
 * Total budget is anchored to: costPerChildPerYearINR × beneficiaryCount × (durationMonths/12)
 * This matches how Diksha actually prices its programmes:
 *   - Daily full engagement (KHEL):    ₹20,000/child/year  (~₹30L/centre)
 *   - 2-3x/week (Empowering Futures):  ₹10,000/child/year
 *
 * Line items are built bottom-up from benchmarks, then proportionally scaled
 * to hit the per-child anchor. The funder ceiling is applied last.
 */
@Injectable()
export class BudgetEnvelopeService {
  private readonly logger = new Logger(BudgetEnvelopeService.name);

  constructor(
    private readonly activityRegistry: ActivityRegistryService,
  ) {}

  async generate(payload: OpportunityPayload): Promise<BudgetEnvelope> {
    // Hard funder cap — never exceed this
    const ceiling = payload.keyConstraints?.maxGrantAmountINR ?? 3500000; // default 35L
    const explicitMin = payload.keyConstraints?.minGrantAmountINR; // optional floor override
    const durationMonths = payload.keyConstraints?.projectDurationMonthsMax ?? 12;
    const durationYears = durationMonths / 12;

    // Org capacity ceiling — never target more per year than our proven absorption capacity
    const orgCapacityCeilingINR = ORG_CAPACITY.maxAskINRPerYear * durationYears;
    // Strategic working ceiling — what we actually target (can be well below funder cap)
    // Clamped to org capacity so we never build a ₹9Cr+ budget even if funder allows it.
    const workingCeiling = Math.min(
      payload.keyConstraints?.recommendedAskINR ?? ceiling,
      orgCapacityCeilingINR,
    );

    // 1. Select best-matching template (typed override takes priority)
    const template = this.selectTemplate(payload);
    const projectCategory = this.deriveProjectCategory(template, payload);

    // 2. Get org facts for scaling
    const facts = await this.activityRegistry.buildActivityFacts("diksha");
    const centreCount = Array.isArray(facts?.centers) ? (facts.centers as string[]).length : 3;
    const beneficiaryCount = (facts?.totalDirectBeneficiaries as number) ?? 500;

    // 3. Compute budget anchor
    //    - Tech products: anchor = max(baseFixed, variable×users) × years (cost floor)
    //                     then scale UP to workingCeiling (strategic ask)
    //    - Field programmes: anchor = costPerChild × beneficiaries × years
    const rawAnchor = template.baseFixedCostINR
      ? Math.max(
          template.baseFixedCostINR * durationYears,
          (template.variableCostPerBeneficiaryINR ?? 0) * beneficiaryCount * durationYears,
        )
      : template.costPerChildPerYearINR * beneficiaryCount * durationYears;

    // For tech products: target the strategic ask (workingCeiling) since build costs are
    // essentially fixed and we want a credible pilot budget, not a minimal one.
    // For field programmes: target the per-child cost anchor (raised by explicitMin if set).
    const anchorTarget = template.baseFixedCostINR
      ? workingCeiling
      : explicitMin
        ? Math.max(rawAnchor, explicitMin)
        : rawAnchor;

    this.logger.log(
      template.baseFixedCostINR
        ? `Budget anchor (tech-product): base ₹${(template.baseFixedCostINR / 100000).toFixed(1)}L fixed + ` +
            `₹${template.variableCostPerBeneficiaryINR}/student × ${beneficiaryCount} = ` +
            `₹${(rawAnchor / 100000).toFixed(1)}L floor → targeting workingCeiling ₹${(workingCeiling / 100000).toFixed(1)}L`
        : `Budget anchor: ${template.programIntensity} programme | ₹${(template.costPerChildPerYearINR / 1000).toFixed(0)}k/child/yr × ${beneficiaryCount} children × ${durationYears.toFixed(1)} yr = ₹${(anchorTarget / 100000).toFixed(1)}L`,
    );

    // 4. Build line items bottom-up from template benchmarks
    const lineItems = this.buildLineItems(template, centreCount, beneficiaryCount, durationMonths);

    const warnings: string[] = [];
    const unitCostFlags: string[] = [];
    const contingencyPercent = 0.05;

    // Warn if org capacity ceiling clamped below recommendedAsk or funder cap
    if (orgCapacityCeilingINR < (payload.keyConstraints?.recommendedAskINR ?? ceiling)) {
      warnings.push(
        `Envelope clamped to org ask ceiling ₹${(orgCapacityCeilingINR / 100000).toFixed(0)}L ` +
          `(₹${(ORG_CAPACITY.maxAskINRPerYear / 100000).toFixed(0)}L/yr × ${durationYears.toFixed(1)} yr)`,
      );
    }

    // 5. Scale line items proportionally to hit the per-child anchor
    //    We want: scaled_subtotal + 5% contingency ≈ anchorTarget
    //    So: scaled_subtotal ≈ anchorTarget / 1.05
    const rawSubtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);
    if (rawSubtotal > 0) {
      const targetSubtotal = anchorTarget / (1 + contingencyPercent);
      const scaleFactor = targetSubtotal / rawSubtotal;
      if (Math.abs(scaleFactor - 1) > 0.05) {
        // Only scale if adjustment is more than 5%
        for (const li of lineItems) {
          li.amount = Math.round(li.amount * scaleFactor);
        }
        const direction = scaleFactor > 1 ? "up" : "down";
        warnings.push(
          `Line items scaled ${direction} by ${((scaleFactor - 1) * 100).toFixed(0)}% to match ` +
            `₹${(template.costPerChildPerYearINR / 1000).toFixed(0)}k/child/yr × ${beneficiaryCount} children anchor (₹${(anchorTarget / 100000).toFixed(1)}L)`,
        );
      }
    }

    // 6. Apply funder ceiling (scale down if over)
    const subtotalAfterAnchor = lineItems.reduce((sum, li) => sum + li.amount, 0);
    let grandTotal = subtotalAfterAnchor + Math.round(subtotalAfterAnchor * contingencyPercent);

    if (grandTotal > ceiling) {
      warnings.push(
        `Budget (₹${(grandTotal / 100000).toFixed(1)}L) exceeds funder ceiling (₹${(ceiling / 100000).toFixed(1)}L) — scaling down`,
      );
      const scaleFactor = (ceiling / grandTotal) * 0.95;
      for (const li of lineItems) {
        li.amount = Math.round(li.amount * scaleFactor);
      }
      const newSubtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);
      grandTotal = newSubtotal + Math.round(newSubtotal * contingencyPercent);
    }

    // 7. Validate category distribution
    const finalSubtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);
    const categoryDistWarnings = this.validateCategoryDistribution(lineItems, finalSubtotal);
    warnings.push(...categoryDistWarnings);

    // 8. Flag unit cost outliers (pre-scaling benchmarks — informational only)
    for (const li of lineItems) {
      const benchmark = UNIT_COST_BENCHMARKS[li.notes];
      if (benchmark && li.unitCostINR > benchmark.max * 1.2) {
        unitCostFlags.push(`${li.item}: ₹${li.unitCostINR} exceeds benchmark max ₹${benchmark.max}`);
      }
      if (benchmark && li.unitCostINR < benchmark.min * 0.8) {
        unitCostFlags.push(`${li.item}: ₹${li.unitCostINR} below benchmark min ₹${benchmark.min}`);
      }
    }

    const finalContingency = Math.round(finalSubtotal * contingencyPercent);

    this.logger.log(
      `Budget envelope: ${template.programType} | ${lineItems.length} line items | ` +
        `₹${(finalSubtotal / 100000).toFixed(1)}L + ${(contingencyPercent * 100).toFixed(0)}% contingency = ` +
        `₹${((finalSubtotal + finalContingency) / 100000).toFixed(1)}L | ceiling ₹${(ceiling / 100000).toFixed(1)}L`,
    );

    return {
      // targetCeilingINR = strategic working ceiling (recommendedAskINR if set, else funder max)
      // This is what the proposal generator uses as its budget constraint.
      targetCeilingINR: workingCeiling,
      grantPeriodMonths: durationMonths,
      perChildCostPerYearINR: template.costPerChildPerYearINR,
      programIntensity: template.programIntensity,
      beneficiaryCount,
      projectCategory,
      lineItems,
      subtotal: finalSubtotal,
      contingencyPercent,
      contingencyAmount: finalContingency,
      grandTotal: finalSubtotal + finalContingency,
      warnings,
      unitCostFlags,
    };
  }

  private selectTemplate(payload: OpportunityPayload): BudgetTemplate {
    // Typed override takes priority — if declared in types but missing from templates, throw (code error)
    const override = payload.keyConstraints?.overrideBudgetTemplate;
    if (override) {
      const found = BUDGET_TEMPLATES.find((t) => t.programType === override);
      if (found) {
        this.logger.log(`Selected budget template: ${found.programType} (explicit override)`);
        return found;
      }
      throw new Error(
        `Budget template "${override}" is declared in types but missing from BUDGET_TEMPLATES`,
      );
    }

    // Theme-based auto-selection
    const oppThemes = [
      ...(payload.themes?.primary ?? []),
      ...(payload.themes?.secondary ?? []),
    ].map((t) => t.toLowerCase());

    let bestTemplate = BUDGET_TEMPLATES[0]; // default: football-for-development
    let bestScore = 0;

    for (const tmpl of BUDGET_TEMPLATES) {
      let score = 0;
      for (const theme of oppThemes) {
        if (tmpl.matchThemes.some((mt) => theme.includes(mt) || mt.includes(theme))) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestTemplate = tmpl;
      }
    }

    this.logger.log(`Selected budget template: ${bestTemplate.programType} (score: ${bestScore})`);
    return bestTemplate;
  }

  private deriveProjectCategory(template: BudgetTemplate, payload: OpportunityPayload): ProjectCategory {
    // Explicit override in opportunity wins
    if (payload.keyConstraints?.projectCategory) return payload.keyConstraints.projectCategory;
    // Derive from template type
    if (template.programType === "ai-tech-product") return "tech-product";
    return "field-programme";
  }

  private buildLineItems(
    template: BudgetTemplate,
    centreCount: number,
    beneficiaryCount: number,
    durationMonths: number,
  ): BudgetLineItem[] {
    const items: BudgetLineItem[] = [];

    for (const stdItem of template.standardLineItems) {
      const benchmark = UNIT_COST_BENCHMARKS[stdItem.benchmarkKey];
      if (!benchmark) {
        this.logger.warn(`No benchmark found for key: ${stdItem.benchmarkKey}`);
        continue;
      }

      const unitCost = benchmark.typical;
      let quantity = stdItem.defaultQuantity;

      switch (stdItem.scaleFactor) {
        case "per_centre":
          quantity = stdItem.defaultQuantity * centreCount;
          break;
        case "per_beneficiary":
          quantity = stdItem.defaultQuantity * beneficiaryCount;
          break;
        case "per_leader":
          quantity = stdItem.defaultQuantity * Math.ceil(centreCount * 3);
          break;
        case "fixed":
          quantity = stdItem.defaultQuantity;
          break;
      }

      // Adjust months to match grant period
      const months = stdItem.months === 12 ? durationMonths : stdItem.months;
      const amount = Math.round(unitCost * quantity * months);

      items.push({
        category: stdItem.category,
        item: stdItem.item,
        unitCostINR: unitCost,
        unit: benchmark.unit,
        quantity,
        months,
        amount,
        notes: stdItem.benchmarkKey,
        source: "benchmark",
      });
    }

    return items;
  }

  private validateCategoryDistribution(lineItems: BudgetLineItem[], subtotal: number): string[] {
    if (subtotal === 0) return [];

    const warnings: string[] = [];
    const categoryTotals: Record<string, number> = {};

    for (const li of lineItems) {
      const cat = li.category.toLowerCase();
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + li.amount;
    }

    const categoryMapping: Record<string, string> = {
      staff: "staff",
      materials: "programMaterials",
      equipment: "programMaterials",
      training: "training",
      events: "events",
      safety: "transport",
      transport: "transport",
      "m&e": "mAndE",
      overhead: "administrative",
    };

    const mappedTotals: Record<string, number> = {};
    for (const [cat, total] of Object.entries(categoryTotals)) {
      const mappedKey = categoryMapping[cat] ?? "administrative";
      mappedTotals[mappedKey] = (mappedTotals[mappedKey] ?? 0) + total;
    }

    for (const [distKey, range] of Object.entries(BUDGET_CATEGORY_DISTRIBUTION)) {
      const actual = (mappedTotals[distKey] ?? 0) / subtotal;
      if (actual > range.max + 0.05) {
        warnings.push(
          `${range.label}: ${(actual * 100).toFixed(0)}% exceeds typical max ${(range.max * 100).toFixed(0)}%`,
        );
      }
      if (actual > 0 && actual < range.min - 0.03) {
        warnings.push(
          `${range.label}: ${(actual * 100).toFixed(0)}% below typical min ${(range.min * 100).toFixed(0)}%`,
        );
      }
    }

    return warnings;
  }
}
