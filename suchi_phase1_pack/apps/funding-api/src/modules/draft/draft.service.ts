import { Injectable } from "@nestjs/common";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import { EvidenceChunk } from "../core_ai/types";
import { ChunkDto, ConversationContextDto, EmailTemplate, PipelineContextDto } from "./dto";

@Injectable()
export class DraftService {
  constructor(private readonly fundingLlm: FundingLlmService) {}

  private mapChunkToEvidenceChunk(chunk: ChunkDto): EvidenceChunk {
    return {
      chunkId: chunk.id,
      docId: chunk.source || chunk.id,
      content: chunk.text,
      document: {
        title: chunk.title ?? "",
        url: chunk.urlOrPath,
        source: chunk.source,
      },
    };
  }

  private buildEmailUserMessage(
    template: EmailTemplate,
    pipelineContext?: PipelineContextDto,
    donorProfileSnippet?: string
  ): string {
    const parts: string[] = [`Generate a ${template.replace(/_/g, " ")} email.`];
    if (pipelineContext) {
      const lines: string[] = [];
      if (pipelineContext.orgName) lines.push(`Organization: ${pipelineContext.orgName}`);
      if (pipelineContext.contactName) lines.push(`Contact: ${pipelineContext.contactName}`);
      if (pipelineContext.stage) lines.push(`Stage: ${pipelineContext.stage}`);
      if (pipelineContext.nextAction) lines.push(`Next action: ${pipelineContext.nextAction}`);
      if (pipelineContext.notes) lines.push(`Notes: ${pipelineContext.notes}`);
      if (lines.length) parts.push("Pipeline context:\n" + lines.join("\n"));
    }
    if (donorProfileSnippet) parts.push("Donor profile (use for personalization):\n" + donorProfileSnippet);
    return parts.join("\n\n");
  }

  async draftNeedStatement(
    context: string,
    userMessage: string,
    chunks: ChunkDto[],
    conversationContext?: ConversationContextDto
  ): Promise<{ text: string }> {
    const mappedChunks: EvidenceChunk[] = chunks.map((c) => this.mapChunkToEvidenceChunk(c));
    const text = await this.fundingLlm.generateWithCitations(
      "draft",
      context,
      userMessage,
      mappedChunks,
      false,
      conversationContext ?? undefined
    );
    return { text };
  }

  async draftEmail(
    template: EmailTemplate,
    context: string,
    pipelineContext?: PipelineContextDto,
    donorProfileSnippet?: string,
    chunks?: ChunkDto[]
  ): Promise<{ text: string }> {
    const userMessage = this.buildEmailUserMessage(template, pipelineContext, donorProfileSnippet);
    if (chunks && chunks.length > 0) {
      const mappedChunks: EvidenceChunk[] = chunks.map((c) => this.mapChunkToEvidenceChunk(c));
      const text = await this.fundingLlm.generateWithCitations(
        "email",
        context,
        userMessage,
        mappedChunks,
        false,
        undefined
      );
      return { text };
    }
    const systemPrompt = this.fundingLlm.getEmailPrompt();
    const text = await this.fundingLlm.generatePlain(systemPrompt, context, userMessage);
    return { text };
  }

  async draftNeedStatementRefine(
    context: string,
    userMessage: string,
    chunks: ChunkDto[],
    conversationContext?: ConversationContextDto
  ): Promise<{ draft: string; evaluation: { score: number; weaknesses: string[] }; refined: string }> {
    const { text: draft } = await this.draftNeedStatement(context, userMessage, chunks, conversationContext);
    const evaluation = await this.fundingLlm.evaluateDraft(draft);
    const evaluationNotes = [
      `Score: ${evaluation.score}/5`,
      ...evaluation.weaknesses.map((w) => `- ${w}`),
    ].join("\n");
    const refined = await this.fundingLlm.refineDraft(draft, evaluationNotes);
    return {
      draft,
      evaluation: { score: evaluation.score, weaknesses: evaluation.weaknesses },
      refined,
    };
  }
}
