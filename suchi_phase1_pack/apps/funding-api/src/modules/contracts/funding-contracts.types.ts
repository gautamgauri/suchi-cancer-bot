export const WRITE_PREVIEW_ACTIONS = ["create", "update", "delete", "send", "post"] as const;
export type WritePreviewAction = (typeof WRITE_PREVIEW_ACTIONS)[number];

export const APPROVAL_CONFIRMATION_OUTCOMES = ["approved", "rejected", "expired", "cancelled"] as const;
export type ApprovalConfirmationOutcome = (typeof APPROVAL_CONFIRMATION_OUTCOMES)[number];

export const DELIVERY_CHANNELS = ["slack", "email"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_GUARD_DECISIONS = ["allow", "block"] as const;
export type DeliveryGuardDecision = (typeof DELIVERY_GUARD_DECISIONS)[number];

export interface ContractActor {
  actorType: "human" | "agent" | "system";
  actorId: string;
  displayName?: string;
}

export interface WritePreviewContract<TBefore = unknown, TAfter = unknown> {
  previewId: string;
  action: WritePreviewAction;
  entityType: string;
  entityId: string;
  actor: ContractActor;
  reason: string;
  timestamp: string; // ISO-8601 UTC
  before: TBefore | null;
  after: TAfter | null;
}

/**
 * Token and interaction semantics:
 * - approvalToken: opaque, single-use verifier minted by API.
 * - interactionId: channel interaction handle (e.g. Slack action payload ID).
 */
export interface ApprovalConfirmationContract {
  approvalToken: string;
  interactionId: string;
  outcome: ApprovalConfirmationOutcome;
  actor: ContractActor;
  reason?: string;
  timestamp: string; // ISO-8601 UTC
}

export interface AuditLogContract {
  eventId: string;
  eventType: string;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: ContractActor;
  reason?: string;
  timestamp: string; // ISO-8601 UTC
  status: "accepted" | "rejected" | "noop" | "failed";
  preview?: WritePreviewContract;
  approval?: ApprovalConfirmationContract;
  metadata?: Record<string, unknown>;
}

export interface DeliveryTargetSlack {
  channelId: string;
}

export interface DeliveryTargetEmail {
  recipients: string[];
}

export interface InternalDeliveryGuardContract {
  medium: DeliveryChannel;
  requestedBy: ContractActor;
  reason: string;
  timestamp: string; // ISO-8601 UTC
  slack?: DeliveryTargetSlack;
  email?: DeliveryTargetEmail;
}

export interface DeliveryGuardEvaluationContract {
  decision: DeliveryGuardDecision;
  medium: DeliveryChannel;
  blockedTargets: string[];
  allowedTargets: string[];
  violationCodes: string[];
}
