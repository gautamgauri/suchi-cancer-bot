import { Injectable, Logger } from "@nestjs/common";
import { GoogleSearchService } from "../../google_search/google-search.service";
import type { OpportunityPayload } from "../../opportunity/opportunity.types";

/**
 * Orchestrator Stage E: Web Evidence Search.
 *
 * Uses Gemini Grounding (Google Search) to research:
 *   - Funder priorities and past grants
 *   - Comparable programs in similar geographies
 *   - Evidence for outcomes in opportunity themes
 *
 * Falls back to structured CSE search when grounding is unavailable.
 * All queries are capped at daily free tier limits.
 */

export interface WebEvidenceResult {
  funderIntel: {
    summary: string;
    sources: Array<{ title: string; uri: string }>;
  };
  comparablePrograms: {
    summary: string;
    sources: Array<{ title: string; uri: string }>;
  };
  themeEvidence: {
    summary: string;
    sources: Array<{ title: string; uri: string }>;
  };
  queriesUsed: number;
}

@Injectable()
export class WebEvidenceService {
  private readonly logger = new Logger(WebEvidenceService.name);

  constructor(private readonly searchService: GoogleSearchService) {}

  async gather(payload: OpportunityPayload): Promise<WebEvidenceResult> {
    const funderName = payload.funder?.name ?? "";
    const programName = payload.funder?.programName ?? "";
    const themes = [
      ...(payload.themes?.primary ?? []),
      ...(payload.themes?.secondary ?? []),
    ];
    const geography = payload.keyConstraints?.geography?.join(", ") ?? "Bihar, India";

    let queriesUsed = 0;

    // --- 1. Funder intelligence ---
    const funderIntel = await this.researchFunder(funderName, programName);
    queriesUsed++;

    // --- 2. Comparable programs ---
    const comparablePrograms = await this.researchComparables(themes, geography);
    queriesUsed++;

    // --- 3. Theme evidence (outcomes, best practices) ---
    const themeEvidence = await this.researchThemeEvidence(themes, geography);
    queriesUsed++;

    this.logger.log(
      `Web evidence: ${queriesUsed} queries | funder=${funderIntel.sources.length} sources, ` +
        `comparables=${comparablePrograms.sources.length}, themes=${themeEvidence.sources.length}`,
    );

    return { funderIntel, comparablePrograms, themeEvidence, queriesUsed };
  }

  private async researchFunder(
    funderName: string,
    programName: string,
  ): Promise<{ summary: string; sources: Array<{ title: string; uri: string }> }> {
    if (!funderName) {
      return { summary: "No funder name available for research.", sources: [] };
    }

    // Prefer Gemini grounding for synthesized intel
    if (this.searchService.isGroundingAvailable()) {
      const prompt =
        `Research the funder "${funderName}"${programName ? ` and their program "${programName}"` : ""}. ` +
        `Focus on:\n` +
        `1. Their mission and strategic priorities\n` +
        `2. Types of organizations and programs they typically fund\n` +
        `3. Geographic focus areas\n` +
        `4. Grant sizes and funding cycles\n` +
        `5. Past grants to education NGOs in India (especially Bihar)\n` +
        `Be specific and cite sources where possible. ` +
        `If this is a lesser-known funder, say so honestly.`;

      const result = await this.searchService.searchGrounded(prompt);
      if (result.answer) {
        return { summary: result.answer, sources: result.sources };
      }
    }

    // Fallback: structured search
    const results = await this.searchService.search(
      `"${funderName}" ${programName} grant funding priorities India education`,
      5,
    );
    const summary = results.length > 0
      ? results.map((r) => `- ${r.title}: ${r.snippet}`).join("\n")
      : "No web results found for this funder.";

    return {
      summary,
      sources: results.map((r) => ({ title: r.title, uri: r.url })),
    };
  }

  private async researchComparables(
    themes: string[],
    geography: string,
  ): Promise<{ summary: string; sources: Array<{ title: string; uri: string }> }> {
    if (themes.length === 0) {
      return { summary: "No themes available for comparable program research.", sources: [] };
    }

    const topThemes = themes.slice(0, 3).join(", ");

    if (this.searchService.isGroundingAvailable()) {
      const prompt =
        `Find comparable NGO programs in ${geography} working on: ${topThemes}. ` +
        `For each program found, describe:\n` +
        `1. Organization name and program name\n` +
        `2. Key outcomes and impact metrics\n` +
        `3. Target demographics\n` +
        `4. Scale (number of beneficiaries, centers, etc.)\n` +
        `Focus on programs similar to Diksha Foundation (education, sports-for-development, girls empowerment in Bihar).`;

      const result = await this.searchService.searchGrounded(prompt);
      if (result.answer) {
        return { summary: result.answer, sources: result.sources };
      }
    }

    const results = await this.searchService.search(
      `${topThemes} NGO program outcomes ${geography} impact evaluation`,
      5,
    );
    const summary = results.length > 0
      ? results.map((r) => `- ${r.title}: ${r.snippet}`).join("\n")
      : "No comparable programs found via web search.";

    return {
      summary,
      sources: results.map((r) => ({ title: r.title, uri: r.url })),
    };
  }

  private async researchThemeEvidence(
    themes: string[],
    geography: string,
  ): Promise<{ summary: string; sources: Array<{ title: string; uri: string }> }> {
    if (themes.length === 0) {
      return { summary: "No themes available for evidence search.", sources: [] };
    }

    const topThemes = themes.slice(0, 3).join(", ");

    if (this.searchService.isGroundingAvailable()) {
      const prompt =
        `Find evidence and research supporting ${topThemes} interventions in ${geography}. ` +
        `Include:\n` +
        `1. Published impact evaluations or RCTs\n` +
        `2. Government reports or policy documents\n` +
        `3. Best practice guidelines from UNICEF, UNESCO, or similar bodies\n` +
        `4. Outcome statistics (enrollment, learning outcomes, participation rates)\n` +
        `Focus on evidence relevant to children, youth, and marginalized communities.`;

      const result = await this.searchService.searchGrounded(prompt);
      if (result.answer) {
        return { summary: result.answer, sources: result.sources };
      }
    }

    const results = await this.searchService.search(
      `${topThemes} evidence impact evaluation ${geography} children youth`,
      5,
    );
    const summary = results.length > 0
      ? results.map((r) => `- ${r.title}: ${r.snippet}`).join("\n")
      : "No theme evidence found via web search.";

    return {
      summary,
      sources: results.map((r) => ({ title: r.title, uri: r.url })),
    };
  }
}
