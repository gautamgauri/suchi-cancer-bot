import { Injectable, Logger } from "@nestjs/common";
import { GoogleSearchService } from "../../google_search/google-search.service";
import type { OpportunityPayload } from "../../opportunity/opportunity.types";

/**
 * Orchestrator Stage E: Web Evidence Search.
 *
 * Uses Gemini Grounding (Google Search) to research:
 *   - Funder priorities, past grants, and strategic direction
 *   - Comparable programs in similar geographies with outcomes data
 *   - Evidence for outcomes in opportunity themes (RCTs, evaluations, best practices)
 *   - Government data and policy context (Bihar/India specific)
 *
 * Falls back to structured CSE search when grounding is unavailable.
 * All queries are capped at daily free tier limits.
 *
 * Sprint 2: Enhanced prompts with sector-specific framing, government data search,
 * and larger token budgets for downstream section routing.
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
    const targetGroup = payload.keyConstraints?.targetGroup ?? "children and youth from marginalized communities";

    let queriesUsed = 0;

    // Run funder intel + comparables + theme evidence in parallel
    const [funderIntel, comparablePrograms, themeEvidence] = await Promise.all([
      this.researchFunder(funderName, programName, themes),
      this.researchComparables(themes, geography, targetGroup),
      this.researchThemeEvidence(themes, geography, targetGroup),
    ]);
    queriesUsed += 3;

    this.logger.log(
      `Web evidence: ${queriesUsed} queries | funder=${funderIntel.sources.length} sources, ` +
        `comparables=${comparablePrograms.sources.length}, themes=${themeEvidence.sources.length}`,
    );

    return { funderIntel, comparablePrograms, themeEvidence, queriesUsed };
  }

  private async researchFunder(
    funderName: string,
    programName: string,
    themes: string[],
  ): Promise<{ summary: string; sources: Array<{ title: string; uri: string }> }> {
    if (!funderName) {
      return { summary: "No funder name available for research.", sources: [] };
    }

    const themeContext = themes.length > 0 ? ` Their focus areas may include: ${themes.slice(0, 3).join(", ")}.` : "";

    // Prefer Gemini grounding for synthesized intel
    if (this.searchService.isGroundingAvailable()) {
      const prompt =
        `Research the funder "${funderName}"${programName ? ` and their program "${programName}"` : ""}.${themeContext}\n\n` +
        `Provide a STRUCTURED briefing covering:\n` +
        `1. MISSION & STRATEGY: Their stated mission, theory of change, and current strategic priorities (2023-2026)\n` +
        `2. FUNDING PATTERNS: Types of organizations and programs they typically fund, average grant sizes, typical grant duration\n` +
        `3. GEOGRAPHIC FOCUS: Countries, states, and regions they operate in — especially any India/South Asia presence\n` +
        `4. PAST GRANTEES: Specific organizations they have funded in education, child development, or sports-for-development in India\n` +
        `5. APPLICATION INSIGHTS: What they look for in strong applications — any published criteria, scoring rubrics, or grantee advice\n` +
        `6. RED FLAGS: Common reasons applications are rejected (if known)\n\n` +
        `Be specific and factual. Include names, dates, and numbers where available. ` +
        `If this is a lesser-known or private funder with limited public information, say so honestly and note what IS available.`;

      const result = await this.searchService.searchGrounded(prompt);
      if (result.answer) {
        return { summary: result.answer, sources: result.sources };
      }
    }

    // Fallback: multiple structured searches for broader coverage
    const searchQueries = [
      `"${funderName}" ${programName} grant funding priorities India education`,
      `"${funderName}" grantees education NGO India Bihar`,
    ];
    const allResults: Array<{ title: string; snippet: string; url: string }> = [];
    for (const sq of searchQueries) {
      const results = await this.searchService.search(sq, 4);
      allResults.push(...results);
    }

    const deduped = this.deduplicateResults(allResults);
    const summary = deduped.length > 0
      ? deduped.map((r) => `- ${r.title}: ${r.snippet}`).join("\n")
      : "No web results found for this funder.";

    return {
      summary,
      sources: deduped.map((r) => ({ title: r.title, uri: r.url })),
    };
  }

  private async researchComparables(
    themes: string[],
    geography: string,
    targetGroup: string,
  ): Promise<{ summary: string; sources: Array<{ title: string; uri: string }> }> {
    if (themes.length === 0) {
      return { summary: "No themes available for comparable program research.", sources: [] };
    }

    const topThemes = themes.slice(0, 3).join(", ");

    if (this.searchService.isGroundingAvailable()) {
      const prompt =
        `Find comparable NGO programs working on ${topThemes} in ${geography} or similar Indian states, targeting ${targetGroup}.\n\n` +
        `For each program found, provide a STRUCTURED profile:\n` +
        `1. ORGANIZATION & PROGRAM: Name, location, year started\n` +
        `2. MODEL: How it works — delivery method, frequency, staffing structure\n` +
        `3. SCALE: Number of beneficiaries, centers/sites, geographic coverage\n` +
        `4. OUTCOMES: Specific measured outcomes with numbers (e.g., "23% improvement in literacy scores", "85% attendance rate")\n` +
        `5. SUSTAINABILITY: How they sustain after grant period, funding mix, government integration\n` +
        `6. COST: Per-beneficiary cost if available\n\n` +
        `Prioritize programs similar to Diksha Foundation's approach: education + sports-for-development + life skills, ` +
        `hub-and-spoke center model, serving marginalized children in Bihar.\n` +
        `Include: Pratham, Teach For India, Magic Bus, Oscar Foundation, Slum Soccer, CAP Foundation, ` +
        `or any other relevant education/sports NGO in India — but only if they have published outcomes data.`;

      const result = await this.searchService.searchGrounded(prompt);
      if (result.answer) {
        return { summary: result.answer, sources: result.sources };
      }
    }

    const results = await this.searchService.search(
      `${topThemes} NGO program outcomes India ${geography} impact evaluation beneficiaries`,
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
    targetGroup: string,
  ): Promise<{ summary: string; sources: Array<{ title: string; uri: string }> }> {
    if (themes.length === 0) {
      return { summary: "No themes available for evidence search.", sources: [] };
    }

    const topThemes = themes.slice(0, 3).join(", ");

    if (this.searchService.isGroundingAvailable()) {
      const prompt =
        `Find research evidence and data supporting ${topThemes} interventions for ${targetGroup} in ${geography}.\n\n` +
        `Provide evidence in these categories:\n` +
        `1. IMPACT EVALUATIONS: Published RCTs, quasi-experimental studies, or systematic reviews showing effectiveness of ${topThemes} interventions\n` +
        `2. GOVERNMENT DATA: Bihar state education statistics — enrollment rates, dropout rates, learning levels (ASER/NAS data), ` +
        `gender parity index, district-level disparities. Include UDISE+ data if available.\n` +
        `3. POLICY FRAMEWORK: How these themes align with NEP 2020, Bihar state education policy, NIPUN Bharat (FLN), ` +
        `SDG 4 (Quality Education), SDG 5 (Gender Equality), and any Bihar-specific schemes ` +
        `(Bihar Khel Niti, Mukhyamantri Kanya Utthan Yojana, Mukhyamantri Khel Vikas Yojana)\n` +
        `4. BEST PRACTICES: Guidelines from UNICEF, UNESCO, World Bank, or Indian government bodies (NCERT, NITI Aayog) ` +
        `on implementing ${topThemes} programs for marginalized communities\n` +
        `5. BASELINE STATISTICS: Current state of education/child development in Bihar — ` +
        `literacy rates, out-of-school children, digital access, sports infrastructure gaps\n\n` +
        `Be specific: include exact numbers, dates, and sources. ` +
        `Distinguish between national and Bihar-specific data where possible.`;

      const result = await this.searchService.searchGrounded(prompt);
      if (result.answer) {
        return { summary: result.answer, sources: result.sources };
      }
    }

    // Fallback: multiple targeted searches
    const searchQueries = [
      `${topThemes} evidence impact evaluation ${geography} children youth RCT`,
      `Bihar education statistics dropout enrollment literacy ASER UDISE`,
    ];
    const allResults: Array<{ title: string; snippet: string; url: string }> = [];
    for (const sq of searchQueries) {
      const results = await this.searchService.search(sq, 4);
      allResults.push(...results);
    }

    const deduped = this.deduplicateResults(allResults);
    const summary = deduped.length > 0
      ? deduped.map((r) => `- ${r.title}: ${r.snippet}`).join("\n")
      : "No theme evidence found via web search.";

    return {
      summary,
      sources: deduped.map((r) => ({ title: r.title, uri: r.url })),
    };
  }

  /**
   * Deduplicate search results by URL.
   */
  private deduplicateResults(
    results: Array<{ title: string; snippet: string; url: string }>,
  ): Array<{ title: string; snippet: string; url: string }> {
    const seen = new Set<string>();
    return results.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
  }
}
