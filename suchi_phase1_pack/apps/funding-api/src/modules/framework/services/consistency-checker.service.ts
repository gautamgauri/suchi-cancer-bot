import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { CONSISTENCY_CHECK_SYSTEM, CONSISTENCY_CHECK_USER } from "../prompts/consistency-check.prompt";
import type { ConsistencyCheckInputDto } from "../dto";

export type ConsistencyFlagType =
  | "missing_mechanism"
  | "weak_indicator"
  | "capability_mismatch"
  | "equity_gap"
  | "mi_pedagogy_gap"
  | "academic_tone"
  | "missing_evidence";

export interface ConsistencyFlag {
  severity: "error" | "warning" | "info";
  type: ConsistencyFlagType;
  capability?: string;
  section?: string;
  message: string;
  suggestion?: string;
}

export interface ConsistencyCheckResult {
  overallScore: number;
  flags: ConsistencyFlag[];
  suggestions: string[];
  passesQualityGate: boolean;
}

@Injectable()
export class ConsistencyCheckerService {
  private readonly logger = new Logger(ConsistencyCheckerService.name);

  constructor(private readonly llm: FundingLlmService) {}

  async check(dto: ConsistencyCheckInputDto): Promise<ConsistencyCheckResult> {
    const userPrompt = CONSISTENCY_CHECK_USER(
      dto.draftText,
      dto.claimedCapabilities,
      dto.claimedMIModalities ?? [],
    );
    const raw = await this.llm.generatePlain(CONSISTENCY_CHECK_SYSTEM, "", userPrompt);
    const parsed = this.parseConsistencyJson(raw);
    if (parsed) return parsed;
    return {
      overallScore: 3,
      flags: [],
      suggestions: ["Could not parse consistency check response."],
      passesQualityGate: true,
    };
  }

  private parseConsistencyJson(raw: string): ConsistencyCheckResult | null {
    const trimmed = raw.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}") + 1;
    if (start < 0 || end <= start) return null;
    try {
      const json = JSON.parse(trimmed.slice(start, end)) as Record<string, unknown>;
      const score = typeof json.overallScore === "number" ? Math.min(5, Math.max(1, json.overallScore)) : 3;
      const flags: ConsistencyFlag[] = Array.isArray(json.flags)
        ? (json.flags as Array<Record<string, unknown>>).map((f) => ({
            severity: (["error", "warning", "info"].includes(String(f.severity)) ? f.severity : "info") as "error" | "warning" | "info",
            type: (f.type ?? "missing_evidence") as ConsistencyFlagType,
            capability: f.capability != null ? String(f.capability) : undefined,
            section: f.section != null ? String(f.section) : undefined,
            message: String(f.message ?? ""),
            suggestion: f.suggestion != null ? String(f.suggestion) : undefined,
          }))
        : [];
      const suggestions = Array.isArray(json.suggestions) ? json.suggestions.map(String) : [];
      const hasError = flags.some((f) => f.severity === "error");
      const passesQualityGate = score >= 3 && !hasError;
      return {
        overallScore: score,
        flags,
        suggestions,
        passesQualityGate: typeof json.passesQualityGate === "boolean" ? json.passesQualityGate : passesQualityGate,
      };
    } catch {
      return null;
    }
  }
}
