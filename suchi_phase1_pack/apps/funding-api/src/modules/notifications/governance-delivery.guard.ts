import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { logStructured } from "../../common/structured-logger";
import { parseDeliveryGuardConfig } from "../../config/delivery-guard.config";
import {
  ApprovalConfirmationContract,
  AuditLogContract,
  ContractActor,
  DeliveryGuardEvaluationContract,
  InternalDeliveryGuardContract,
  WritePreviewAction,
  WritePreviewContract,
} from "../contracts/funding-contracts.types";
import { AuditTrailService } from "./audit-trail.service";

export interface WriteApprovalDecision<TBefore = unknown, TAfter = unknown> {
  approved: boolean;
  reason: string;
  preview: WritePreviewContract<TBefore, TAfter>;
  approval?: ApprovalConfirmationContract;
  audit: AuditLogContract;
}

@Injectable()
export class GovernanceDeliveryGuard {
  private readonly logger = new Logger(GovernanceDeliveryGuard.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly auditTrail: AuditTrailService | null = null,
  ) {}

  evaluateDelivery(request: InternalDeliveryGuardContract): DeliveryGuardEvaluationContract {
    const cfg = parseDeliveryGuardConfig({
      FUNDING_ALLOWED_SLACK_CHANNEL_IDS: this.configService.get<string>("FUNDING_ALLOWED_SLACK_CHANNEL_IDS"),
      FUNDING_ALLOWED_EMAIL_RECIPIENTS: this.configService.get<string>("FUNDING_ALLOWED_EMAIL_RECIPIENTS"),
      FUNDING_ALLOWED_EMAIL_DOMAINS: this.configService.get<string>("FUNDING_ALLOWED_EMAIL_DOMAINS"),
      FUNDING_BLOCK_EXTERNAL_DELIVERY: this.configService.get<string>("FUNDING_BLOCK_EXTERNAL_DELIVERY"),
    });
    const violations: string[] = [];
    const blockedTargets: string[] = [];
    const allowedTargets: string[] = [];

    if (request.medium === "slack") {
      const channelId = (request.slack?.channelId || "").trim().toLowerCase();
      const allowedSet = new Set(cfg.allowedSlackChannelIds.map((id) => id.trim().toLowerCase()));
      if (allowedSet.has("*")) {
        allowedTargets.push(channelId || "UNKNOWN_CHANNEL");
      } else if (allowedSet.size === 0) {
        violations.push("SLACK_ALLOWLIST_EMPTY");
        blockedTargets.push(channelId || "UNKNOWN_CHANNEL");
      } else if (!allowedSet.has(channelId)) {
        violations.push("SLACK_CHANNEL_NOT_WHITELISTED");
        blockedTargets.push(channelId || "UNKNOWN_CHANNEL");
      } else {
        allowedTargets.push(channelId);
      }
    } else {
      const recipients = request.email?.recipients ?? [];
      const allowedRecipients = new Set(cfg.allowedEmailRecipients.map((r) => r.trim().toLowerCase()));
      const allowedDomains = new Set(cfg.allowedEmailDomains.map((d) => d.trim().toLowerCase()));
      if (allowedRecipients.size === 0 && allowedDomains.size === 0) {
        violations.push("EMAIL_ALLOWLIST_EMPTY");
      }
      for (const recipientRaw of recipients) {
        const recipient = recipientRaw.trim().toLowerCase();
        const domain = recipient.split("@")[1]?.toLowerCase() || "";
        const allowRecipient = allowedRecipients.has(recipient);
        const allowDomain = !!domain && allowedDomains.has(domain);
        if (allowRecipient || allowDomain) {
          allowedTargets.push(recipient);
        } else {
          blockedTargets.push(recipient || "UNKNOWN_RECIPIENT");
          violations.push("EMAIL_RECIPIENT_NOT_WHITELISTED");
        }
      }
    }

    if (!cfg.blockExternalDelivery) {
      const nonBlockingTargets =
        request.medium === "slack"
          ? [request.slack?.channelId || "UNKNOWN_CHANNEL"]
          : (request.email?.recipients ?? []).map((r) => r || "UNKNOWN_RECIPIENT");
      const allowedTargetsInNonBlocking = [...new Set([...allowedTargets, ...nonBlockingTargets])];
      return {
        decision: "allow",
        medium: request.medium,
        blockedTargets: [],
        allowedTargets: allowedTargetsInNonBlocking,
        violationCodes: blockedTargets.length
          ? [...new Set([...violations, "EXTERNAL_DELIVERY_ALLOWED_BY_CONFIG"])]
          : [],
      };
    }

    const decision = blockedTargets.length === 0 ? "allow" : "block";
    return {
      decision,
      medium: request.medium,
      blockedTargets,
      allowedTargets,
      violationCodes: [...new Set(violations)],
    };
  }

  enforceNumericClaimDiscipline(text: string): {
    text: string;
    flaggedCount: number;
    flaggedLines: string[];
  } {
    const lines = text.split("\n");
    const flaggedLines: string[] = [];
    const updated = lines.map((line) => {
      const hasNumber = /\d/.test(line);
      const hasCitation = /\[citation:[^\]]+\]/i.test(line);
      const markedAlready = /(UNVERIFIED|MISSING|SOURCE REQUIRED)/i.test(line);
      if (hasNumber && !hasCitation && !markedAlready) {
        flaggedLines.push(line.trim().slice(0, 200));
        return `${line} [UNVERIFIED_NUMERIC_CLAIM: source required]`;
      }
      return line;
    });
    return {
      text: updated.join("\n"),
      flaggedCount: flaggedLines.length,
      flaggedLines,
    };
  }

  requireWriteApproval<TBefore = unknown, TAfter = unknown>(params: {
    module: string;
    action: WritePreviewAction;
    entityType: string;
    entityId: string;
    actor: ContractActor;
    reason: string;
    before: TBefore | null;
    after: TAfter | null;
    approval?: ApprovalConfirmationContract;
  }): WriteApprovalDecision<TBefore, TAfter> {
    const preview: WritePreviewContract<TBefore, TAfter> = {
      previewId: `prv_${randomUUID()}`,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      actor: params.actor,
      reason: params.reason,
      timestamp: new Date().toISOString(),
      before: params.before,
      after: params.after,
    };

    const expectedToken =
      this.configService.get<string>("FUNDING_WRITE_APPROVAL_TOKEN") ||
      this.configService.get<string>("FUNDING_EXPORT_TOKEN") ||
      "";
    const approval = params.approval;
    // When no approval token is configured, the approval system is not enabled — auto-approve all writes.
    const tokenMatch = !expectedToken || (!!approval?.approvalToken && approval.approvalToken === expectedToken);
    const approved = !expectedToken || (approval?.outcome === "approved" && tokenMatch);
    const reason = approved
      ? "approved"
      : "missing or invalid write approval";

    const audit: AuditLogContract = {
      eventId: `evt_${randomUUID()}`,
      eventType: approved ? "funding.write.confirmed" : "funding.write.preview",
      module: params.module,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      actor: params.actor,
      reason: params.reason,
      timestamp: new Date().toISOString(),
      status: approved ? "accepted" : "rejected",
      preview,
      approval,
      metadata: {
        enforcement: "BR-GOV-01",
        decisionReason: reason,
      },
    };
    this.logAudit(audit);

    return {
      approved,
      reason,
      preview,
      approval,
      audit,
    };
  }

  logAudit(audit: AuditLogContract): void {
    const level = audit.status === "accepted" ? "log" : "warn";
    this.logger[level](
      `${audit.eventType} ${audit.module}.${audit.action} ${audit.status} ${audit.entityType}:${audit.entityId}`,
    );
    logStructured[level]("governance_audit", {
      context: GovernanceDeliveryGuard.name,
      ...audit,
    });
    this.auditTrail?.persist(audit).catch(() => {});
  }
}
