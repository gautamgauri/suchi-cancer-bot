import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { EvidenceChunk } from "../../core_ai/types";
import { SECTION_WRITER_SYSTEM_PROMPT, buildSectionWriterUserPrompt } from "../prompts/section-writer.prompt";

@Injectable()
export class SectionWriterService {
  private readonly logger = new Logger(SectionWriterService.name);

  constructor(private readonly llm: FundingLlmService) {}

  /**
   * Draft a section using retrieved evidence chunks with citation markers.
   * Returns draft text with [citation:docId:chunkId] markers and list of gaps.
   */
  async draftSection(params: {
    sectionName: string;
    sectionGuidance: string;
    chunks: EvidenceChunk[];
  }): Promise<{ draftText: string; gaps: string[] }> {
    if (params.chunks.length === 0) {
      return {
        draftText: `## ${params.sectionName}\n\n{{MISSING: Evidence required for ${params.sectionName}}}`,
        gaps: [`No evidence retrieved for ${params.sectionName}`],
      };
    }

    // Format chunks as [S1], [S2], etc. with citation markers
    const chunksList = params.chunks
      .map((chunk, idx) => {
        const marker = `[S${idx + 1}]`;
        const citation = `[citation:${chunk.docId}:${chunk.chunkId}]`;
        return `${marker} ${chunk.content.substring(0, 800)}${chunk.content.length > 800 ? "..." : ""} (source: ${chunk.document.title || chunk.docId}, citation: ${citation})`;
      })
      .join("\n\n");

    const userPrompt = buildSectionWriterUserPrompt({
      sectionName: params.sectionName,
      sectionGuidance: params.sectionGuidance,
      chunksList,
    });

    try {
      const draftText = await this.llm.generatePlain(
        SECTION_WRITER_SYSTEM_PROMPT,
        "Draft the section:",
        userPrompt,
      );

      // Extract gaps from {{MISSING: ...}} placeholders
      const gapMatches = draftText.match(/\{\{MISSING:\s*([^}]+)\}\}/gi);
      const gaps = gapMatches ? gapMatches.map((m) => m.replace(/\{\{MISSING:\s*|\}\}/gi, "").trim()) : [];

      return { draftText, gaps };
    } catch (e) {
      this.logger.error("Failed to draft section", (e as Error).message);
      return {
        draftText: `## ${params.sectionName}\n\nError generating draft: ${(e as Error).message}`,
        gaps: [`Drafting failed: ${(e as Error).message}`],
      };
    }
  }
}
