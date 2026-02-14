import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import { EvidenceChunk } from "../core_ai/types";
import { SourceRegistryService } from "../source_registry/source-registry.service";
import { EmailNotificationService } from "../notifications/email-notification.service";
import {
  ApprovalContextDto,
  ChunkDto,
  ConversationContextDto,
  EmailTemplate,
  PipelineContextDto,
} from "./dto";
import { logStructured } from "../../common/structured-logger";
import { ApprovalConfirmationContract, ContractActor } from "../contracts/funding-contracts.types";
import { GovernanceDeliveryGuard } from "../notifications/governance-delivery.guard";

@Injectable()
export class DraftService {
  private readonly logger = new Logger(DraftService.name);

  constructor(
    private readonly fundingLlm: FundingLlmService,
    private readonly sourceRegistry: SourceRegistryService,
    private readonly emailNotification: EmailNotificationService,
    private readonly governanceGuard: GovernanceDeliveryGuard
  ) {}

  private mapApproval(approval?: ApprovalContextDto): ApprovalConfirmationContract | undefined {
    if (!approval?.approvalToken) return undefined;
    return {
      approvalToken: approval.approvalToken,
      interactionId: approval.interactionId || "api",
      outcome: approval.outcome || "approved",
      actor: approval.actor || { actorType: "human", actorId: "api_user" },
      reason: approval.reason,
      timestamp: new Date().toISOString(),
    };
  }

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

  private async registerSourcesFromChunks(chunks: EvidenceChunk[]): Promise<void> {
    const byDocId = new Map<string, EvidenceChunk["document"]>();
    for (const c of chunks) {
      if (!byDocId.has(c.docId)) byDocId.set(c.docId, c.document);
    }
    await Promise.all(
      [...byDocId.entries()].map(([docId, doc]) =>
        this.sourceRegistry.upsertFromEvidence({
          docId,
          url: doc.url ?? undefined,
          title: doc.title ?? undefined,
        })
      )
    );
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
    conversationContext?: ConversationContextDto,
    approval?: ApprovalContextDto
  ): Promise<{ text: string; delivery?: { sent: boolean; blocked: boolean; reason?: string; preview?: unknown } }> {
    const startTime = Date.now();
    const mappedChunks: EvidenceChunk[] = chunks.map((c) => this.mapChunkToEvidenceChunk(c));
    await this.registerSourcesFromChunks(mappedChunks);
    const textRaw = await this.fundingLlm.generateWithCitations(
      "draft",
      context,
      userMessage,
      mappedChunks,
      false,
      conversationContext ?? undefined
    );
    const disciplined = this.governanceGuard.enforceNumericClaimDiscipline(textRaw);
    const text = disciplined.text;

    // Count citations in output
    const citationCount = (text.match(/\[citation:[^\]]+\]/g) || []).length;
    const durationMs = Date.now() - startTime;

    logStructured.log("Draft generation complete", {
      context: DraftService.name,
      type: "need_statement",
      chunksUsed: chunks.length,
      outputLength: text.length,
      citationCount,
      durationMs,
    });

    // Send email notification for review
    const title = userMessage.substring(0, 80) + (userMessage.length > 80 ? "..." : "");
    const actor: ContractActor = { actorType: "agent", actorId: "draft_service_need_statement" };
    const delivery = await this.emailNotification.sendGeneratedContent(
      "Need Statement",
      title,
      text,
      this.mapApproval(approval),
      actor
    );

    return { text, delivery: { sent: delivery.sent, blocked: delivery.blocked, reason: delivery.reason, preview: delivery.preview } };
  }

  async draftEmail(
    template: EmailTemplate,
    context: string,
    pipelineContext?: PipelineContextDto,
    donorProfileSnippet?: string,
    chunks?: ChunkDto[],
    approval?: ApprovalContextDto
  ): Promise<{ text: string; delivery?: { sent: boolean; blocked: boolean; reason?: string; preview?: unknown } }> {
    const userMessage = this.buildEmailUserMessage(template, pipelineContext, donorProfileSnippet);
    let text: string;

    if (chunks && chunks.length > 0) {
      const mappedChunks: EvidenceChunk[] = chunks.map((c) => this.mapChunkToEvidenceChunk(c));
      await this.registerSourcesFromChunks(mappedChunks);
      text = await this.fundingLlm.generateWithCitations(
        "email",
        context,
        userMessage,
        mappedChunks,
        false,
        undefined
      );
    } else {
      const systemPrompt = this.fundingLlm.getEmailPrompt();
      text = await this.fundingLlm.generatePlain(systemPrompt, context, userMessage);
    }

    const disciplined = this.governanceGuard.enforceNumericClaimDiscipline(text);
    text = disciplined.text;

    // Send email notification for review
    const templateLabel = template.replace(/_/g, " ");
    const title = `${templateLabel} - ${pipelineContext?.orgName || "Draft"}`;
    const actor: ContractActor = { actorType: "agent", actorId: "draft_service_email" };
    const delivery = await this.emailNotification.sendGeneratedContent(
      "Email Draft",
      title,
      text,
      this.mapApproval(approval),
      actor
    );

    return { text, delivery: { sent: delivery.sent, blocked: delivery.blocked, reason: delivery.reason, preview: delivery.preview } };
  }

  async draftNeedStatementRefine(
    context: string,
    userMessage: string,
    chunks: ChunkDto[],
    conversationContext?: ConversationContextDto,
    approval?: ApprovalContextDto
  ): Promise<{ draft: string; evaluation: { score: number; weaknesses: string[] }; refined: string; warning?: string }> {
    const startTime = Date.now();

    const { text: draft } = await this.draftNeedStatement(
      context,
      userMessage,
      chunks,
      conversationContext,
      approval
    );
    const draftTime = Date.now() - startTime;

    // SAFETY: If the initial draft is an abstention (MISSING_EVIDENCE), do NOT attempt to refine.
    // Refining an abstention would fabricate content, violating the no-fabrication policy.
    if (draft.includes("MISSING_EVIDENCE")) {
      logStructured.log("Draft refinement skipped - abstention detected", {
        context: DraftService.name,
        type: "refine_flow_abstained",
        draftDurationMs: draftTime,
      });
      return {
        draft,
        evaluation: { score: 0, weaknesses: ["Cannot evaluate: no evidence provided"] },
        refined: draft, // Return the abstention as-is
        warning: "Refinement skipped: initial draft abstained due to missing evidence",
      };
    }

    const evaluation = await this.fundingLlm.evaluateDraft(draft);
    const evalTime = Date.now() - startTime - draftTime;

    const evaluationNotes = [
      `Score: ${evaluation.score}/5`,
      ...evaluation.weaknesses.map((w) => `- ${w}`),
    ].join("\n");
    const refinedRaw = await this.fundingLlm.refineDraft(draft, evaluationNotes);
    const refined = this.governanceGuard.enforceNumericClaimDiscipline(refinedRaw).text;
    const refineTime = Date.now() - startTime - draftTime - evalTime;

    logStructured.log("Draft refinement complete", {
      context: DraftService.name,
      type: "refine_flow",
      evalScore: evaluation.score,
      weaknessCount: evaluation.weaknesses.length,
      draftDurationMs: draftTime,
      evalDurationMs: evalTime,
      refineDurationMs: refineTime,
      totalDurationMs: Date.now() - startTime,
    });

    return {
      draft,
      evaluation: { score: evaluation.score, weaknesses: evaluation.weaknesses },
      refined,
    };
  }
}
