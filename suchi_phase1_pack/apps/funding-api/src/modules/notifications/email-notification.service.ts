import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import {
  ApprovalConfirmationContract,
  ContractActor,
  DeliveryGuardEvaluationContract,
  WritePreviewContract,
} from "../contracts/funding-contracts.types";
import { GovernanceDeliveryGuard, WriteApprovalDecision } from "./governance-delivery.guard";

export interface SendEmailOptions {
  subject: string;
  body: string;
  /** If true, body is treated as HTML. Default: false (plain text) */
  isHtml?: boolean;
  /** Extra recipients to CC alongside the default review recipients */
  additionalRecipients?: string[];
  approval?: ApprovalConfirmationContract;
  actor?: ContractActor;
  entityId?: string;
  reason?: string;
}

export interface DeliveryAttemptResult {
  sent: boolean;
  blocked: boolean;
  reason?: string;
  guardDecision?: DeliveryGuardEvaluationContract;
  preview?: WritePreviewContract<null, Record<string, unknown>>;
  approvalDecision?: WriteApprovalDecision<null, Record<string, unknown>>;
}

/**
 * Email notification service for sending generated documents to review recipients.
 * Sends proposals, drafts, and other generated content to configured email addresses
 * for review and feedback.
 */
@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger(EmailNotificationService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly reviewRecipients: string[];
  private readonly fromAddress: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly governanceGuard: GovernanceDeliveryGuard
  ) {
    this.initTransporter();

    // Configure review recipients - these are the email addresses that receive
    // generated documents for review and feedback
    const recipientsEnv = this.configService.get<string>("FUNDING_REVIEW_RECIPIENTS");
    this.reviewRecipients = recipientsEnv
      ? recipientsEnv.split(",").map((e) => e.trim()).filter(Boolean)
      : [
          "contact@dikshafoundation.org",
          "nisha.kumari@dikshafoundation.org",
        ];

    this.fromAddress =
      this.configService.get<string>("SMTP_FROM") ||
      "Bodh AI Funding Bot <funding-bot@suchi.org>";

    this.logger.log(
      `Email notification service initialized. Recipients: ${this.reviewRecipients.join(", ")}`
    );
  }

  private initTransporter(): void {
    const host = this.configService.get<string>("SMTP_HOST");
    const port = parseInt(this.configService.get<string>("SMTP_PORT") || "587", 10);
    const user = this.configService.get<string>("SMTP_USER");
    const pass = this.configService.get<string>("SMTP_PASS");

    if (!host || !user || !pass) {
      this.logger.warn(
        "SMTP not configured - email notifications disabled. Set SMTP_HOST, SMTP_USER, SMTP_PASS"
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    this.logger.log(`Email transporter initialized with SMTP host: ${host}`);
  }

  /**
   * Check if email notifications are configured and ready to send.
   */
  isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * Get the list of configured review recipients.
   */
  getRecipients(): string[] {
    return [...this.reviewRecipients];
  }

  /**
   * Send an email with generated content to all review recipients.
   * The content is included directly in the email body.
   */
  async send(options: SendEmailOptions): Promise<DeliveryAttemptResult> {
    if (!this.transporter) {
      this.logger.warn("Email not sent - SMTP not configured");
      return { sent: false, blocked: true, reason: "smtp_not_configured" };
    }

    if (this.reviewRecipients.length === 0) {
      this.logger.warn("Email not sent - no recipients configured");
      return { sent: false, blocked: true, reason: "no_recipients" };
    }
    const actor: ContractActor = options.actor ?? {
      actorType: "agent",
      actorId: "email_notification_service",
      displayName: "Email Notification Service",
    };
    const effectiveRecipients = [...this.reviewRecipients];
    if (options.additionalRecipients) {
      for (const r of options.additionalRecipients) {
        if (r && !effectiveRecipients.includes(r)) effectiveRecipients.push(r);
      }
    }
    const requestedPayload = {
      recipients: effectiveRecipients,
      subject: options.subject,
      isHtml: !!options.isHtml,
      body: options.body,
    };
    const guardDecision = this.governanceGuard.evaluateDelivery({
      medium: "email",
      requestedBy: actor,
      reason: options.reason ?? "Send generated content to internal recipients",
      timestamp: new Date().toISOString(),
      email: {
        recipients: effectiveRecipients,
      },
    });
    this.governanceGuard.logAudit({
      eventId: `evt_${Date.now()}_email_delivery_guard`,
      eventType: "funding.delivery.guard",
      module: "notifications",
      action: "send",
      entityType: "email_message",
      entityId: options.entityId ?? options.subject,
      actor,
      timestamp: new Date().toISOString(),
      status: guardDecision.decision === "allow" ? "accepted" : "rejected",
      reason: options.reason ?? "Email delivery guard check",
      metadata: { enforcement: "BR-GOV-04", ...guardDecision },
    });
    if (guardDecision.decision === "block") {
      return {
        sent: false,
        blocked: true,
        reason: "delivery_guard_block",
        guardDecision,
      };
    }

    const approvalDecision = this.governanceGuard.requireWriteApproval({
      module: "notifications",
      action: "send",
      entityType: "email_message",
      entityId: options.entityId ?? options.subject,
      actor,
      reason: options.reason ?? "Send email notification",
      before: null,
      after: requestedPayload,
      approval: options.approval,
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
      const mailOptions: nodemailer.SendMailOptions = {
        from: this.fromAddress,
        to: effectiveRecipients.join(", "),
        subject: options.subject,
      };

      if (options.isHtml) {
        mailOptions.html = options.body;
      } else {
        mailOptions.text = options.body;
      }

      const info = await this.transporter.sendMail(mailOptions);

      this.logger.log(
        `Email sent: ${info.messageId} to ${this.reviewRecipients.join(", ")}`
      );
      this.governanceGuard.logAudit({
        eventId: `evt_${Date.now()}_email_sent`,
        eventType: "funding.delivery.sent",
        module: "notifications",
        action: "send",
        entityType: "email_message",
        entityId: options.entityId ?? info.messageId,
        actor,
        timestamp: new Date().toISOString(),
        status: "accepted",
        reason: options.reason ?? "Email sent",
        approval: options.approval,
        metadata: { messageId: info.messageId, recipients: this.reviewRecipients },
      });
      return { sent: true, blocked: false, guardDecision, approvalDecision };
    } catch (error) {
      this.logger.error(
        `Failed to send email: ${(error as Error).message}`,
        (error as Error).stack
      );
      this.governanceGuard.logAudit({
        eventId: `evt_${Date.now()}_email_failed`,
        eventType: "funding.delivery.failed",
        module: "notifications",
        action: "send",
        entityType: "email_message",
        entityId: options.entityId ?? options.subject,
        actor,
        timestamp: new Date().toISOString(),
        status: "failed",
        reason: (error as Error).message,
        approval: options.approval,
      });
      return { sent: false, blocked: true, reason: "send_failed", guardDecision, approvalDecision };
    }
  }

  /**
   * Send generated content with a formatted subject line.
   * Convenience method that formats the subject with a prefix.
   */
  async sendGeneratedContent(
    contentType: string,
    title: string,
    content: string,
    approval?: ApprovalConfirmationContract,
    actor?: ContractActor,
  ): Promise<DeliveryAttemptResult> {
    const disciplined = this.governanceGuard.enforceNumericClaimDiscipline(content);
    if (disciplined.flaggedCount > 0) {
      this.governanceGuard.logAudit({
        eventId: `evt_${Date.now()}_numeric_claims`,
        eventType: "funding.numeric_claims.marked",
        module: "notifications",
        action: "send",
        entityType: "email_message",
        entityId: title,
        actor: actor ?? {
          actorType: "agent",
          actorId: "email_notification_service",
        },
        timestamp: new Date().toISOString(),
        status: "accepted",
        metadata: {
          enforcement: "BR-GOV-02",
          flaggedCount: disciplined.flaggedCount,
        },
      });
    }
    const subject = `[Bodh AI] ${contentType}: ${title}`;
    return this.send({
      subject,
      body: disciplined.text,
      isHtml: false,
      approval,
      actor,
      entityId: title,
      reason: `${contentType} notification delivery`,
    });
  }
}
