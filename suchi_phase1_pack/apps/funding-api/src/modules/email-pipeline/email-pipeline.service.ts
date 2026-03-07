import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { GmailClientService } from "../gmail/gmail-client.service";
import { EmailNotificationService } from "../notifications/email-notification.service";
import { OpportunityIntakeService } from "../opportunity/opportunity-intake.service";
import { OrchestratorService } from "../orchestrator/orchestrator.service";
import { EmailClassifierService, type ClassificationResult } from "./email-classifier.service";
import { DraftFormatterService } from "./draft-formatter.service";

export interface EmailPipelineResult {
  messageId: string;
  status: "processed" | "skipped" | "failed";
  intent?: string;
  opportunityId?: string;
  proposalRunId?: string;
  emailSent?: boolean;
  error?: string;
}

export interface PollResult {
  processed: number;
  skipped: number;
  failed: number;
  results: EmailPipelineResult[];
}

@Injectable()
export class EmailPipelineService {
  private readonly logger = new Logger(EmailPipelineService.name);
  private readonly pollLabel: string;
  private readonly ownerEmail: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailClientService,
    private readonly emailNotification: EmailNotificationService,
    private readonly intake: OpportunityIntakeService,
    private readonly orchestrator: OrchestratorService,
    private readonly classifier: EmailClassifierService,
    private readonly formatter: DraftFormatterService,
    private readonly config: ConfigService,
  ) {
    this.pollLabel = this.config.get<string>("EMAIL_PIPELINE_POLL_LABEL") || "funding-bot";
    this.ownerEmail = this.config.get<string>("EMAIL_PIPELINE_OWNER_EMAIL") || "gautamgauri@dikshafoundation.org";
  }

  /**
   * Poll Gmail inbox for unprocessed messages and run the pipeline on each.
   */
  async poll(): Promise<PollResult> {
    if (!this.gmail.isConfigured()) {
      throw new Error("Gmail not configured — set FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON and FUNDING_GMAIL_USER");
    }

    const result: PollResult = { processed: 0, skipped: 0, failed: 0, results: [] };

    // Search for unread messages with the bot label
    const query = `label:${this.pollLabel} is:unread`;
    const { messages } = await this.gmail.listMessages({ q: query, maxResults: 10 });

    this.logger.log(`Poll: found ${messages.length} unread messages with label "${this.pollLabel}"`);

    for (const msg of messages) {
      const pipelineResult = await this.processMessage(msg.id);
      result.results.push(pipelineResult);

      if (pipelineResult.status === "processed") result.processed++;
      else if (pipelineResult.status === "skipped") result.skipped++;
      else result.failed++;
    }

    return result;
  }

  /**
   * Process a single email message through the pipeline:
   * 1. Fetch + parse
   * 2. Check idempotency
   * 3. Classify intent
   * 4. Route: intake → orchestrate → format → reply
   */
  async processMessage(messageId: string): Promise<EmailPipelineResult> {
    const result: EmailPipelineResult = { messageId, status: "failed" };

    try {
      // Check idempotency
      const existing = await this.prisma.processedEmail.findUnique({
        where: { messageId },
      });
      if (existing) {
        this.logger.log(`Message ${messageId} already processed — skipping`);
        result.status = "skipped";
        result.intent = "already_processed";
        return result;
      }

      // Fetch and parse email
      const raw = await this.gmail.getMessage(messageId);
      const parsed = this.gmail.parseMessage(raw);

      this.logger.log(`Processing: "${parsed.subject}" from ${parsed.from.email}`);

      // Classify intent
      const classification = await this.classifier.classify({
        subject: parsed.subject,
        bodyPlain: parsed.bodyPlain,
        from: parsed.from.email,
        snippet: parsed.snippet,
      });

      result.intent = classification.intent;
      this.logger.log(`Classification: ${classification.intent} (confidence: ${classification.confidence})`);

      if (classification.intent === "unknown") {
        // Mark as processed but don't run pipeline
        await this.prisma.processedEmail.create({
          data: { messageId, threadId: parsed.threadId },
        });
        result.status = "skipped";
        return result;
      }

      // Route based on intent
      const pipelineResult = await this.runPipeline(
        messageId,
        parsed,
        classification,
      );

      result.opportunityId = pipelineResult.opportunityId;
      result.proposalRunId = pipelineResult.proposalRunId;
      result.emailSent = pipelineResult.emailSent;
      result.status = "processed";
    } catch (err) {
      result.error = (err as Error).message;
      this.logger.error(`Pipeline failed for ${messageId}: ${(err as Error).message}`);
    }

    return result;
  }

  /**
   * Run the full pipeline: intake → orchestrate → format → email reply.
   */
  private async runPipeline(
    messageId: string,
    parsed: ReturnType<GmailClientService["parseMessage"]>,
    classification: ClassificationResult,
  ): Promise<{ opportunityId?: string; proposalRunId?: string; emailSent: boolean }> {
    // Step 1: Intake — create opportunity from email
    const intakeResult = await this.intake.intakeFromEmail(messageId);
    if (!intakeResult.success || !intakeResult.opportunityId) {
      // If already processed by intake, retrieve the existing opportunity
      if (intakeResult.error === "already_processed") {
        const existing = await this.prisma.processedEmail.findUnique({
          where: { messageId },
        });
        if (existing?.opportunityId) {
          return this.runOrchestrator(
            existing.opportunityId,
            parsed,
            classification,
          );
        }
      }
      throw new Error(`Intake failed: ${intakeResult.error}`);
    }

    const opportunityId = intakeResult.opportunityId;

    return this.runOrchestrator(opportunityId, parsed, classification);
  }

  private async runOrchestrator(
    opportunityId: string,
    parsed: ReturnType<GmailClientService["parseMessage"]>,
    classification: ClassificationResult,
  ): Promise<{ opportunityId: string; proposalRunId?: string; emailSent: boolean }> {
    // Step 2: Run orchestrator pipeline
    this.logger.log(`Running orchestrator for ${opportunityId}`);
    const runState = await this.orchestrator.run(opportunityId, {
      forceGenerate: classification.intent === "draft_request",
    });

    const proposalRunId = runState.proposalRunId;

    // Step 3: Format draft and send reply
    let emailSent = false;
    if (proposalRunId && runState.stage === "complete") {
      emailSent = await this.formatAndSendDraft(
        opportunityId,
        proposalRunId,
        parsed,
        runState,
      );
    } else if (runState.stage === "parked" || runState.stage === "size_mismatch") {
      // Send a notification that the opportunity was parked
      emailSent = await this.sendParkedNotification(
        opportunityId,
        parsed,
        runState,
      );
    }

    return { opportunityId, proposalRunId, emailSent };
  }

  private async formatAndSendDraft(
    opportunityId: string,
    proposalRunId: string,
    parsed: ReturnType<GmailClientService["parseMessage"]>,
    runState: { fitScore?: { totalScore?: number; decision?: string } },
  ): Promise<boolean> {
    // Load proposal run with sections
    const run = await this.prisma.proposalRun.findUnique({
      where: { id: proposalRunId },
      include: {
        sections: { orderBy: { createdAt: "asc" } },
        opportunity: true,
      },
    });

    if (!run || run.sections.length === 0) return false;

    const oppPayload = run.opportunity?.jsonBlob as Record<string, unknown> | undefined;
    const oppData = (oppPayload as { opportunity?: { funder?: { name?: string; programName?: string } } })?.opportunity;
    const programName = oppData?.funder?.programName || oppData?.funder?.name || "Proposal";

    const sections = run.sections.map((s) => ({
      name: s.name,
      draftText: s.draftText || "",
      targetWords: s.targetWords ?? undefined,
      status: s.status,
      gaps: Array.isArray(s.gaps) ? (s.gaps as string[]) : [],
    }));

    // Determine if fellowship or proposal format
    const modelConfig = run.modelConfig as { pipeline?: string } | null;
    const isFellowship = modelConfig?.pipeline === "fellowship";

    const formatted = isFellowship
      ? this.formatter.formatFellowshipDraft({
          fellowshipName: programName,
          opportunityId,
          proposalRunId,
          sections,
          originalSubject: parsed.subject,
        })
      : this.formatter.formatProposalDraft({
          proposalTitle: programName,
          opportunityId,
          proposalRunId,
          sections,
          fitScore: runState.fitScore?.totalScore,
          fitDecision: runState.fitScore?.decision,
          originalSubject: parsed.subject,
        });

    // Send via email notification service (always CC the owner)
    const sendResult = await this.emailNotification.send({
      subject: formatted.subject,
      body: formatted.html,
      isHtml: true,
      additionalRecipients: [this.ownerEmail],
      reason: `Email pipeline draft delivery for ${opportunityId}`,
    });

    return sendResult.sent;
  }

  private async sendParkedNotification(
    opportunityId: string,
    parsed: ReturnType<GmailClientService["parseMessage"]>,
    runState: {
      stage: string;
      fitScore?: { totalScore?: number; decision?: string; caveats?: string[] };
      sizeMismatch?: { funderMinINR?: number; orgCapacityINR?: number; options?: string[] };
    },
  ): Promise<boolean> {
    const lines: string[] = [
      `Opportunity ${opportunityId} — ${runState.stage === "parked" ? "Parked (Low Fit)" : "Size Mismatch"}`,
      "",
      `Original email: "${parsed.subject}" from ${parsed.from.email}`,
      "",
    ];

    if (runState.fitScore) {
      lines.push(`Fit Score: ${runState.fitScore.totalScore}/100 (${runState.fitScore.decision})`);
      if (runState.fitScore.caveats?.length) {
        lines.push("Caveats:");
        for (const c of runState.fitScore.caveats) lines.push(`  - ${c}`);
      }
    }

    if (runState.sizeMismatch?.options) {
      lines.push("Options:");
      for (const o of runState.sizeMismatch.options) lines.push(`  - ${o}`);
    }

    lines.push("");
    lines.push("No draft generated. Review and decide manually.");

    const sendResult = await this.emailNotification.send({
      subject: `[Bodh AI] ${opportunityId} — ${runState.stage}`,
      body: lines.join("\n"),
      additionalRecipients: [this.ownerEmail],
      reason: `Email pipeline parked notification for ${opportunityId}`,
    });

    return sendResult.sent;
  }

  /**
   * Get status of recent processed emails.
   */
  async getStatus(limit = 20): Promise<Array<{
    messageId: string;
    opportunityId: string | null;
    processedAt: Date;
  }>> {
    return this.prisma.processedEmail.findMany({
      orderBy: { processedAt: "desc" },
      take: limit,
      select: {
        messageId: true,
        opportunityId: true,
        processedAt: true,
      },
    });
  }
}
