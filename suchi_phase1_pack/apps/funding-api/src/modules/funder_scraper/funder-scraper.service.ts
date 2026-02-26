import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { GoogleSearchService } from "../google_search/google-search.service";
import { FunderFactDto, FunderOrgRecord, SerpApiResultUrl } from "./funder-scraper.types";
import * as cheerio from "cheerio";

@Injectable()
export class FunderScraperService {
  private readonly logger = new Logger(FunderScraperService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly searchService: GoogleSearchService,
  ) {
    this.enabled = this.configService.get<string>("FUNDING_FUNDER_SCRAPER_ENABLED") === "true";
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async scrapeOrg(org: FunderOrgRecord): Promise<FunderFactDto[]> {
    if (!this.enabled) {
      this.logger.warn(`Funder scraper disabled; skipping org ${org.orgName}`);
      return [];
    }

    const candidates = await this.discoverCandidateUrls(org);
    if (candidates.length === 0) {
      this.logger.warn(`No candidate URLs found for ${org.orgName}`);
      return [
        {
          org_name: org.orgName,
          org_website: org.orgWebsite,
          network: org.network,
          funder_name: null,
          funder_type: "Other",
          evidence_type: "Org site scan – no donors found",
          evidence_excerpt: "No explicit donors/supporters pages discovered via search.",
          evidence_url: org.orgWebsite,
          financial_amount: null,
          grant_years: null,
          program_focus: null,
          geography: null,
          confidence_score: "Low",
          notes: "No donor pages discovered; consider manual review.",
          normalized_funder: null,
          match_confidence: 0.2,
        },
      ];
    }

    const results: FunderFactDto[] = [];

    for (const candidate of candidates) {
      try {
        const html = await this.fetchHtml(candidate.url);
        if (!html) continue;
        const pageFacts = this.extractFundersFromHtml(org, candidate, html);
        results.push(...pageFacts);
      } catch (e) {
        this.logger.warn(
          `Failed to scrape candidate URL for ${org.orgName}: ${candidate.url} - ${(e as Error).message}`,
        );
      }
    }

    if (results.length === 0) {
      return [
        {
          org_name: org.orgName,
          org_website: org.orgWebsite,
          network: org.network,
          funder_name: null,
          funder_type: "Other",
          evidence_type: "Org site scan – no donors found",
          evidence_excerpt: "Scanned candidate pages but did not find explicit donor/funder listings.",
          evidence_url: candidates[0]?.url ?? org.orgWebsite,
          financial_amount: null,
          grant_years: null,
          program_focus: null,
          geography: null,
          confidence_score: "Low",
          notes: "No explicit donors listed; verify manually if needed.",
          normalized_funder: null,
          match_confidence: 0.25,
        },
      ];
    }

    return results.slice(0, 15);
  }

  private async discoverCandidateUrls(org: FunderOrgRecord): Promise<SerpApiResultUrl[]> {
    const domain = this.extractDomain(org.orgWebsite);
    const queries = [
      `"${org.orgName}" donors`,
      `"${org.orgName}" supporters`,
      `"${org.orgName}" partners`,
      `"${org.orgName}" annual report`,
      domain ? `site:${domain} donors OR supporters OR partners` : "",
    ].filter(Boolean) as string[];

    const results: SerpApiResultUrl[] = [];

    for (const query of queries) {
      try {
        // Use unified search (CSE → SerpAPI fallback, both free-tier capped)
        const searchResults = await this.searchService.search(query, 10);
        for (const item of searchResults) {
          const linkDomain = this.extractDomain(item.url);
          const source: "org_site" | "external" =
            domain && linkDomain && linkDomain.endsWith(domain) ? "org_site" : "external";
          const lower = (item.url + " " + item.title).toLowerCase();
          if (
            !lower.includes("donor") &&
            !lower.includes("supporter") &&
            !lower.includes("partner") &&
            !lower.includes("annual report") &&
            !lower.includes("financial") &&
            source === "external"
          ) {
            continue;
          }
          results.push({ url: item.url, title: item.title, source, query });
        }
      } catch (e) {
        this.logger.warn(`Search error for query "${query}": ${(e as Error).message}`);
      }
    }

    const seen = new Set<string>();
    const deduped: SerpApiResultUrl[] = [];
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      deduped.push(r);
    }

    const sorted = deduped.sort((a, b) => {
      if (a.source === b.source) return 0;
      return a.source === "org_site" ? -1 : 1;
    });

    return sorted.slice(0, 5);
  }

  private async fetchHtml(url: string): Promise<string | null> {
    const res = await fetch(url);
    if (!res.ok) {
      this.logger.warn(`Failed to fetch HTML from ${url}: ${res.status}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      this.logger.warn(`Skipping non-HTML content at ${url}: ${contentType}`);
      return null;
    }
    return await res.text();
  }

  private extractFundersFromHtml(
    org: FunderOrgRecord,
    candidate: SerpApiResultUrl,
    html: string,
  ): FunderFactDto[] {
    const $ = cheerio.load(html);
    const results: FunderFactDto[] = [];

    const headingSelectors = "h1,h2,h3,h4";
    $(headingSelectors).each((_, elem) => {
      const headingText = $(elem).text().trim();
      const lower = headingText.toLowerCase();
      if (
        !lower.includes("donor") &&
        !lower.includes("supporter") &&
        !lower.includes("partner") &&
        !lower.includes("funder") &&
        !lower.includes("sponsor")
      ) {
        return;
      }

      const sectionRoot = $(elem).parent();

      sectionRoot.find("ul, ol").each((_, list) => {
        $(list).find("li").each((__, li) => {
        const text = $(li).text().trim();
        const linkText = $(li).find("a").first().text().trim();
        const name = linkText || text.split("–")[0].split("-")[0].trim();
        if (!name) return;
        const funder = this.buildFunderFactFromText(org, candidate, name, text, headingText);
        results.push(funder);
        });
      });

      sectionRoot.find("table").each((__, table) => {
        const headers: string[] = [];
        $(table)
          .find("thead tr th")
          .each((___, th) => {
            headers.push($(th).text().trim().toLowerCase());
          });
        $(table)
          .find("tbody tr")
          .each((___, tr) => {
            const cells: string[] = [];
            $(tr)
              .find("td")
              .each((____, td) => {
                cells.push($(td).text().trim());
              });
            if (cells.length === 0) return;
            const nameIdx =
              headers.findIndex((h) => h.includes("donor") || h.includes("funder") || h.includes("supporter")) ?? 0;
            const name = cells[nameIdx >= 0 ? nameIdx : 0];
            if (!name) return;
            const rowText = cells.join(" | ");
            const funder = this.buildFunderFactFromText(org, candidate, name, rowText, headingText);
            results.push(funder);
          });
      });
    });

    return results;
  }

  private buildFunderFactFromText(
    org: FunderOrgRecord,
    candidate: SerpApiResultUrl,
    rawName: string,
    context: string,
    heading: string,
  ): FunderFactDto {
    const funderName = rawName.trim();
    const normalized = this.normalizeFunderName(funderName);
    const funderType = this.inferFunderType(funderName);
    const evidenceType =
      candidate.source === "org_site"
        ? "Org website – donors/partners section"
        : "External site – donors/partners section";

    const financialAmount = this.extractAmount(context);
    const grantYears = this.extractYears(context);
    const programFocus = this.extractProgramFocus(context);
    const geography = this.extractGeography(context);

    const { confidenceScore, matchConfidence } = this.inferConfidence(heading, candidate, financialAmount);

    const excerpt = context.length > 280 ? `${context.slice(0, 277)}...` : context;

    return {
      org_name: org.orgName,
      org_website: org.orgWebsite,
      network: org.network,
      funder_name: funderName,
      funder_type: funderType,
      evidence_type: `${evidenceType} (${heading})`,
      evidence_excerpt: excerpt,
      evidence_url: candidate.url,
      financial_amount: financialAmount,
      grant_years: grantYears,
      program_focus: programFocus,
      geography: geography,
      confidence_score: confidenceScore,
      notes: null,
      normalized_funder: normalized,
      match_confidence: matchConfidence,
    };
  }

  private extractDomain(url: string): string | null {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }

  private normalizeFunderName(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const cleaned = trimmed.replace(/\s+/g, " ");
    return cleaned
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  private inferFunderType(name: string): FunderFactDto["funder_type"] {
    const lower = name.toLowerCase();
    if (lower.includes("bank") || lower.includes("ltd") || lower.includes("pvt") || lower.includes("limited")) {
      return "CSR";
    }
    if (lower.includes("foundation") || lower.includes("trust") || lower.includes("philant") || lower.includes("fund")) {
      return "Foundation";
    }
    if (lower.includes("gov") || lower.includes("ministry") || lower.includes("department")) {
      return "Gov";
    }
    if (lower.includes("unicef") || lower.includes("unesco") || lower.includes("world bank") || lower.includes("un ")) {
      return "Multilateral";
    }
    return "Other";
  }

  private extractAmount(text: string): string | null {
    const match = text.match(/(?:₹|INR|Rs\.?|USD|\$)\s?[0-9][0-9,.]*/i);
    return match ? match[0].trim() : null;
  }

  private extractYears(text: string): string | null {
    const match = text.match(/20[0-9]{2}\s?(?:–|-|to)\s?20[0-9]{2}/);
    return match ? match[0].trim() : null;
  }

  private extractProgramFocus(text: string): string | null {
    const lower = text.toLowerCase();
    if (lower.includes("education") || lower.includes("school") || lower.includes("learning")) {
      return "education / learning";
    }
    if (lower.includes("life skills") || lower.includes("21st-century") || lower.includes("21st century")) {
      return "life skills / 21st-century skills";
    }
    if (lower.includes("community") || lower.includes("development")) {
      return "community development";
    }
    return null;
  }

  private extractGeography(text: string): string | null {
    const lower = text.toLowerCase();
    if (lower.includes("bihar")) return "Bihar";
    if (lower.includes("delhi")) return "Delhi";
    if (lower.includes("india")) return "India";
    return null;
  }

  private inferConfidence(
    heading: string,
    candidate: SerpApiResultUrl,
    hasAmount: string | null,
  ): { confidenceScore: FunderFactDto["confidence_score"]; matchConfidence: number } {
    const lower = heading.toLowerCase();
    const isDonorHeading =
      lower.includes("donor") || lower.includes("supporter") || lower.includes("funder") || lower.includes("sponsor");
    const isOrgSite = candidate.source === "org_site";

    if (isDonorHeading && isOrgSite && hasAmount) {
      return { confidenceScore: "High", matchConfidence: 0.9 };
    }
    if (isDonorHeading && isOrgSite) {
      return { confidenceScore: "High", matchConfidence: 0.82 };
    }
    if (isDonorHeading && !isOrgSite) {
      return { confidenceScore: "Medium", matchConfidence: 0.7 };
    }
    return { confidenceScore: "Low", matchConfidence: 0.4 };
  }
}
