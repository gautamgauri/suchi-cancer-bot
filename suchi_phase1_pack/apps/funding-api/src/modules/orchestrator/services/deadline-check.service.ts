import { Injectable, Logger } from "@nestjs/common";
import { GoogleSearchService } from "../../google_search/google-search.service";
import type { OpportunityPayload } from "../../opportunity/opportunity.types";

export interface DeadlineCheckResult {
  storedDeadline: string | null;
  storedConfidence: "verified" | "estimated" | "unknown";
  webFoundDeadline: string | null;
  webSummary: string;
  match: "confirmed" | "mismatch" | "unverifiable" | "skipped";
  warning: string | null;
  queriesUsed: number;
}

/**
 * Orchestrator Stage 0: Deadline Verification.
 *
 * For any opportunity whose deadline confidence is not "verified",
 * performs a web-grounded search to cross-check the stored deadline
 * against publicly available information.
 *
 * Outcomes:
 *  - "confirmed"    — web search corroborates the stored deadline
 *  - "mismatch"     — web search found a different or closed deadline ⚠️
 *  - "unverifiable" — web search found no usable deadline signal
 *  - "skipped"      — deadline was already marked "verified", check skipped
 */
@Injectable()
export class DeadlineCheckService {
  private readonly logger = new Logger(DeadlineCheckService.name);

  constructor(private readonly searchService: GoogleSearchService) {}

  async check(payload: OpportunityPayload): Promise<DeadlineCheckResult> {
    const storedDeadline = payload.keyConstraints?.deadline ?? null;
    const storedConfidence = payload.keyConstraints?.deadlineConfidence ?? "unknown";
    const funderName = payload.funder?.name ?? "";
    const programName = payload.funder?.programName ?? "";

    // Skip the web check if already verified from source
    if (storedConfidence === "verified") {
      return {
        storedDeadline,
        storedConfidence,
        webFoundDeadline: null,
        webSummary: "Deadline is marked verified from source — web check skipped.",
        match: "skipped",
        warning: null,
        queriesUsed: 0,
      };
    }

    this.logger.log(
      `Deadline check for "${funderName} — ${programName}" (stored: ${storedDeadline ?? "none"}, confidence: ${storedConfidence})`,
    );

    const query = `"${funderName}" "${programName}" deadline apply 2025 2026 site:${this.guessFunderDomain(funderName)} OR grant application`;

    let webSummary = "";
    let webFoundDeadline: string | null = null;
    let queriesUsed = 0;

    try {
      const result = await this.searchService.searchGrounded(
        `Find the current submission deadline for the "${programName}" grant by ${funderName}. Is it currently open for applications? What is the exact deadline date?`,
      );
      queriesUsed = 1;
      webSummary = result.answer ?? "";

      // Extract a date from the summary via simple pattern matching
      webFoundDeadline = this.extractDateFromText(webSummary);
    } catch (err) {
      this.logger.warn(`Deadline web check failed: ${(err as Error).message}`);
      webSummary = "Web check failed — could not retrieve deadline information.";
    }

    const match = this.assessMatch(storedDeadline, webFoundDeadline, webSummary);
    const warning = this.buildWarning(match, storedDeadline, webFoundDeadline, funderName, programName);

    this.logger.log(
      `Deadline check result: stored=${storedDeadline}, webFound=${webFoundDeadline}, match=${match}`,
    );

    return {
      storedDeadline,
      storedConfidence,
      webFoundDeadline,
      webSummary: webSummary.slice(0, 600),
      match,
      warning,
      queriesUsed,
    };
  }

  private guessFunderDomain(funderName: string): string {
    const lower = funderName.toLowerCase().replace(/\s+/g, "");
    // Common funder domains
    const knownDomains: Record<string, string> = {
      sbifoundation: "sbifoundation.in",
      "sbi foundation": "sbifoundation.in",
      "azim premji": "azimpremjifoundation.org",
      "reliance foundation": "reliancefoundation.org",
      "tata trusts": "tatatrusts.org",
      "hcl foundation": "hclfoundation.org",
      "infosys foundation": "infosys.com",
    };
    for (const [key, domain] of Object.entries(knownDomains)) {
      if (lower.includes(key.replace(/\s+/g, ""))) return domain;
    }
    return "";
  }

  private extractDateFromText(text: string): string | null {
    // Look for ISO dates or common Indian date formats
    const patterns = [
      /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2})/i,
      /(\d{1,2}[\/\-]\d{1,2}[\/\-]20\d{2})/,
      /(20\d{2}-\d{2}-\d{2})/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  private assessMatch(
    stored: string | null,
    webFound: string | null,
    webSummary: string,
  ): DeadlineCheckResult["match"] {
    const closedSignals = ["closed", "no longer accepting", "deadline has passed", "cycle ended", "applications are closed"];
    const lowerSummary = webSummary.toLowerCase();

    // If web says the cycle is closed/passed — that's a mismatch
    if (closedSignals.some((s) => lowerSummary.includes(s))) {
      return "mismatch";
    }

    if (!webFound) return "unverifiable";

    if (!stored) return "unverifiable";

    // Compare year/month of stored vs web-found date
    const storedYear = stored.match(/20\d{2}/)?.[0];
    const webYear = webFound.match(/20\d{2}/)?.[0];

    if (storedYear && webYear && storedYear !== webYear) return "mismatch";

    return "confirmed";
  }

  private buildWarning(
    match: DeadlineCheckResult["match"],
    stored: string | null,
    webFound: string | null,
    funderName: string,
    programName: string,
  ): string | null {
    switch (match) {
      case "mismatch":
        return `⚠️ DEADLINE MISMATCH: Stored deadline (${stored ?? "unknown"}) may be incorrect. Web search suggests this call may be closed or on a different cycle. Verify at ${funderName}'s website before proceeding.`;
      case "unverifiable":
        return `⚠️ DEADLINE UNVERIFIED: Could not confirm the deadline for "${programName}" (${funderName}) via web search. Stored value (${stored ?? "none"}) was manually entered. Verify before submitting.`;
      case "confirmed":
        return null;
      case "skipped":
        return null;
    }
  }
}
