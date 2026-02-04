import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { ComparableCaseService } from "../services/comparable-case.service";
import {
  COMPARABLE_CASE_EXTRACTION_SYSTEM,
  COMPARABLE_CASE_EXTRACTION_USER,
} from "../prompts/comparable-case-extraction.prompt";

export interface ComparableCaseExtraction {
  caseId: string;
  programName: string;
  orgName: string;
  geography: string;
  targetGroup: "children" | "youth" | "women" | "mixed";
  deliveryModelTags: string[];
  outcomesSummary: string;
  indicatorsUsed: string[];
  costNotes: string | null;
  programConstraints: string;
  contextConstraints: string;
  transferabilityBihar: string;
  confidenceScore: number;
}

@Injectable()
export class ComparableCaseExtractor {
  private readonly logger = new Logger(ComparableCaseExtractor.name);

  constructor(
    private readonly llm: FundingLlmService,
    private readonly comparableCaseService: ComparableCaseService,
  ) {}

  async extractFromText(text: string): Promise<ComparableCaseExtraction | null> {
    const userPrompt = COMPARABLE_CASE_EXTRACTION_USER(text);
    const raw = await this.llm.generatePlain(
      COMPARABLE_CASE_EXTRACTION_SYSTEM,
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
    const existing = await this.comparableCaseService.list({ limit: 1000 });
    const found = existing.find((c) => c.caseId === ext.caseId);
    if (found) {
      this.logger.log(`Comparable case ${ext.caseId} already exists, skipping create`);
      return found;
    }
    return this.comparableCaseService.create({
      caseId: ext.caseId,
      programName: ext.programName,
      orgName: ext.orgName,
      geography: ext.geography,
      targetGroup: ext.targetGroup,
      deliveryModelTags: ext.deliveryModelTags,
      outcomesSummary: ext.outcomesSummary,
      indicatorsUsed: ext.indicatorsUsed,
      costNotes: ext.costNotes ?? undefined,
      programConstraints: ext.programConstraints || undefined,
      contextConstraints: ext.contextConstraints || undefined,
      transferabilityBihar: ext.transferabilityBihar || undefined,
      sourceUrl,
      confidenceScore: ext.confidenceScore,
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

  private normalizeExtraction(json: Record<string, unknown>): ComparableCaseExtraction {
    const tg = String(json.targetGroup ?? "").toLowerCase();
    const targetGroup = (["children", "youth", "women", "mixed"].includes(tg) ? tg : "mixed") as "children" | "youth" | "women" | "mixed";
    return {
      caseId: String(json.caseId ?? "").trim() || "unknown",
      programName: String(json.programName ?? "").trim(),
      orgName: String(json.orgName ?? "").trim(),
      geography: String(json.geography ?? "").trim(),
      targetGroup,
      deliveryModelTags: Array.isArray(json.deliveryModelTags) ? json.deliveryModelTags.map(String) : [],
      outcomesSummary: String(json.outcomesSummary ?? "").trim(),
      indicatorsUsed: Array.isArray(json.indicatorsUsed) ? json.indicatorsUsed.map(String) : [],
      costNotes: json.costNotes != null ? String(json.costNotes) : null,
      programConstraints: String(json.programConstraints ?? "").trim(),
      contextConstraints: String(json.contextConstraints ?? "").trim(),
      transferabilityBihar: String(json.transferabilityBihar ?? "").trim(),
      confidenceScore: typeof json.confidenceScore === "number" ? Math.min(5, Math.max(1, json.confidenceScore)) : 3,
    };
  }
}
