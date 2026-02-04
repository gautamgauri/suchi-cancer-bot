import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProposalGap, ProposalRunArtifacts } from "../proposal.types";

@Injectable()
export class SlackClientService {
  private readonly logger = new Logger(SlackClientService.name);
  private readonly webhookUrl: string | null;
  private readonly channel: string;

  constructor(private readonly configService: ConfigService) {
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
  }): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.debug("Slack not configured, skipping summary");
      return;
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
    await this.postToSlack(text);
  }

  /**
   * Post progress update to Slack.
   */
  async postProgress(params: {
    opportunityId: string;
    stage: string;
    message?: string;
  }): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }

    const text = `*Proposal Generation Progress*\nOpportunity: ${params.opportunityId}\nStage: ${params.stage}${params.message ? `\n${params.message}` : ""}`;
    await this.postToSlack(text);
  }

  /**
   * Post gaps/missing inputs to Slack.
   */
  async postGaps(params: {
    opportunityId: string;
    gaps: ProposalGap[];
  }): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }

    const lines: string[] = [`*Missing Inputs for ${params.opportunityId}*`];
    params.gaps.forEach((gap) => {
      const priority = gap.priority ? ` [${gap.priority}]` : "";
      const section = gap.section ? ` (${gap.section})` : "";
      lines.push(`• ${gap.question}${section}${priority}`);
    });

    await this.postToSlack(lines.join("\n"));
  }

  private async postToSlack(text: string): Promise<void> {
    if (!this.webhookUrl) return;

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
      }
    } catch (e) {
      this.logger.warn("Failed to post to Slack", (e as Error).message);
    }
  }
}
