import {
  ApprovalConfirmationContract,
  AuditLogContract,
  DeliveryGuardEvaluationContract,
  InternalDeliveryGuardContract,
  WritePreviewContract,
} from "./funding-contracts.types";

export const EXAMPLE_WRITE_PREVIEW: WritePreviewContract<Record<string, unknown>, Record<string, unknown>> = {
  previewId: "prv_01JH7Q2B2F9XKXQ3T3T",
  action: "update",
  entityType: "pipeline_entry",
  entityId: "pipe_123",
  actor: {
    actorType: "human",
    actorId: "user_42",
    displayName: "Funding Manager",
  },
  reason: "Correcting grant stage after review call",
  timestamp: "2026-02-13T10:45:12.000Z",
  before: { stage: "Qualified", owner: "Nisha" },
  after: { stage: "Proposal Drafting", owner: "Nisha" },
};

export const EXAMPLE_APPROVAL_CONFIRMATION: ApprovalConfirmationContract = {
  approvalToken: "aptk_6f2a4c3d7e",
  interactionId: "slack:1715356265.120639",
  outcome: "approved",
  actor: {
    actorType: "human",
    actorId: "U08ABCD12",
    displayName: "Reviewer - Slack",
  },
  reason: "Looks accurate; proceed to publish",
  timestamp: "2026-02-13T10:46:02.000Z",
};

export const EXAMPLE_AUDIT_LOG: AuditLogContract = {
  eventId: "evt_01JH7Q4A1F2Z",
  eventType: "funding.write.confirmed",
  module: "proposal",
  action: "post",
  entityType: "proposal_run",
  entityId: "run_9f8e7d",
  actor: {
    actorType: "agent",
    actorId: "agent_0",
    displayName: "Platform Contract Owner",
  },
  reason: "Post to internal review channel after approval",
  timestamp: "2026-02-13T10:46:05.000Z",
  status: "accepted",
  preview: EXAMPLE_WRITE_PREVIEW,
  approval: EXAMPLE_APPROVAL_CONFIRMATION,
  metadata: { correlationId: "corr_12345", moduleVersion: "v1" },
};

export const EXAMPLE_DELIVERY_GUARD_REQUEST: InternalDeliveryGuardContract = {
  medium: "email",
  requestedBy: {
    actorType: "agent",
    actorId: "proposal_worker",
    displayName: "Proposal Worker",
  },
  reason: "Send generated draft to internal reviewers",
  timestamp: "2026-02-13T10:47:00.000Z",
  email: {
    recipients: ["reviewer@suchi.org", "ops@suchi.org"],
  },
};

export const EXAMPLE_DELIVERY_GUARD_EVALUATION: DeliveryGuardEvaluationContract = {
  decision: "allow",
  medium: "email",
  blockedTargets: [],
  allowedTargets: ["reviewer@suchi.org", "ops@suchi.org"],
  violationCodes: [],
};
