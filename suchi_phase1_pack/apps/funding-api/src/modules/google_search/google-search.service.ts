import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google } from "googleapis";
import {
  GoogleGenerativeAI,
  type GroundingChunk,
  type Tool,
} from "@google/generative-ai";

/**
 * Unified search service with three backends and free-tier caps:
 *
 *   1. CSE (Google Custom Search Engine) — structured results (title, snippet, URL).
 *      Free tier: 100 queries/day. Uses `googleapis` (already installed).
 *
 *   2. SerpAPI — structured Google results via third-party API.
 *      Free tier: 100 searches/month. Fallback when CSE limit is hit.
 *
 *   3. Gemini Grounding — model-synthesized answer with source citations.
 *      Uses existing `@google/generative-ai` SDK's `googleSearchRetrieval` tool.
 *      Free tier: ~1,500 grounded queries/day.
 *
 * All modes enforce free-tier caps via in-memory counters that reset at midnight IST.
 *
 * The `search()` method auto-selects: CSE first, SerpAPI fallback, then empty.
 */

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
  displayUrl?: string;
  source: "cse" | "serpapi";
}

export interface GroundedSearchResult {
  answer: string;
  searchQueries: string[];
  sources: Array<{ title: string; uri: string }>;
}

interface SerpApiResponse {
  organic_results?: Array<{
    link?: string;
    title?: string;
    snippet?: string;
    displayed_link?: string;
  }>;
}

@Injectable()
export class GoogleSearchService {
  private readonly logger = new Logger(GoogleSearchService.name);

  // CSE config
  private readonly cseApiKey: string | undefined;
  private readonly cseEngineId: string | undefined;
  private readonly cseConfigured: boolean;

  // SerpAPI config
  private readonly serpApiKey: string | undefined;
  private readonly serpConfigured: boolean;

  // Gemini grounding config
  private readonly geminiApiKey: string | undefined;
  private readonly geminiModel: string;
  private readonly geminiConfigured: boolean;

  // Rate limit counters
  private cseUsedToday = 0;
  private serpUsedThisMonth = 0;
  private geminiUsedToday = 0;
  private lastDayReset = "";
  private lastMonthReset = "";

  // Free tier limits
  private readonly CSE_DAILY_LIMIT = 100;
  private readonly SERP_MONTHLY_LIMIT = 100;
  private readonly GEMINI_DAILY_LIMIT = 1500;

  constructor(private readonly configService: ConfigService) {
    // CSE
    this.cseApiKey = this.configService.get<string>("FUNDING_CSE_API_KEY");
    this.cseEngineId = this.configService.get<string>("FUNDING_CSE_ENGINE_ID");
    this.cseConfigured = !!(this.cseApiKey && this.cseEngineId);

    // SerpAPI
    this.serpApiKey = this.configService.get<string>("FUNDING_SERPAPI_KEY");
    this.serpConfigured = !!this.serpApiKey;

    // Gemini grounding
    this.geminiApiKey =
      this.configService.get<string>("FUNDING_GEMINI_API_KEY") ??
      this.configService.get<string>("FUNDING_EMBEDDINGS_API_KEY");
    this.geminiModel = this.configService.get<string>("FUNDING_GEMINI_GROUNDING_MODEL") ?? "gemini-2.0-flash";
    this.geminiConfigured = !!this.geminiApiKey;

    const backends = [
      this.cseConfigured && "CSE",
      this.serpConfigured && "SerpAPI",
      this.geminiConfigured && "Gemini",
    ].filter(Boolean);
    this.logger.log(`Search backends: ${backends.join(", ") || "none configured"}`);

    this.resetCounters();
  }

  // ────────────────────────────────────────────────────────────────
  //  Unified structured search (CSE → SerpAPI fallback)
  // ────────────────────────────────────────────────────────────────

  /**
   * Search the web for structured results (title, snippet, URL).
   * Auto-selects backend: CSE first, SerpAPI fallback if CSE exhausted.
   */
  async search(query: string, num = 10): Promise<WebSearchResult[]> {
    this.resetCounters();

    // Try CSE first
    if (this.cseConfigured && this.cseUsedToday < this.CSE_DAILY_LIMIT) {
      const results = await this.searchCse(query, num);
      if (results.length > 0) return results;
    }

    // Fallback to SerpAPI
    if (this.serpConfigured && this.serpUsedThisMonth < this.SERP_MONTHLY_LIMIT) {
      return this.searchSerp(query, num);
    }

    this.logger.warn(`All structured search backends exhausted for: "${query.slice(0, 60)}"`);
    return [];
  }

  /** Remaining structured search capacity (CSE + SerpAPI combined) */
  get structuredSearchRemaining(): number {
    this.resetCounters();
    const cse = this.cseConfigured ? Math.max(0, this.CSE_DAILY_LIMIT - this.cseUsedToday) : 0;
    const serp = this.serpConfigured ? Math.max(0, this.SERP_MONTHLY_LIMIT - this.serpUsedThisMonth) : 0;
    return cse + serp;
  }

  /** Remaining Gemini grounding queries today */
  get geminiRemaining(): number {
    this.resetCounters();
    return this.geminiConfigured ? Math.max(0, this.GEMINI_DAILY_LIMIT - this.geminiUsedToday) : 0;
  }

  isGroundingAvailable(): boolean {
    this.resetCounters();
    return this.geminiConfigured && this.geminiUsedToday < this.GEMINI_DAILY_LIMIT;
  }

  // ────────────────────────────────────────────────────────────────
  //  Backend 1: Google Custom Search Engine
  // ────────────────────────────────────────────────────────────────

  private async searchCse(query: string, num: number): Promise<WebSearchResult[]> {
    try {
      const customsearch = google.customsearch("v1");
      const res = await customsearch.cse.list({
        auth: this.cseApiKey,
        cx: this.cseEngineId,
        q: query,
        num: Math.min(num, 10),
      });

      this.cseUsedToday++;
      const items = res.data.items ?? [];

      this.logger.log(
        `CSE [${this.cseUsedToday}/${this.CSE_DAILY_LIMIT}]: "${query.slice(0, 50)}" → ${items.length} results`,
      );

      return items.map((item) => ({
        title: item.title ?? "",
        snippet: item.snippet ?? "",
        url: item.link ?? "",
        displayUrl: item.displayLink ?? undefined,
        source: "cse" as const,
      }));
    } catch (err) {
      this.logger.error(`CSE search failed: ${(err as Error).message}`);
      return [];
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  Backend 2: SerpAPI (fallback)
  // ────────────────────────────────────────────────────────────────

  private async searchSerp(query: string, num: number): Promise<WebSearchResult[]> {
    try {
      const url = new URL("https://serpapi.com/search");
      url.searchParams.set("engine", "google");
      url.searchParams.set("q", query);
      url.searchParams.set("api_key", this.serpApiKey!);
      url.searchParams.set("num", String(Math.min(num, 10)));

      const res = await fetch(url.toString());
      if (!res.ok) {
        this.logger.warn(`SerpAPI request failed: ${res.status}`);
        return [];
      }

      this.serpUsedThisMonth++;
      const json = (await res.json()) as SerpApiResponse;
      const organic = json.organic_results ?? [];

      this.logger.log(
        `SerpAPI [${this.serpUsedThisMonth}/${this.SERP_MONTHLY_LIMIT}/mo]: "${query.slice(0, 50)}" → ${organic.length} results`,
      );

      return organic
        .filter((item) => item.link)
        .map((item) => ({
          title: item.title ?? "",
          snippet: item.snippet ?? "",
          url: item.link!,
          displayUrl: item.displayed_link ?? undefined,
          source: "serpapi" as const,
        }));
    } catch (err) {
      this.logger.error(`SerpAPI search failed: ${(err as Error).message}`);
      return [];
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  Backend 3: Gemini Grounding (model-synthesized + sources)
  // ────────────────────────────────────────────────────────────────

  /**
   * Ask Gemini to research a topic using Google Search grounding.
   * Returns the model's synthesized answer plus source URLs.
   * Capped at 1,500 queries/day (free tier).
   */
  async searchGrounded(prompt: string): Promise<GroundedSearchResult> {
    this.resetCounters();

    if (!this.geminiConfigured) {
      this.logger.warn("Gemini grounding not configured — returning empty result");
      return { answer: "", searchQueries: [], sources: [] };
    }

    if (this.geminiUsedToday >= this.GEMINI_DAILY_LIMIT) {
      this.logger.warn(
        `Gemini grounding daily limit reached (${this.GEMINI_DAILY_LIMIT}/day). Query skipped.`,
      );
      return { answer: "", searchQueries: [], sources: [] };
    }

    try {
      const genAI = new GoogleGenerativeAI(this.geminiApiKey!);
      // Gemini 2.0+ uses "google_search" tool (not "googleSearchRetrieval").
      // The @google/generative-ai v0.24.1 SDK types don't include this field,
      // so we cast to bypass TypeScript while sending the correct wire format.
      const model = genAI.getGenerativeModel({
        model: this.geminiModel,
        tools: [{ googleSearch: {} } as unknown as Tool],
      });

      const result = await model.generateContent(prompt);
      this.geminiUsedToday++;

      const response = result.response;
      const candidate = response.candidates?.[0];
      const metadata = candidate?.groundingMetadata;

      const answer = response.text() ?? "";
      const searchQueries: string[] =
        (metadata as unknown as Record<string, unknown>)?.webSearchQueries as string[] ?? [];
      const chunks: GroundingChunk[] = metadata?.groundingChunks ?? [];

      const sources = chunks
        .filter((c) => c.web?.uri)
        .map((c) => ({
          title: c.web?.title ?? "",
          uri: c.web!.uri!,
        }));

      this.logger.log(
        `Gemini grounding [${this.geminiUsedToday}/${this.GEMINI_DAILY_LIMIT}]: ` +
          `${answer.length} chars, ${sources.length} sources`,
      );

      return { answer, searchQueries, sources };
    } catch (err) {
      this.logger.error(`Gemini grounding failed: ${(err as Error).message}`);
      return { answer: "", searchQueries: [], sources: [] };
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  Counter management
  // ────────────────────────────────────────────────────────────────

  private resetCounters(): void {
    const now = new Date();
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const istDate = new Date(istMs).toISOString().split("T")[0];
    const istMonth = istDate.slice(0, 7); // YYYY-MM

    // Daily reset (CSE + Gemini)
    if (istDate !== this.lastDayReset) {
      if (this.lastDayReset) {
        this.logger.log(
          `Daily reset (IST): CSE ${this.cseUsedToday}, Gemini ${this.geminiUsedToday}`,
        );
      }
      this.cseUsedToday = 0;
      this.geminiUsedToday = 0;
      this.lastDayReset = istDate;
    }

    // Monthly reset (SerpAPI)
    if (istMonth !== this.lastMonthReset) {
      if (this.lastMonthReset) {
        this.logger.log(`Monthly reset (IST): SerpAPI ${this.serpUsedThisMonth}`);
      }
      this.serpUsedThisMonth = 0;
      this.lastMonthReset = istMonth;
    }
  }
}
