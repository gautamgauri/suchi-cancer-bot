import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { MethodCardService } from "../services/method-card.service";
import {
  METHOD_CARD_EXTRACTION_SYSTEM,
  METHOD_CARD_EXTRACTION_USER,
} from "../prompts/method-card-extraction.prompt";

export interface MethodCardExtraction {
  methodId: string;
  title: string;
  intent: string;
  steps: string[];
  whenToUse: string;
  whenNotToUse: string;
  ageBand: string;
  settingTags: string[];
  miTagsPrimary: string[];
  miTagsSecondary: string[];
  capabilityLinks: string[];
  assessmentArtifacts: string[];
  licenseFlag: "OK_INTERNAL" | "NEEDS_REVIEW" | "UNKNOWN";
}

@Injectable()
export class MethodCardExtractor {
  private readonly logger = new Logger(MethodCardExtractor.name);

  constructor(
    private readonly llm: FundingLlmService,
    private readonly methodCardService: MethodCardService,
  ) {}

  async extractFromText(text: string, sourceUrl?: string): Promise<MethodCardExtraction | null> {
    const userPrompt = METHOD_CARD_EXTRACTION_USER(text);
    const raw = await this.llm.generatePlain(
      METHOD_CARD_EXTRACTION_SYSTEM,
      "",
      userPrompt,
    );
    const json = this.parseJsonFromResponse(raw);
    if (!json) return null;
    return this.normalizeExtraction(json);
  }

  async extractAndCreate(text: string, sourceUrl?: string) {
    const ext = await this.extractFromText(text, sourceUrl);
    if (!ext) return null;
    const existing = await this.methodCardService.findByMethodId(ext.methodId);
    if (existing) {
      this.logger.log(`Method card ${ext.methodId} already exists, skipping create`);
      return existing;
    }
    return this.methodCardService.create({
      methodId: ext.methodId,
      title: ext.title,
      intent: ext.intent,
      steps: ext.steps,
      whenToUse: ext.whenToUse,
      whenNotToUse: ext.whenNotToUse,
      ageBand: ext.ageBand || undefined,
      settingTags: ext.settingTags,
      assessmentArtifacts: ext.assessmentArtifacts,
      sourceUrl,
      licenseFlag: ext.licenseFlag,
      miTagsPrimary: ext.miTagsPrimary,
      miTagsSecondary: ext.miTagsSecondary,
      capabilityLinks: ext.capabilityLinks,
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

  private normalizeExtraction(json: Record<string, unknown>): MethodCardExtraction {
    return {
      methodId: String(json.methodId ?? "").trim() || "unknown",
      title: String(json.title ?? "").trim(),
      intent: String(json.intent ?? "").trim(),
      steps: Array.isArray(json.steps) ? json.steps.map(String) : [],
      whenToUse: String(json.whenToUse ?? "").trim(),
      whenNotToUse: String(json.whenNotToUse ?? "").trim(),
      ageBand: String(json.ageBand ?? "").trim(),
      settingTags: Array.isArray(json.settingTags) ? json.settingTags.map(String) : [],
      miTagsPrimary: Array.isArray(json.miTagsPrimary) ? json.miTagsPrimary.map(String) : [],
      miTagsSecondary: Array.isArray(json.miTagsSecondary) ? json.miTagsSecondary.map(String) : [],
      capabilityLinks: Array.isArray(json.capabilityLinks) ? json.capabilityLinks.map(String) : [],
      assessmentArtifacts: Array.isArray(json.assessmentArtifacts) ? json.assessmentArtifacts.map(String) : [],
      licenseFlag: (json.licenseFlag === "OK_INTERNAL" || json.licenseFlag === "UNKNOWN" ? json.licenseFlag : "NEEDS_REVIEW") as "OK_INTERNAL" | "NEEDS_REVIEW" | "UNKNOWN",
    };
  }
}
