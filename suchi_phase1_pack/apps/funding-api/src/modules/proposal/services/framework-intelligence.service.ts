import { Injectable, Logger } from "@nestjs/common";
import { CardRetrievalService } from "../../framework/services/card-retrieval.service";
import { ProgramDesignGeneratorService } from "../../framework/services/program-design-generator.service";
import type { ProgramDesignResult } from "../../framework/services/program-design-generator.service";
import { ComparablesGeneratorService } from "../../framework/services/comparables-generator.service";
import type { ComparablesResult } from "../../framework/services/comparables-generator.service";
import { MelPackGeneratorService } from "../../framework/services/mel-pack-generator.service";
import type { MelPackResult } from "../../framework/services/mel-pack-generator.service";
import { FunderPriorityExtractorService } from "./funder-priority-extractor.service";
import { FrameworkIntelligencePack } from "../proposal.types";

@Injectable()
export class FrameworkIntelligenceService {
  private readonly logger = new Logger(FrameworkIntelligenceService.name);

  constructor(
    private readonly funderPriorityExtractor: FunderPriorityExtractorService,
    private readonly cardRetrieval: CardRetrievalService,
    private readonly programDesignGenerator: ProgramDesignGeneratorService,
    private readonly comparablesGenerator: ComparablesGeneratorService,
    private readonly melPackGenerator: MelPackGeneratorService,
  ) {}

  /**
   * Pre-compute all framework intelligence from RFP analysis.
   * Runs funder priority extraction first, then 4 framework calls in parallel.
   */
  async gatherIntelligence(params: {
    rfpText: string;
    funderThemes?: { primary?: string[]; secondary?: string[] };
    extractedRequirements?: Record<string, unknown>;
    targetGroup?: string;
    geography?: string;
  }): Promise<FrameworkIntelligencePack> {
    const start = Date.now();

    // Step 1: Extract funder priorities → C1-C10 capabilities
    const funderProfile = await this.funderPriorityExtractor.extract({
      rfpText: params.rfpText,
      funderThemes: params.funderThemes,
      extractedRequirements: params.extractedRequirements,
    });

    const capabilities = [
      ...funderProfile.primaryCapabilities,
      ...funderProfile.secondaryCapabilities,
    ];
    const targetGroup = params.targetGroup || "children and youth from marginalized communities";
    const geography = params.geography || "Bihar, India";

    // Step 2: Fire 4 framework calls in parallel
    const [cardsResult, designResult, comparablesResult, melResult] =
      await Promise.allSettled([
        this.cardRetrieval.retrieve({
          capabilities,
          cardTypes: ["method", "pattern", "comparable"],
          limit: 5,
        }),
        this.programDesignGenerator.generate({
          capabilities: funderProfile.primaryCapabilities,
          miModalities: funderProfile.suggestedMIModalities.length > 0
            ? funderProfile.suggestedMIModalities
            : ["bodily-kinesthetic", "interpersonal", "linguistic"],
          targetGroup,
          ageBand: "6-18",
          setting: "community_center",
        }),
        this.comparablesGenerator.generate({
          capabilities: funderProfile.primaryCapabilities,
          targetGroup,
          geographyConstraints: geography,
        }),
        this.melPackGenerator.generate({
          capabilities: funderProfile.primaryCapabilities,
          targetGroup,
          geography,
        }),
      ]);

    // Step 3: Extract results, handling failures gracefully
    const cards = cardsResult.status === "fulfilled" ? cardsResult.value : { methods: [], patterns: [], comparables: [] };
    const design: ProgramDesignResult | null = designResult.status === "fulfilled" ? designResult.value : null;
    const comparables: ComparablesResult | null = comparablesResult.status === "fulfilled" ? comparablesResult.value : null;
    const mel: MelPackResult | null = melResult.status === "fulfilled" ? melResult.value : null;

    // Log failures
    if (cardsResult.status === "rejected") this.logger.warn(`Card retrieval failed: ${cardsResult.reason}`);
    if (designResult.status === "rejected") this.logger.warn(`Program design failed: ${designResult.reason}`);
    if (comparablesResult.status === "rejected") this.logger.warn(`Comparables generation failed: ${comparablesResult.reason}`);
    if (melResult.status === "rejected") this.logger.warn(`MEL pack generation failed: ${melResult.reason}`);

    const pack: FrameworkIntelligencePack = {
      funderProfile,
      methodCards: cards.methods.map((m) => ({
        title: m.title,
        description: m.intent ?? "",
        capabilities: m.capabilityLinks ?? [],
      })),
      patternCards: cards.patterns.map((p) => ({
        title: p.title,
        description: p.facilitatorScript?.join("; ") ?? "",
      })),
      comparableCases: (comparables?.cases ?? cards.comparables).map((c) => ({
        programName: c.programName,
        outcomes: c.outcomesSummary ?? "",
        geography: c.geography ?? "",
      })),
      comparablesParagraph: comparables?.paragraph ?? "",
      transferabilityNotes: comparables?.transferabilityNotes ?? "",
      programDesign: design
        ? {
            theoryOfChange: design.theoryOfChange,
            activityBlocks: design.activityBlocks.map((b) => ({
              weekRange: b.weekRange,
              theme: b.theme,
              capabilityFocus: b.capabilityFocus,
            })),
            gaps: design.gaps,
          }
        : null,
      melPack: mel
        ? {
            capabilityIndicators: mel.capabilityIndicators.map((ci) => ({
              capability: ci.capability,
              indicators: ci.indicators.map((ind) => ({
                type: ind.type,
                indicator: ind.indicator,
                frequency: ind.frequency,
                tool: ind.tool,
              })),
            })),
          }
        : null,
    };

    this.logger.log({
      diagnostic: "FRAMEWORK_INTELLIGENCE_GATHERED",
      durationMs: Date.now() - start,
      methodCards: pack.methodCards.length,
      patternCards: pack.patternCards.length,
      comparableCases: pack.comparableCases.length,
      hasProgramDesign: !!pack.programDesign,
      hasMelPack: !!pack.melPack,
      primaryCapabilities: funderProfile.primaryCapabilities,
    });

    return pack;
  }

  /**
   * Format framework intelligence for the planner prompt.
   * Returns a markdown block summarizing all framework knowledge.
   */
  formatPlannerContext(pack: FrameworkIntelligencePack): string {
    const lines: string[] = [];

    lines.push("FRAMEWORK INTELLIGENCE (use this to enrich your outline):");
    lines.push(`Funder Priority Capabilities: ${pack.funderProfile.primaryCapabilities.join(", ")}`);

    if (pack.funderProfile.themes.length > 0) {
      lines.push(`Funder Themes: ${pack.funderProfile.themes.join(", ")}`);
    }

    if (pack.methodCards.length > 0) {
      lines.push("\nDiscovered Program Models (method cards):");
      for (const mc of pack.methodCards.slice(0, 5)) {
        lines.push(`- ${mc.title}: ${mc.description.substring(0, 150)}`);
      }
    }

    if (pack.patternCards.length > 0) {
      lines.push("\nSession Patterns:");
      for (const pc of pack.patternCards.slice(0, 3)) {
        lines.push(`- ${pc.title}: ${pc.description.substring(0, 150)}`);
      }
    }

    if (pack.programDesign) {
      const toc = pack.programDesign.theoryOfChange;
      lines.push("\nTheory of Change:");
      lines.push(`  Inputs: ${toc.inputs.join("; ")}`);
      lines.push(`  Activities: ${toc.activities.join("; ")}`);
      lines.push(`  Outputs: ${toc.outputs.join("; ")}`);
      lines.push(`  Outcomes: ${toc.outcomes.join("; ")}`);
      lines.push(`  Impact: ${toc.impact}`);
    }

    if (pack.comparableCases.length > 0) {
      lines.push("\nComparable Programs:");
      for (const cc of pack.comparableCases.slice(0, 3)) {
        lines.push(`- ${cc.programName} (${cc.geography}): ${cc.outcomes.substring(0, 150)}`);
      }
    }

    if (pack.melPack && pack.melPack.capabilityIndicators.length > 0) {
      lines.push("\nMEL Indicators (capability-aligned):");
      for (const ci of pack.melPack.capabilityIndicators.slice(0, 4)) {
        const indList = ci.indicators.slice(0, 2).map((i) => i.indicator).join("; ");
        lines.push(`- ${ci.capability}: ${indList}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Route the relevant framework context snippet for a given section type.
   * Returns a focused markdown block — capped to avoid prompt bloat.
   */
  getSectionContext(sectionName: string, pack: FrameworkIntelligencePack): string {
    const lower = sectionName.toLowerCase();
    const lines: string[] = ["FRAMEWORK KNOWLEDGE FOR THIS SECTION:"];

    // Need / Background / Rationale → comparables + transferability
    if (lower.includes("need") || lower.includes("background") || lower.includes("rationale") || lower.includes("context") || lower.includes("problem")) {
      if (pack.comparablesParagraph) {
        lines.push("\nComparable Programs Evidence:");
        lines.push(pack.comparablesParagraph.substring(0, 800));
      }
      if (pack.transferabilityNotes) {
        lines.push("\nTransferability to Bihar:");
        lines.push(pack.transferabilityNotes.substring(0, 400));
      }
      if (pack.funderProfile.themes.length > 0) {
        lines.push(`\nFunder Priority Themes: ${pack.funderProfile.themes.join(", ")}`);
      }
    }

    // Project Design / Activities / Methodology → ToC + methods + patterns
    else if (lower.includes("design") || lower.includes("activit") || lower.includes("methodology") || lower.includes("implementation")) {
      if (pack.programDesign) {
        const toc = pack.programDesign.theoryOfChange;
        lines.push("\nTheory of Change:");
        lines.push(`  Inputs: ${toc.inputs.join("; ")}`);
        lines.push(`  Activities: ${toc.activities.join("; ")}`);
        lines.push(`  Outputs: ${toc.outputs.join("; ")}`);
        lines.push(`  Outcomes: ${toc.outcomes.join("; ")}`);
        lines.push(`  Impact: ${toc.impact}`);

        if (pack.programDesign.activityBlocks.length > 0) {
          lines.push("\nActivity Blocks:");
          for (const ab of pack.programDesign.activityBlocks.slice(0, 4)) {
            lines.push(`- ${ab.weekRange}: ${ab.theme} (capabilities: ${ab.capabilityFocus.join(", ")})`);
          }
        }
      }
      if (pack.methodCards.length > 0) {
        lines.push("\nProven Methods (adapt these to Diksha's Bihar context):");
        for (const mc of pack.methodCards.slice(0, 4)) {
          lines.push(`- ${mc.title}: ${mc.description.substring(0, 200)}`);
        }
      }
      if (pack.patternCards.length > 0) {
        lines.push("\nSession Patterns:");
        for (const pc of pack.patternCards.slice(0, 3)) {
          lines.push(`- ${pc.title}: ${pc.description.substring(0, 200)}`);
        }
      }
    }

    // Objectives / Results / Outcomes → ToC outcomes + MEL indicators
    else if (lower.includes("objective") || lower.includes("result") || lower.includes("outcome") || lower.includes("impact") || lower.includes("goal")) {
      if (pack.programDesign) {
        lines.push(`\nTheory of Change Outcomes: ${pack.programDesign.theoryOfChange.outcomes.join("; ")}`);
        lines.push(`Impact: ${pack.programDesign.theoryOfChange.impact}`);
      }
      if (pack.melPack) {
        lines.push("\nCapability-Aligned Indicators:");
        for (const ci of pack.melPack.capabilityIndicators) {
          lines.push(`\n${ci.capability}:`);
          for (const ind of ci.indicators.slice(0, 3)) {
            lines.push(`  - [${ind.type}] ${ind.indicator} (${ind.frequency}, tool: ${ind.tool})`);
          }
        }
      }
    }

    // M&E / Monitoring → full MEL pack
    else if (lower.includes("monitor") || lower.includes("evaluat") || lower.includes("m&e") || lower.includes("m & e")) {
      if (pack.melPack) {
        lines.push("\nCapability-Aligned M&E Framework:");
        for (const ci of pack.melPack.capabilityIndicators) {
          lines.push(`\n${ci.capability}:`);
          for (const ind of ci.indicators) {
            lines.push(`  - [${ind.type}] ${ind.indicator} (${ind.frequency}, tool: ${ind.tool})`);
          }
        }
      }
    }

    // Budget → activity blocks for cost centers
    else if (lower.includes("budget") || lower.includes("financial")) {
      if (pack.programDesign?.activityBlocks.length) {
        lines.push("\nActivity Blocks (for cost center alignment):");
        for (const ab of pack.programDesign.activityBlocks) {
          lines.push(`- ${ab.weekRange}: ${ab.theme}`);
        }
      }
      if (pack.methodCards.length > 0) {
        lines.push("\nMethod Card Materials (for budget items):");
        for (const mc of pack.methodCards.slice(0, 3)) {
          lines.push(`- ${mc.title}: ${mc.description.substring(0, 100)}`);
        }
      }
    }

    // Experience / Track Record → comparable cases
    else if (lower.includes("experience") || lower.includes("track record") || lower.includes("past work")) {
      if (pack.comparableCases.length > 0) {
        lines.push("\nComparable Programs (position Diksha alongside these):");
        for (const cc of pack.comparableCases) {
          lines.push(`- ${cc.programName} (${cc.geography}): ${cc.outcomes.substring(0, 200)}`);
        }
      }
      if (pack.transferabilityNotes) {
        lines.push(`\nTransferability: ${pack.transferabilityNotes.substring(0, 300)}`);
      }
    }

    // Team / Staffing → method cards for skill requirements
    else if (lower.includes("team") || lower.includes("staff") || lower.includes("personnel")) {
      if (pack.methodCards.length > 0) {
        lines.push("\nMethod Cards (inform required staff skills):");
        for (const mc of pack.methodCards.slice(0, 3)) {
          lines.push(`- ${mc.title}: ${mc.description.substring(0, 150)}`);
        }
      }
    }

    // Default: light summary for communication, sustainability, etc.
    else {
      lines.push(`\nFunder Priorities: ${pack.funderProfile.primaryCapabilities.join(", ")}`);
      if (pack.funderProfile.themes.length > 0) {
        lines.push(`Themes: ${pack.funderProfile.themes.join(", ")}`);
      }
      if (pack.programDesign) {
        lines.push(`Impact Goal: ${pack.programDesign.theoryOfChange.impact}`);
      }
    }

    // Only return if we have meaningful content beyond the header
    return lines.length > 1 ? lines.join("\n") : "";
  }
}
