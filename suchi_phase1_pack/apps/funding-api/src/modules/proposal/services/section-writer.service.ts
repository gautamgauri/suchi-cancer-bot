import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { EvidenceChunk } from "../../core_ai/types";
import { ProposalScope } from "../proposal.types";
import { SECTION_WRITER_SYSTEM_PROMPT, buildSectionWriterUserPrompt, getSectionTypeGuidance } from "../prompts/section-writer.prompt";

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
    /** Optional org context for template-based drafting when no evidence is available */
    orgContext?: string;
    /** Funder name + program for context */
    funderContext?: string;
    /** Canonical scope from planner — locks numbers across sections */
    proposalScope?: ProposalScope;
  }): Promise<{ draftText: string; gaps: string[] }> {
    if (params.chunks.length === 0) {
      // Attempt template-based draft using section guidance and org context
      return this.draftFromTemplate(params.sectionName, params.sectionGuidance, params.orgContext);
    }

    // Evidence available — proceed with citation-grounded drafting
    // Format chunks with citation tokens prominently displayed for LLM to copy
    const chunksList = params.chunks
      .map((chunk, idx) => {
        const citation = `[citation:${chunk.docId}:${chunk.chunkId}]`;
        const title = chunk.document?.title || chunk.docId;
        const content = chunk.content.substring(0, 800) + (chunk.content.length > 800 ? "..." : "");
        return `---
CHUNK ${idx + 1}: ${title}
CITATION TOKEN: ${citation}
CONTENT: ${content}
---`;
      })
      .join("\n\n");

    const sectionTypeReqs = getSectionTypeGuidance(params.sectionName);
    const userPrompt = buildSectionWriterUserPrompt({
      sectionName: params.sectionName,
      sectionGuidance: params.sectionGuidance,
      chunksList,
      funderContext: params.funderContext,
      sectionTypeRequirements: sectionTypeReqs ?? undefined,
      orgContext: params.orgContext,
      proposalScope: params.proposalScope,
    });

    try {
      const llmStart = Date.now();
      const draftText = await this.llm.generatePlain(
        SECTION_WRITER_SYSTEM_PROMPT,
        "Draft the section:",
        userPrompt,
      );
      const llmMs = Date.now() - llmStart;

      // Extract gaps from {{MISSING: ...}} placeholders
      const gapMatches = draftText.match(/\{\{MISSING:\s*([^}]+)\}\}/gi);
      const gaps = gapMatches ? gapMatches.map((m) => m.replace(/\{\{MISSING:\s*|\}\}/gi, "").trim()) : [];

      // Count citations in output for debugging
      const citationMatches = draftText.match(/\[citation:[^\]]+\]/g);
      const citationCount = citationMatches ? citationMatches.length : 0;
      this.logger.log({
        section: params.sectionName,
        chunksProvided: params.chunks.length,
        citationsProduced: citationCount,
        gapsDetected: gaps.length,
        draftLength: draftText.length,
        llm_ms: llmMs,
      });

      // Warning if chunks provided but no citations produced
      if (params.chunks.length > 0 && citationCount === 0) {
        this.logger.warn({
          message: "CITATION_LEAK: chunks provided but no citations in output",
          section: params.sectionName,
          chunksProvided: params.chunks.length,
        });
      }

      return { draftText, gaps };
    } catch (e) {
      this.logger.error("Failed to draft section", (e as Error).message);
      return {
        draftText: `## ${params.sectionName}\n\nError generating draft: ${(e as Error).message}`,
        gaps: [`Drafting failed: ${(e as Error).message}`],
      };
    }
  }

  /**
   * Draft a section using LLM general knowledge when no evidence chunks are available.
   * Produces a skeleton draft with clear placeholders where org-specific data is needed.
   */
  private async draftFromTemplate(
    sectionName: string,
    sectionGuidance: string,
    orgContext?: string,
  ): Promise<{ draftText: string; gaps: string[] }> {
    this.logger.log(`No evidence for "${sectionName}" — attempting template-based draft`);
    const orgInfo = orgContext || "Diksha Foundation / SCCF, programs: KHEL, Life Skills, Fellowship, India (Bihar, Delhi)";
    const templatePrompt = `Section: ${sectionName}
Guidance: ${sectionGuidance}
Organization context: ${orgInfo}

Write a professional draft for this proposal section. Since no specific evidence documents are available:
- Use the organization context and section guidance to write relevant content
- Mark any specific statistics, numbers, or claims that need verification with {{VERIFY: description}}
- Mark places where org-specific data should be inserted with {{INSERT: description}}
- Keep the tone professional, funder-facing, India context
- Do NOT invent specific numbers or statistics`;

    try {
      const llmStart = Date.now();
      const draftText = await this.llm.generatePlain(
        "You are a proposal writer. Draft the section using available context. Use {{VERIFY: ...}} and {{INSERT: ...}} placeholders where specific data is needed.",
        "Draft the section:",
        templatePrompt,
      );
      const llmMs = Date.now() - llmStart;
      this.logger.log({ section: sectionName, template: true, llm_ms: llmMs, draftLength: draftText.length });

      // Extract gaps from placeholders
      const verifyMatches = draftText.match(/\{\{(?:VERIFY|INSERT|MISSING):\s*([^}]+)\}\}/gi) || [];
      const gaps = [
        `No evidence retrieved for ${sectionName} — template draft used`,
        ...verifyMatches.map((m) => m.replace(/\{\{(?:VERIFY|INSERT|MISSING):\s*|\}\}/gi, "").trim()),
      ];

      return { draftText, gaps };
    } catch (e) {
      this.logger.error(`Template draft failed for "${sectionName}"`, (e as Error).message);
      return {
        draftText: `## ${sectionName}\n\n{{MISSING: Evidence required for ${sectionName}}}`,
        gaps: [`No evidence retrieved for ${sectionName}`],
      };
    }
  }
}
