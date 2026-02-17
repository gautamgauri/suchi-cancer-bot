import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { CapabilityService } from "../../framework/services/capability.service";
import { FunderPriorityProfile } from "../proposal.types";
import {
  FUNDER_PRIORITY_SYSTEM_PROMPT,
  buildFunderPriorityUserPrompt,
} from "../prompts/funder-priority-extractor.prompt";

/** Hardcoded fallback: funder theme keyword → capability codes */
const THEME_TO_CAPABILITY: Record<string, string[]> = {
  education: ["C4"],
  literacy: ["C4"],
  numeracy: ["C4"],
  learning: ["C4"],
  sports: ["C2", "C9"],
  football: ["C2", "C9"],
  play: ["C9"],
  "life skills": ["C5", "C6"],
  sel: ["C5", "C7"],
  "social-emotional": ["C5", "C7"],
  health: ["C2"],
  nutrition: ["C2"],
  community: ["C7"],
  affiliation: ["C7"],
  digital: ["C4", "C10"],
  technology: ["C4", "C10"],
  empowerment: ["C6", "C10"],
  gender: ["C3", "C7"],
  safety: ["C3"],
  environment: ["C8"],
};

@Injectable()
export class FunderPriorityExtractorService {
  private readonly logger = new Logger(FunderPriorityExtractorService.name);

  constructor(
    private readonly llm: FundingLlmService,
    private readonly capabilityService: CapabilityService,
  ) {}

  async extract(params: {
    rfpText: string;
    funderThemes?: { primary?: string[]; secondary?: string[] };
    extractedRequirements?: Record<string, unknown>;
  }): Promise<FunderPriorityProfile> {
    try {
      // Load C1-C10 definitions from DB for accurate mapping
      const capabilities = await this.capabilityService.list();
      const capDefs = capabilities
        .map((c) => `${c.capabilityId} (${c.name}): ${c.definitionShort}`)
        .join("\n");

      const themesStr = [
        ...(params.funderThemes?.primary ?? []),
        ...(params.funderThemes?.secondary ?? []),
      ].join(", ");

      const userPrompt = buildFunderPriorityUserPrompt({
        rfpText: params.rfpText,
        capabilityDefinitions: capDefs,
        funderThemes: themesStr || undefined,
      });

      const raw = await this.llm.generatePlain(
        FUNDER_PRIORITY_SYSTEM_PROMPT,
        "Extract funder priorities:",
        userPrompt,
      );

      const jsonStr = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();
      const parsed = JSON.parse(jsonStr);

      const profile: FunderPriorityProfile = {
        primaryCapabilities: Array.isArray(parsed.primaryCapabilities)
          ? parsed.primaryCapabilities
          : [],
        secondaryCapabilities: Array.isArray(parsed.secondaryCapabilities)
          ? parsed.secondaryCapabilities
          : [],
        themes: Array.isArray(parsed.themes) ? parsed.themes : [],
        preferredEvidenceTypes: Array.isArray(parsed.preferredEvidenceTypes)
          ? parsed.preferredEvidenceTypes
          : [],
        targetDemographics: parsed.targetDemographics ?? {},
        suggestedMIModalities: Array.isArray(parsed.suggestedMIModalities)
          ? parsed.suggestedMIModalities
          : [],
      };

      this.logger.log({
        diagnostic: "FUNDER_PRIORITY_EXTRACTED",
        primary: profile.primaryCapabilities,
        secondary: profile.secondaryCapabilities,
        themes: profile.themes,
      });

      return profile;
    } catch (err) {
      this.logger.warn(`Funder priority extraction failed, using fallback: ${err}`);
      return this.fallbackFromThemes(params.funderThemes);
    }
  }

  private fallbackFromThemes(
    funderThemes?: { primary?: string[]; secondary?: string[] },
  ): FunderPriorityProfile {
    const allThemes = [
      ...(funderThemes?.primary ?? []),
      ...(funderThemes?.secondary ?? []),
    ];
    const primary = new Set<string>();
    const secondary = new Set<string>();

    for (const theme of allThemes) {
      const lower = theme.toLowerCase();
      for (const [keyword, caps] of Object.entries(THEME_TO_CAPABILITY)) {
        if (lower.includes(keyword)) {
          caps.forEach((c) => primary.add(c));
        }
      }
    }

    // Default to C4 (education) if nothing matched
    if (primary.size === 0) primary.add("C4");

    return {
      primaryCapabilities: [...primary],
      secondaryCapabilities: [...secondary],
      themes: allThemes,
      preferredEvidenceTypes: [],
      targetDemographics: {},
      suggestedMIModalities: [],
    };
  }
}
