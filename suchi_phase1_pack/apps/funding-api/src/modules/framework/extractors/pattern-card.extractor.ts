import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { PatternCardService } from "../services/pattern-card.service";
import {
  PATTERN_CARD_EXTRACTION_SYSTEM,
  PATTERN_CARD_EXTRACTION_USER,
} from "../prompts/pattern-card-extraction.prompt";

export interface PatternCardExtraction {
  patternId: string;
  title: string;
  durationMins?: number;
  materials: string[];
  facilitatorScript: string[];
  adaptations: string[];
  miTagsPrimary: string[];
  miTagsSecondary: string[];
  capabilitiesPrimary: string[];
  capabilitiesSecondary: string[];
  assessmentArtifacts: string[];
  evidenceLevel: "RESEARCH" | "PRACTICE_GUIDE" | "ANECDOTAL";
}

@Injectable()
export class PatternCardExtractor {
  private readonly logger = new Logger(PatternCardExtractor.name);

  constructor(
    private readonly llm: FundingLlmService,
    private readonly patternCardService: PatternCardService,
  ) {}

  async extractFromText(text: string): Promise<PatternCardExtraction | null> {
    const userPrompt = PATTERN_CARD_EXTRACTION_USER(text);
    const raw = await this.llm.generatePlain(
      PATTERN_CARD_EXTRACTION_SYSTEM,
      "",
      userPrompt,
    );
    const json = this.parseJsonFromResponse(raw);
    if (!json) return null;
    return this.normalizeExtraction(json);
  }

  async extractAndCreate(text: string, sourceUrl?: string) {
    const ext = await this.extractFromText(text);
    if (!ext) return null;
    const existing = await this.patternCardService.list({ limit: 1000 });
    const found = existing.find((c) => c.patternId === ext.patternId);
    if (found) {
      this.logger.log(`Pattern card ${ext.patternId} already exists, skipping create`);
      return found;
    }
    return this.patternCardService.create({
      patternId: ext.patternId,
      title: ext.title,
      durationMins: ext.durationMins,
      materials: ext.materials,
      facilitatorScript: ext.facilitatorScript,
      adaptations: ext.adaptations,
      assessmentArtifacts: ext.assessmentArtifacts,
      sourceUrl,
      evidenceLevel: ext.evidenceLevel,
      miTagsPrimary: ext.miTagsPrimary,
      miTagsSecondary: ext.miTagsSecondary,
      capabilitiesPrimary: ext.capabilitiesPrimary,
      capabilitiesSecondary: ext.capabilitiesSecondary,
    });
  }

  private parseJsonFromResponse(raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}") + 1;
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private normalizeExtraction(json: Record<string, unknown>): PatternCardExtraction {
    return {
      patternId: String(json.patternId ?? "").trim() || "unknown",
      title: String(json.title ?? "").trim(),
      durationMins: typeof json.durationMins === "number" ? json.durationMins : undefined,
      materials: Array.isArray(json.materials) ? json.materials.map(String) : [],
      facilitatorScript: Array.isArray(json.facilitatorScript) ? json.facilitatorScript.map(String) : [],
      adaptations: Array.isArray(json.adaptations) ? json.adaptations.map(String) : [],
      miTagsPrimary: Array.isArray(json.miTagsPrimary) ? json.miTagsPrimary.map(String) : [],
      miTagsSecondary: Array.isArray(json.miTagsSecondary) ? json.miTagsSecondary.map(String) : [],
      capabilitiesPrimary: Array.isArray(json.capabilitiesPrimary) ? json.capabilitiesPrimary.map(String) : [],
      capabilitiesSecondary: Array.isArray(json.capabilitiesSecondary) ? json.capabilitiesSecondary.map(String) : [],
      assessmentArtifacts: Array.isArray(json.assessmentArtifacts) ? json.assessmentArtifacts.map(String) : [],
      evidenceLevel: (json.evidenceLevel === "RESEARCH" || json.evidenceLevel === "PRACTICE_GUIDE" ? json.evidenceLevel : "ANECDOTAL") as "RESEARCH" | "PRACTICE_GUIDE" | "ANECDOTAL",
    };
  }
}
