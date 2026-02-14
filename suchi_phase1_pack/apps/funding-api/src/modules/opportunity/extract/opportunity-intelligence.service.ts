import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import type {
  FitBand,
  FcraRelevance,
  OpportunityCard,
  OpportunityFitAssessment,
  OpportunityMissingInput,
  OpportunityPayload,
  OpportunitySubmissionChecklist,
} from "../opportunity.types";
import type { ExtractedConstraints } from "./rfp-constraints-extract.service";

@Injectable()
export class OpportunityIntelligenceService {
  private readonly targetGeographies = ["india", "bihar", "delhi"];
  private readonly targetThemes = ["education", "learning", "livelihood", "skills", "adolescent", "youth"];

  buildDedupeKey(input: {
    funder?: string;
    program?: string;
    deadline?: string;
    geography?: string[];
    sourceSubject?: string;
  }): string {
    const normalizedProgram = this.normalize(input.program);
    const fallbackProgram = normalizedProgram || this.normalize(input.sourceSubject) || "unknown-program";
    const normalized = [
      this.normalize(input.funder) || "unknown-funder",
      fallbackProgram,
      this.normalizeDate(input.deadline) || "unknown-deadline",
      this.normalizeArray(input.geography) || "unknown-geography",
    ].join("|");
    return normalized;
  }

  buildOpportunityId(dedupeKey: string): string {
    const digest = createHash("sha256").update(dedupeKey).digest("hex").slice(0, 12).toUpperCase();
    return `OPP-${digest}`;
  }

  buildCard(input: {
    payload: OpportunityPayload;
    constraints: ExtractedConstraints;
    rfpText?: string;
    sourceLink?: string;
  }): OpportunityCard {
    const geographyFit = this.computeFitBand(input.constraints.geography, this.targetGeographies);
    const themeValues = [
      ...(input.constraints.themes?.primary ?? []),
      ...(input.constraints.themes?.secondary ?? []),
    ];
    const thematicFit = this.computeFitBand(themeValues, this.targetThemes);
    const fcraRelevance = this.computeFcraRelevance(input.rfpText, input.payload.eligibility?.notes);
    const eligibilitySummary =
      input.payload.eligibility?.notes ??
      (input.payload.eligibility?.mustHaves?.length
        ? `Must have: ${input.payload.eligibility.mustHaves.join(", ")}`
        : undefined);

    const confidence = this.clamp01(
      [
        input.constraints.deadline ? 0.2 : 0,
        input.constraints.funderName ? 0.2 : 0,
        input.constraints.programName ? 0.15 : 0,
        input.constraints.geography?.length ? 0.2 : 0,
        themeValues.length ? 0.15 : 0,
        input.sourceLink ? 0.1 : 0,
      ].reduce((a, b) => a + b, 0),
    );

    return {
      funder: input.payload.funder?.name ?? "Unknown funder",
      program: input.payload.funder?.programName,
      deadline: input.payload.keyConstraints?.deadline,
      eligibilitySummary,
      fcraRelevance,
      geographyFit,
      thematicFit,
      sourceLink: input.sourceLink,
      confidence,
    };
  }

  buildFitAssessment(input: {
    payload: OpportunityPayload;
    constraints: ExtractedConstraints;
    card: OpportunityCard;
  }): OpportunityFitAssessment {
    const reasons: string[] = [];
    let score = 40;

    if (input.payload.keyConstraints?.deadline) {
      score += 15;
      reasons.push(`Deadline identified: ${input.payload.keyConstraints.deadline}.`);
    } else {
      reasons.push("Deadline is not clearly available yet.");
    }
    if (input.card.geographyFit === "strong_fit") {
      score += 15;
      reasons.push("Geography strongly overlaps with current focus geographies.");
    } else if (input.card.geographyFit === "moderate_fit") {
      score += 8;
      reasons.push("Geography appears partially aligned with current focus geographies.");
    } else {
      reasons.push("Geography fit is weak or unclear.");
    }
    if (input.card.thematicFit === "strong_fit") {
      score += 15;
      reasons.push("Themes strongly align with education and livelihood priorities.");
    } else if (input.card.thematicFit === "moderate_fit") {
      score += 8;
      reasons.push("Themes show partial alignment with priority focus areas.");
    } else {
      reasons.push("Thematic alignment is weak or not explicit.");
    }
    if (input.constraints.maxGrantAmountINR) {
      score += 8;
      reasons.push(`Grant size signal available: INR ${input.constraints.maxGrantAmountINR.toLocaleString("en-IN")}.`);
    } else {
      reasons.push("Grant amount is not yet specified.");
    }
    if (input.card.fcraRelevance === "required") {
      score += 5;
      reasons.push("FCRA requirement is explicit, enabling early compliance checks.");
    } else if (input.card.fcraRelevance === "mentioned") {
      score += 2;
      reasons.push("FCRA/compliance is referenced and should be verified.");
    }

    const boundedScore = Math.max(0, Math.min(100, score));
    const confidence = this.clamp01(input.card.confidence);
    const dedupedReasons = Array.from(new Set(reasons)).slice(0, 5);
    while (dedupedReasons.length < 3) {
      dedupedReasons.push("Initial triage is based on partial RFP evidence and should be validated.");
    }

    const missingInfo: OpportunityMissingInput[] = [];
    if (confidence < 0.55) {
      if (!input.payload.keyConstraints?.deadline) {
        missingInfo.push({
          field: "deadline",
          question: "What is the exact submission deadline and timezone?",
          priority: "high",
        });
      }
      if (!input.constraints.maxGrantAmountINR) {
        missingInfo.push({
          field: "maxGrantAmountINR",
          question: "What is the funding cap or expected budget range?",
          priority: "medium",
        });
      }
      if (!input.constraints.programName) {
        missingInfo.push({
          field: "programName",
          question: "Which exact program or call title does this RFP correspond to?",
          priority: "medium",
        });
      }
    }

    return {
      score: boundedScore,
      reasons: dedupedReasons,
      confidence,
      missingInfo: missingInfo.length ? missingInfo : undefined,
    };
  }

  buildSubmissionChecklist(rfpText: string): OpportunitySubmissionChecklist {
    const lines = rfpText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const wordLimits = this.extractWordLimits(lines);
    const attachments = this.extractAttachments(lines);
    const annexures = this.extractAnnexures(lines);
    const budgetFormat = this.extractBudgetFormat(lines);
    const submissionMode = this.extractSubmissionMode(lines);
    const items = [
      ...wordLimits.map((wl) => ({
        key: `word-limit-${this.normalize(wl.section) || "section"}`,
        label: `${wl.section} word limit (${wl.limitWords} words)`,
        required: true,
        evidence: wl.evidence,
      })),
      ...attachments.map((name) => ({
        key: `attachment-${this.normalize(name) || "required"}`,
        label: `Attach ${name}`,
        required: true,
      })),
      ...annexures.map((name) => ({
        key: `annexure-${this.normalize(name) || "required"}`,
        label: `Include ${name}`,
        required: true,
      })),
      {
        key: "submission-mode",
        label: submissionMode ? `Submit via ${submissionMode}` : "Confirm submission mode",
        required: true,
        evidence: submissionMode,
      },
      {
        key: "budget-format",
        label: budgetFormat ? `Prepare budget in ${budgetFormat}` : "Confirm budget format",
        required: true,
        evidence: budgetFormat,
      },
    ];

    return {
      wordLimits,
      attachments,
      budgetFormat,
      submissionMode,
      annexures,
      items,
    };
  }

  private extractWordLimits(
    lines: string[],
  ): Array<{ section: string; limitWords: number; evidence?: string }> {
    const out: Array<{ section: string; limitWords: number; evidence?: string }> = [];
    const regex = /(.{0,80}?)(\d{2,5})\s*words?/i;
    for (const line of lines) {
      const match = line.match(regex);
      if (!match) continue;
      const limitWords = Number(match[2]);
      if (Number.isNaN(limitWords)) continue;
      const section = match[1].replace(/[:\-]?\s*$/g, "").trim() || "Section";
      out.push({ section, limitWords, evidence: line.slice(0, 200) });
    }
    return out.slice(0, 12);
  }

  private extractAttachments(lines: string[]): string[] {
    const out = new Set<string>();
    const attachmentRegex = /(attach(?:ment)?s?|documents?|upload)\s*[:\-]\s*(.+)$/i;
    for (const line of lines) {
      const match = line.match(attachmentRegex);
      if (match?.[2]) {
        for (const item of match[2].split(/,|;|\band\b/i)) {
          const cleaned = item.replace(/\.$/, "").trim();
          if (cleaned.length >= 3) out.add(cleaned);
        }
      }
      if (/audited statements?|registration certificate|pan card|fcra certificate/i.test(line)) {
        out.add(line.replace(/\.$/, "").trim());
      }
    }
    return Array.from(out).slice(0, 20);
  }

  private extractAnnexures(lines: string[]): string[] {
    const out = new Set<string>();
    const annexureRegex = /(annexure|annex|appendix)\s*([a-z0-9\-]*)\s*[:\-]?\s*(.*)$/i;
    for (const line of lines) {
      const match = line.match(annexureRegex);
      if (!match) continue;
      const suffix = [match[1], match[2], match[3]].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (suffix) out.add(suffix);
    }
    return Array.from(out).slice(0, 20);
  }

  private extractBudgetFormat(lines: string[]): string | undefined {
    for (const line of lines) {
      if (!/budget/i.test(line)) continue;
      if (/xlsx|excel|spreadsheet/i.test(line)) return "Excel/XLSX template";
      if (/line[\s-]?item/i.test(line)) return "Line-item budget";
      if (/pdf/i.test(line)) return "PDF budget";
      return line.slice(0, 120);
    }
    return undefined;
  }

  private extractSubmissionMode(lines: string[]): string | undefined {
    for (const line of lines) {
      if (!/(submit|submission|apply)/i.test(line)) continue;
      if (/portal|online|web/i.test(line)) return "online portal";
      if (/email/i.test(line)) return "email";
      if (/physical|hard copy|courier/i.test(line)) return "physical submission";
      return line.slice(0, 120);
    }
    return undefined;
  }

  private computeFitBand(values: string[] | undefined, target: string[]): FitBand {
    if (!values || values.length === 0) return "unknown";
    const normalized = values.map((v) => this.normalize(v));
    const overlaps = normalized.filter((value) => target.some((t) => value.includes(t)));
    if (overlaps.length >= 2) return "strong_fit";
    if (overlaps.length === 1) return "moderate_fit";
    return "weak_fit";
  }

  private computeFcraRelevance(rfpText?: string, eligibilityNotes?: string): FcraRelevance {
    const combined = `${rfpText ?? ""}\n${eligibilityNotes ?? ""}`.toLowerCase();
    if (!combined.includes("fcra") && !combined.includes("foreign contribution")) return "not_mentioned";
    if (/fcra\s+(mandatory|required)|must have fcra|valid fcra/i.test(combined)) return "required";
    return "mentioned";
  }

  private normalize(value: string | undefined): string {
    return (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private normalizeArray(values: string[] | undefined): string {
    return (values ?? [])
      .map((v) => this.normalize(v))
      .filter(Boolean)
      .sort()
      .join(",");
  }

  private normalizeDate(value: string | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return this.normalize(value);
    return date.toISOString().slice(0, 10);
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}

