import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProposalGap, ProposalRunArtifacts } from "../proposal.types";
import {
  ApprovalConfirmationContract,
  ContractActor,
} from "../../contracts/funding-contracts.types";
import { GovernanceDeliveryGuard, WriteApprovalDecision } from "../../notifications/governance-delivery.guard";

export interface SlackDeliveryResult {
  sent: boolean;
  blocked: boolean;
  reason?: string;
  guardDecision?: {
    decision: "allow" | "block";
    medium: "slack" | "email";
    blockedTargets: string[];
    allowedTargets: string[];
    violationCodes: string[];
  };
  preview?: WriteApprovalDecision<null, Record<string, unknown>>["preview"];
  approvalDecision?: WriteApprovalDecision<null, Record<string, unknown>>;
}

@Injectable()
export class SlackClientService {
  private readonly logger = new Logger(SlackClientService.name);
  private readonly webhookUrl: string | null;
  private readonly channel: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly governanceGuard: GovernanceDeliveryGuard
  ) {
    this.webhookUrl = this.configService.get<string>("FUNDING_SLACK_WEBHOOK_URL") ?? null;
    this.channel = this.configService.get<string>("FUNDING_SLACK_CHANNEL") ?? "#funding-bot";
  }

  isConfigured(): boolean {
    return !!this.webhookUrl;
  }

  /**
   * Post proposal completion summary to Slack.
   */
  async postSummary(params: {
    opportunityId: string;
    funderName: string;
    status: string;
    artifacts?: ProposalRunArtifacts;
    gaps?: ProposalGap[];
    coverageScore?: number;
    approval?: ApprovalConfirmationContract;
  }): Promise<SlackDeliveryResult> {
    if (!this.isConfigured()) {
      this.logger.debug("Slack not configured, skipping summary");
      return { sent: false, blocked: true, reason: "slack_not_configured" };
    }

    const lines: string[] = [
      `*Proposal Generation Complete*`,
      `Opportunity: ${params.opportunityId}`,
      `Funder: ${params.funderName}`,
      `Status: ${params.status}`,
    ];

    if (params.coverageScore !== undefined) {
      lines.push(`Coverage Score: ${(params.coverageScore * 100).toFixed(0)}%`);
    }

    if (params.artifacts?.driveFolderUrl) {
      lines.push(`\n*Artifacts:*`);
      lines.push(`• <${params.artifacts.driveFolderUrl}|View Proposal Pack>`);
      if (params.artifacts.docUrl) {
        lines.push(`• <${params.artifacts.docUrl}|View Draft>`);
      }
    }

    if (params.gaps && params.gaps.length > 0) {
      lines.push(`\n*Missing Inputs (${params.gaps.length}):*`);
      params.gaps.slice(0, 10).forEach((gap) => {
        const priority = gap.priority ? ` [${gap.priority}]` : "";
        const section = gap.section ? ` (${gap.section})` : "";
        lines.push(`• ${gap.question}${section}${priority}`);
      });
      if (params.gaps.length > 10) {
        lines.push(`... and ${params.gaps.length - 10} more`);
      }
    }

    const text = lines.join("\n");
    return this.postToSlack(text, params.opportunityId, params.approval);
  }

  /**
   * Post progress update to Slack.
   */
  async postProgress(params: {
    opportunityId: string;
    stage: string;
    message?: string;
    approval?: ApprovalConfirmationContract;
  }): Promise<SlackDeliveryResult> {
    if (!this.isConfigured()) {
      return { sent: false, blocked: true, reason: "slack_not_configured" };
    }

    const text = `*Proposal Generation Progress*\nOpportunity: ${params.opportunityId}\nStage: ${params.stage}${params.message ? `\n${params.message}` : ""}`;
    return this.postToSlack(text, params.opportunityId, params.approval);
  }

  /**
   * Post gaps/missing inputs to Slack.
   */
  async postGaps(params: {
    opportunityId: string;
    gaps: ProposalGap[];
    approval?: ApprovalConfirmationContract;
  }): Promise<SlackDeliveryResult> {
    if (!this.isConfigured()) {
      return { sent: false, blocked: true, reason: "slack_not_configured" };
    }

    const lines: string[] = [`*Missing Inputs for ${params.opportunityId}*`];
    params.gaps.forEach((gap) => {
      const priority = gap.priority ? ` [${gap.priority}]` : "";
      const section = gap.section ? ` (${gap.section})` : "";
      lines.push(`• ${gap.question}${section}${priority}`);
    });

    return this.postToSlack(lines.join("\n"), params.opportunityId, params.approval);
  }

  /**
   * Post stalled prospect nudges digest to internal Slack channel.
   * Used by the scheduled nudge job (BR-PIPE-02). No auto-send of emails; recommendations only.
   */
  async postStalledNudges(
    nudges: Array<{ orgName: string; stage: string; slackMessagePreview: string }>,
    options?: { approval?: ApprovalConfirmationContract },
  ): Promise<SlackDeliveryResult> {
    if (!this.isConfigured()) {
      return { sent: false, blocked: true, reason: "slack_not_configured" };
    }
    if (nudges.length === 0) {
      return { sent: true, blocked: false };
    }
    const header = `*Stalled prospect nudges* (${nudges.length} — no activity past threshold)\n`;
    const body = nudges.slice(0, 15).map((n) => n.slackMessagePreview).join("\n\n");
    const footer =
      nudges.length > 15 ? `\n\n... and ${nudges.length - 15} more. Use \`/funding stalled\` for full list.` : "";
    const text = header + body + footer;
    return this.postToSlack(text, "stalled_nudge_digest", options?.approval);
  }

  private async postToSlack(
    text: string,
    opportunityId: string,
    approval?: ApprovalConfirmationContract
  ): Promise<SlackDeliveryResult> {
    if (!this.webhookUrl) {
      return { sent: false, blocked: true, reason: "slack_not_configured" };
    }
    const actor: ContractActor = {
      actorType: "agent",
      actorId: "slack_client_service",
      displayName: "Slack Client Service",
    };
    const normalizedChannel = this.channel.trim().toLowerCase();
    const guardDecision = this.governanceGuard.evaluateDelivery({
      medium: "slack",
      requestedBy: actor,
      reason: "Post internal proposal notification",
      timestamp: new Date().toISOString(),
      slack: { channelId: normalizedChannel },
    });
    this.governanceGuard.logAudit({
      eventId: `evt_${Date.now()}_slack_delivery_guard`,
      eventType: "funding.delivery.guard",
      module: "proposal",
      action: "post",
      entityType: "slack_message",
      entityId: opportunityId,
      actor,
      timestamp: new Date().toISOString(),
      status: guardDecision.decision === "allow" ? "accepted" : "rejected",
      reason: "Slack delivery guard check",
      metadata: { enforcement: "BR-GOV-04", ...guardDecision },
    });
    if (guardDecision.decision === "block") {
      return { sent: false, blocked: true, reason: "delivery_guard_block", guardDecision };
    }

    const approvalDecision = this.governanceGuard.requireWriteApproval({
      module: "proposal",
      action: "post",
      entityType: "slack_message",
      entityId: opportunityId,
      actor,
      reason: "Post proposal status to Slack",
      before: null,
      after: { channel: this.channel, text },
      approval,
    });
    if (!approvalDecision.approved) {
      return {
        sent: false,
        blocked: true,
        reason: approvalDecision.reason,
        guardDecision,
        preview: approvalDecision.preview,
        approvalDecision,
      };
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: this.channel,
          text,
          mrkdwn: true,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Slack webhook failed: ${response.status} ${response.statusText}`);
        return { sent: false, blocked: true, reason: "slack_webhook_failed", guardDecision, approvalDecision };
      }
      return { sent: true, blocked: false, guardDecision, approvalDecision };
    } catch (e) {
      this.logger.warn("Failed to post to Slack", (e as Error).message);
      return { sent: false, blocked: true, reason: "slack_post_failed", guardDecision, approvalDecision };
    }
  }
}
