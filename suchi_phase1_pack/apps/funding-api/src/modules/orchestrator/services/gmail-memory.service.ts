import { Injectable, Logger } from "@nestjs/common";
import type { GmailMemoryResult, ReusableBlock } from "../orchestrator.types";
import { GmailClientService } from "../../gmail/gmail-client.service";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import type { OpportunityPayload } from "../../opportunity/opportunity.types";

/**
 * Searches past Gmail threads for reusable proposal content.
 *
 * Flow:
 *   1. Build search queries from opportunity funder name + themes
 *   2. Fetch matching Gmail threads via GmailClientService
 *   3. Ask LLM to extract reusable blocks (org descriptions, outcome stats, etc.)
 *   4. Return scored blocks for injection into section writers
 */
@Injectable()
export class GmailMemoryService {
  private readonly logger = new Logger(GmailMemoryService.name);

  constructor(
    private readonly gmailClient: GmailClientService,
    private readonly llm: FundingLlmService,
  ) {}

  async search(payload: OpportunityPayload): Promise<GmailMemoryResult> {
    if (!this.gmailClient.isConfigured()) {
      this.logger.warn("Gmail not configured — skipping memory search");
      return { blocksFound: 0, blocks: [], searchQueries: [], searched: false };
    }

    const queries = this.buildSearchQueries(payload);
    if (queries.length === 0) {
      return { blocksFound: 0, blocks: [], searchQueries: [], searched: false };
    }

    const allBlocks: ReusableBlock[] = [];

    for (const query of queries) {
      try {
        const blocks = await this.searchAndExtract(query);
        allBlocks.push(...blocks);
      } catch (err) {
        this.logger.warn(`Gmail search failed for "${query}": ${(err as Error).message}`);
      }
    }

    // Deduplicate by content similarity (simple: skip if > 80% overlap)
    const deduped = this.deduplicateBlocks(allBlocks);

    // Sort by relevance score descending, keep top 10
    deduped.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topBlocks = deduped.slice(0, 10);

    this.logger.log(
      `Gmail memory: ${queries.length} queries → ${allBlocks.length} raw blocks → ${topBlocks.length} after dedup`,
    );

    return {
      blocksFound: topBlocks.length,
      blocks: topBlocks,
      searchQueries: queries,
      searched: true,
    };
  }

  private buildSearchQueries(payload: OpportunityPayload): string[] {
    const queries: string[] = [];
    const funderName = payload.funder?.name;
    const themes = [
      ...(payload.themes?.primary ?? []),
      ...(payload.themes?.secondary ?? []),
    ];

    // Query 1: direct funder name
    if (funderName) {
      queries.push(`from:me ${funderName} proposal`);
    }

    // Query 2: funder + program name
    if (funderName && payload.funder?.programName) {
      queries.push(`${funderName} ${payload.funder.programName}`);
    }

    // Query 3: theme-based (top 3 themes)
    if (themes.length > 0) {
      const themeQuery = themes.slice(0, 3).join(" OR ");
      queries.push(`from:me (${themeQuery}) Diksha`);
    }

    // Query 4: past proposals sent
    if (funderName) {
      queries.push(`to:${payload.funder?.submissionEmail ?? funderName} has:attachment`);
    }

    return queries.slice(0, 4); // max 4 queries
  }

  private async searchAndExtract(query: string): Promise<ReusableBlock[]> {
    const { messages } = await this.gmailClient.listMessages({
      q: query,
      maxResults: 5,
    });

    if (!messages || messages.length === 0) return [];

    const blocks: ReusableBlock[] = [];

    for (const msg of messages.slice(0, 5)) {
      try {
        const full = await this.gmailClient.getMessage(msg.id);
        const parsed = this.gmailClient.parseMessage(full);

        const bodyText = parsed.bodyPlain || parsed.snippet || "";
        if (bodyText.length < 100) continue; // too short to contain reusable content

        const extracted = await this.extractBlocks(bodyText, parsed.subject, parsed.date);
        blocks.push(...extracted);
      } catch (err) {
        this.logger.warn(`Failed to process message ${msg.id}: ${(err as Error).message}`);
      }
    }

    return blocks;
  }

  private async extractBlocks(
    emailBody: string,
    subject: string,
    date: string,
  ): Promise<ReusableBlock[]> {
    // Truncate very long emails
    const truncated = emailBody.length > 4000 ? emailBody.slice(0, 4000) + "\n[truncated]" : emailBody;

    const systemPrompt = `You are a proposal writing assistant for Diksha Foundation, a Bihar-based NGO.
Extract reusable content blocks from this email that could be repurposed in future proposals.

Look for:
- Organization description paragraphs
- Program outcome statistics and impact numbers
- Theory of change descriptions
- Budget justification language
- Beneficiary stories or testimonials
- M&E methodology descriptions
- Staff capacity descriptions

Return a JSON array of objects with these fields:
- topic: short label (e.g. "org_description", "impact_stats", "theory_of_change", "budget_rationale")
- content: the reusable text block (clean it up but keep substance)
- relevanceScore: 0.0 to 1.0 (how likely this is reusable in other proposals)

Return ONLY the JSON array, no markdown fences. If nothing is reusable, return [].`;

    const context = `Email subject: ${subject}\nDate: ${date}`;

    try {
      const response = await this.llm.generatePlain(systemPrompt, context, truncated, {
        maxTokens: 2000,
      });

      const cleaned = response.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned) as Array<{
        topic: string;
        content: string;
        relevanceScore: number;
      }>;

      return parsed
        .filter((b) => b.content && b.content.length > 50)
        .map((b) => ({
          source: `email:${subject}`,
          topic: b.topic,
          content: b.content,
          relevanceScore: Math.min(1, Math.max(0, b.relevanceScore)),
          date,
        }));
    } catch (err) {
      this.logger.warn(`Block extraction failed for "${subject}": ${(err as Error).message}`);
      return [];
    }
  }

  private deduplicateBlocks(blocks: ReusableBlock[]): ReusableBlock[] {
    const result: ReusableBlock[] = [];

    for (const block of blocks) {
      const isDuplicate = result.some((existing) => {
        const overlap = this.textOverlap(existing.content, block.content);
        return overlap > 0.8;
      });

      if (!isDuplicate) {
        result.push(block);
      }
    }

    return result;
  }

  /** Simple word-level Jaccard overlap */
  private textOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}
