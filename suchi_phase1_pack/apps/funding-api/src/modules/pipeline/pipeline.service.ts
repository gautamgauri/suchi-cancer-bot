import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import {
  PipelineEntry,
  ActivityRecord,
  ActivityPayload,
  FundingLane,
  NextBestActionResult,
  NextBestActionSuggestion,
  PipelineStage,
} from "./pipeline.types";
import { PrismaService } from "../prisma/prisma.service";
import { SheetsClientService } from "../sheets/sheets-client.service";
import type { CreatePipelineEntryDto } from "./pipeline-entry.dto";
import type { ApprovalContextDto, UpdatePipelineEntryDto } from "./pipeline-entry.dto";
import {
  ApprovalConfirmationContract,
  ContractActor,
} from "../contracts/funding-contracts.types";
import { GovernanceDeliveryGuard } from "../notifications/governance-delivery.guard";
import { WriteGuardBlockedResult } from "./pipeline.types";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string | undefined): boolean {
  return typeof s === "string" && UUID_REGEX.test(s);
}

function bankRouteHintForLane(lane: FundingLane): string {
  return lane === "FCRA" ? "SBI FCRA account" : "Domestic account";
}

const STAGE_SEQUENCE: PipelineStage[] = [
  "RFP_received",
  "lead",
  "qualified",
  "proposal_sent",
  "won",
];

function daysSince(date: Date | null | undefined, now: Date): number | null {
  if (!date) return null;
  const diffMs = now.getTime() - date.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function isStageAdvanceValid(
  currentStage: PipelineStage,
  targetStage: PipelineStage | undefined,
): boolean {
  if (!targetStage) return true;
  if (currentStage === "lost") return false;
  if (targetStage === "lost") return false;
  const currentIndex = STAGE_SEQUENCE.indexOf(currentStage);
  const targetIndex = STAGE_SEQUENCE.indexOf(targetStage);
  if (currentIndex < 0 || targetIndex < 0) return false;
  return targetIndex === currentIndex || targetIndex === currentIndex + 1;
}

function priorityScore(priority: NextBestActionSuggestion["priority"]): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetsClient: SheetsClientService,
    private readonly governanceGuard: GovernanceDeliveryGuard,
  ) {}

  private mapApproval(
    approval?: ApprovalContextDto,
  ): ApprovalConfirmationContract | undefined {
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

  private buildWriteGuardBlock(
    reason: string,
    preview: Record<string, unknown>,
  ): WriteGuardBlockedResult {
    return {
      blocked: true,
      reason,
      approvalRequired: true,
      preview,
    };
  }

  async getEntries(): Promise<PipelineEntry[]> {
    const rows = await this.prisma.pipelineEntry.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(dbToPipelineEntry);
  }

  async logActivity(
    payload: ActivityPayload,
    approval?: ApprovalContextDto,
  ): Promise<ActivityRecord | WriteGuardBlockedResult> {
    const actor: ContractActor = { actorType: "agent", actorId: "pipeline_service_activity" };
    const approvalDecision = this.governanceGuard.requireWriteApproval({
      module: "pipeline",
      action: "create",
      entityType: "pipeline_activity",
      entityId: payload.donorId ?? payload.orgId ?? "unknown",
      actor,
      reason: "Log pipeline activity",
      before: null,
      after: payload,
      approval: this.mapApproval(approval),
    });
    if (!approvalDecision.approved) {
      return this.buildWriteGuardBlock(
        approvalDecision.reason,
        approvalDecision.preview as unknown as Record<string, unknown>,
      );
    }

    const donorOrOrg = payload.donorId ?? payload.orgId ?? "unknown";
    let pipelineEntryId: string | null = null;
    if (isUuid(payload.donorId)) {
      pipelineEntryId = payload.donorId;
    } else if (isUuid(payload.orgId)) {
      pipelineEntryId = payload.orgId;
    }

    const timestamp = payload.timestamp
      ? new Date(payload.timestamp)
      : new Date();

    const activity = await this.prisma.activity.create({
      data: {
        pipelineEntryId,
        donorId: payload.donorId ?? undefined,
        orgId: payload.orgId ?? undefined,
        type: payload.type,
        notes: payload.notes ?? undefined,
        timestamp,
        createdBy: payload.createdBy ?? undefined,
      },
    });

    this.logger.log(`Activity logged: ${payload.type} for ${donorOrOrg} (${activity.id})`);

    return {
      id: activity.id,
      donorId: activity.donorId ?? undefined,
      orgId: activity.orgId ?? undefined,
      type: activity.type as ActivityRecord["type"],
      notes: activity.notes ?? undefined,
      timestamp: activity.timestamp.toISOString(),
      createdBy: activity.createdBy ?? undefined,
    };
  }

  async createEntry(dto: CreatePipelineEntryDto): Promise<PipelineEntry | WriteGuardBlockedResult> {
    const actor: ContractActor = { actorType: "agent", actorId: "pipeline_service_create" };
    const approvalDecision = this.governanceGuard.requireWriteApproval({
      module: "pipeline",
      action: "create",
      entityType: "pipeline_entry",
      entityId: dto.orgName,
      actor,
      reason: "Create pipeline entry",
      before: null,
      after: dto,
      approval: this.mapApproval(dto.approval),
    });
    if (!approvalDecision.approved) {
      return this.buildWriteGuardBlock(
        approvalDecision.reason,
        approvalDecision.preview as unknown as Record<string, unknown>,
      );
    }

    const fundingLane = dto.fundingLane ?? null;
    const row = await this.prisma.pipelineEntry.create({
      data: {
        orgName: dto.orgName,
        contactName: dto.contactName ?? null,
        contactEmail: dto.contactEmail ?? null,
        stage: dto.stage,
        owner: dto.owner ?? null,
        nextAction: dto.nextAction ?? null,
        nextActionDate: dto.nextActionDate
          ? new Date(dto.nextActionDate)
          : null,
        lastContactDate: dto.lastContactDate
          ? new Date(dto.lastContactDate)
          : null,
        probability: dto.probability ?? null,
        notes: dto.notes ?? null,
        sectorTags: dto.sectorTags ?? [],
        geography: dto.geography ?? null,
        estimatedGrantSize: dto.estimatedGrantSize ?? null,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        submissionEmail: dto.submissionEmail ?? null,
        driveFolderUrl: dto.driveFolderUrl ?? null,
        fundingLane,
        complianceRiskFlag: null,
        bankRouteHint: fundingLane ? bankRouteHintForLane(fundingLane) : null,
      },
    });
    return dbToPipelineEntry(row);
  }

  async updateEntry(
    id: string,
    dto: UpdatePipelineEntryDto,
  ): Promise<PipelineEntry | WriteGuardBlockedResult> {
    const existing = await this.prisma.pipelineEntry.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Pipeline entry ${id} not found`);
    }
    if (existing.version !== dto.version) {
      throw new ConflictException(
        "Version mismatch; reload the entry and retry",
      );
    }
    const actor: ContractActor = { actorType: "agent", actorId: "pipeline_service_update" };
    const approvalDecision = this.governanceGuard.requireWriteApproval({
      module: "pipeline",
      action: "update",
      entityType: "pipeline_entry",
      entityId: id,
      actor,
      reason: "Update pipeline entry",
      before: dbToPipelineEntry(existing),
      after: dto,
      approval: this.mapApproval(dto.approval),
    });
    if (!approvalDecision.approved) {
      return this.buildWriteGuardBlock(
        approvalDecision.reason,
        approvalDecision.preview as unknown as Record<string, unknown>,
      );
    }

    const row = await this.prisma.pipelineEntry.update({
      where: { id },
      data: {
        ...(dto.orgName !== undefined && { orgName: dto.orgName }),
        ...(dto.contactName !== undefined && { contactName: dto.contactName }),
        ...(dto.contactEmail !== undefined && {
          contactEmail: dto.contactEmail,
        }),
        ...(dto.stage !== undefined && { stage: dto.stage }),
        ...(dto.owner !== undefined && { owner: dto.owner }),
        ...(dto.nextAction !== undefined && { nextAction: dto.nextAction }),
        ...(dto.nextActionDate !== undefined && {
          nextActionDate: new Date(dto.nextActionDate),
        }),
        ...(dto.lastContactDate !== undefined && {
          lastContactDate: new Date(dto.lastContactDate),
        }),
        ...(dto.probability !== undefined && { probability: dto.probability }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.sectorTags !== undefined && { sectorTags: dto.sectorTags }),
        ...(dto.geography !== undefined && { geography: dto.geography }),
        ...(dto.estimatedGrantSize !== undefined && {
          estimatedGrantSize: dto.estimatedGrantSize,
        }),
        ...(dto.deadline !== undefined && {
          deadline: dto.deadline ? new Date(dto.deadline) : null,
        }),
        ...(dto.submissionEmail !== undefined && {
          submissionEmail: dto.submissionEmail,
        }),
        ...(dto.driveFolderUrl !== undefined && {
          driveFolderUrl: dto.driveFolderUrl,
        }),
        ...(dto.fundingLane !== undefined && {
          fundingLane: dto.fundingLane,
          bankRouteHint: bankRouteHintForLane(dto.fundingLane),
        }),
        ...(dto.foreignSourceHint !== undefined && {
          foreignSourceHint: dto.foreignSourceHint,
        }),
        ...(dto.csr1Status !== undefined && { csr1Status: dto.csr1Status }),
        ...(dto.csr1Number !== undefined && { csr1Number: dto.csr1Number }),
        ...(dto.grantAgreementStatus !== undefined && {
          grantAgreementStatus: dto.grantAgreementStatus,
        }),
        ...(dto.reportingCadence !== undefined && {
          reportingCadence: dto.reportingCadence,
        }),
        ...(dto.ucDueDate !== undefined && {
          ucDueDate: dto.ucDueDate ? new Date(dto.ucDueDate) : null,
        }),
        ...(dto.impactReportDueDate !== undefined && {
          impactReportDueDate: dto.impactReportDueDate
            ? new Date(dto.impactReportDueDate)
            : null,
        }),
        version: { increment: 1 },
      },
    });
    return dbToPipelineEntry(row);
  }

  /** Set funding lane for an entry; computes bankRouteHint. FCRA guardrail: foreign-source orgs cannot use DOMESTIC_80G/CSR. */
  async setLane(
    entryId: string,
    lane: FundingLane,
    approval?: ApprovalContextDto,
  ): Promise<PipelineEntry | WriteGuardBlockedResult> {
    const existing = await this.prisma.pipelineEntry.findUnique({
      where: { id: entryId },
    });
    if (!existing) {
      throw new NotFoundException(`Pipeline entry ${entryId} not found`);
    }
    if (existing.foreignSourceHint && (lane === "DOMESTIC_80G" || lane === "CSR")) {
      throw new ConflictException(
        "This org is marked as foreign source / diaspora / foreign foundation. Use funding lane FCRA only. Do not route to domestic or CSR.",
      );
    }
    const actor: ContractActor = { actorType: "agent", actorId: "pipeline_service_set_lane" };
    const approvalDecision = this.governanceGuard.requireWriteApproval({
      module: "pipeline",
      action: "update",
      entityType: "pipeline_entry_lane",
      entityId: entryId,
      actor,
      reason: "Set pipeline funding lane",
      before: { fundingLane: existing.fundingLane, bankRouteHint: existing.bankRouteHint },
      after: { fundingLane: lane, bankRouteHint: bankRouteHintForLane(lane) },
      approval: this.mapApproval(approval),
    });
    if (!approvalDecision.approved) {
      return this.buildWriteGuardBlock(
        approvalDecision.reason,
        approvalDecision.preview as unknown as Record<string, unknown>,
      );
    }

    const row = await this.prisma.pipelineEntry.update({
      where: { id: entryId },
      data: {
        fundingLane: lane,
        bankRouteHint: bankRouteHintForLane(lane),
        version: { increment: 1 },
      },
    });
    this.logger.log(`Set funding lane ${lane} for entry ${entryId}`);
    return dbToPipelineEntry(row);
  }

  /** Find first pipeline entry whose orgName matches (case-insensitive). */
  async findEntryByOrgName(orgName: string): Promise<PipelineEntry | null> {
    const row = await this.prisma.pipelineEntry.findFirst({
      where: { orgName: { equals: orgName, mode: "insensitive" } },
    });
    return row ? dbToPipelineEntry(row) : null;
  }

  /** CSR pack: checklist + due dates for an org (by id or org name). */
  async getCsrPack(orgOrId: string): Promise<{
    orgName: string;
    fundingLane?: string;
    csr1Status?: string;
    csr1Number?: string;
    grantAgreementStatus?: string;
    reportingCadence?: string;
    ucDueDate?: string;
    impactReportDueDate?: string;
    checklist: string[];
  } | null> {
    const entry = isUuid(orgOrId)
      ? await this.getEntry(orgOrId)
      : await this.findEntryByOrgName(orgOrId);
    if (!entry) return null;
    const checklist: string[] = [];
    if (entry.fundingLane !== "CSR") {
      checklist.push("Set funding lane to CSR for this org");
    } else {
      if (!entry.csr1Status) checklist.push("Set CSR-1 status (yes/no)");
      if (!entry.csr1Number) checklist.push("Add CSR-1 number");
      if (!entry.grantAgreementStatus) checklist.push("Set grant agreement status");
      if (!entry.reportingCadence) checklist.push("Set reporting cadence (quarterly/half-yearly)");
      if (!entry.ucDueDate) checklist.push("Set UC due date");
      if (!entry.impactReportDueDate) checklist.push("Set impact report due date");
      if (checklist.length === 0) checklist.push("CSR pack complete");
    }
    return {
      orgName: entry.orgName!,
      fundingLane: entry.fundingLane,
      csr1Status: entry.csr1Status,
      csr1Number: entry.csr1Number,
      grantAgreementStatus: entry.grantAgreementStatus,
      reportingCadence: entry.reportingCadence,
      ucDueDate: entry.ucDueDate,
      impactReportDueDate: entry.impactReportDueDate,
      checklist,
    };
  }

  /** CSR entries with UC or impact report due within the next N days. */
  async getCsrDueInNextDays(days: number): Promise<PipelineEntry[]> {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + days);
    const rows = await this.prisma.pipelineEntry.findMany({
      where: {
        fundingLane: "CSR",
        OR: [
          {
            ucDueDate: { gte: now, lte: end },
          },
          {
            impactReportDueDate: { gte: now, lte: end },
          },
        ],
      },
      orderBy: { ucDueDate: "asc" },
    });
    return rows.map(dbToPipelineEntry);
  }

  async getEntry(id: string): Promise<PipelineEntry> {
    const row = await this.prisma.pipelineEntry.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException(`Pipeline entry ${id} not found`);
    }
    return dbToPipelineEntry(row);
  }

  async getActivitiesForEntry(id: string): Promise<ActivityRecord[]> {
    const existing = await this.prisma.pipelineEntry.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Pipeline entry ${id} not found`);
    }
    const activities = await this.prisma.activity.findMany({
      where: { pipelineEntryId: id },
      orderBy: { timestamp: "desc" },
    });
    return activities.map(dbToActivityRecord);
  }

  /** All activities (for export to Sheets), ordered by timestamp desc. */
  async getAllActivities(): Promise<ActivityRecord[]> {
    const activities = await this.prisma.activity.findMany({
      orderBy: { timestamp: "desc" },
    });
    return activities.map(dbToActivityRecord);
  }

  async getNextBestActions(id: string): Promise<NextBestActionResult> {
    const row = await this.prisma.pipelineEntry.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException(`Pipeline entry ${id} not found`);
    }

    const activities = await this.prisma.activity.findMany({
      where: { pipelineEntryId: id },
      orderBy: { timestamp: "desc" },
      take: 25,
    });

    const stage = row.stage as PipelineStage;
    const now = new Date();
    const updatedAt = (row as { updatedAt?: Date }).updatedAt ?? null;
    const stageAgeDays = daysSince(updatedAt, now);
    const mostRecentActivity = activities[0]?.timestamp ?? row.lastContactDate ?? null;
    const inactivityDays = daysSince(mostRecentActivity, now);
    const hasMeeting = activities.some((a) => a.type === "meeting");
    const hasProposalSubmission = activities.some((a) => a.type === "proposal_submitted");

    const suggestions: NextBestActionSuggestion[] = [];
    const pushSuggestion = (candidate: NextBestActionSuggestion) => {
      if (!isStageAdvanceValid(stage, candidate.targetStage)) return;
      if (suggestions.some((s) => s.title === candidate.title)) return;
      suggestions.push(candidate);
    };

    if (row.nextAction && row.nextActionDate && new Date(row.nextActionDate) < now) {
      pushSuggestion({
        title: `Complete overdue next action: ${row.nextAction}`,
        reason: "Current next action due date is in the past.",
        priority: "high",
      });
    }

    if (stageAgeDays !== null && stageAgeDays >= 21) {
      pushSuggestion({
        title: `Unblock progress from ${stage}`,
        reason: `Opportunity has remained in ${stage} for ${stageAgeDays} days.`,
        priority: "high",
      });
    }

    if (inactivityDays === null || inactivityDays >= 14) {
      pushSuggestion({
        title: "Re-establish contact and capture response",
        reason:
          inactivityDays === null
            ? "No prior contact activity is recorded."
            : `No recent activity recorded for ${inactivityDays} days.`,
        priority: "high",
      });
    }

    switch (stage) {
      case "RFP_received":
        pushSuggestion({
          title: "Run rapid fit review and assign owner",
          reason: "RFP intake should move quickly into a qualified owner-led path.",
          priority: "high",
          targetStage: "lead",
        });
        pushSuggestion({
          title: "Extract eligibility, deadlines, and submission constraints",
          reason: "Early extraction reduces missed compliance and timing risk.",
          priority: "medium",
          targetStage: "lead",
        });
        break;
      case "lead":
        pushSuggestion({
          title: "Qualify opportunity and define go/no-go",
          reason: "Lead stage should converge on qualification criteria and next gate.",
          priority: "high",
          targetStage: "qualified",
        });
        if (!hasMeeting) {
          pushSuggestion({
            title: "Schedule intro or discovery meeting",
            reason: "No meeting history found; discovery is needed before qualification.",
            priority: "medium",
            targetStage: "lead",
          });
        }
        break;
      case "qualified":
        pushSuggestion({
          title: "Draft proposal narrative and budget skeleton",
          reason: "Qualified opportunities should move into a proposal-ready package.",
          priority: "high",
          targetStage: "proposal_sent",
        });
        pushSuggestion({
          title: "Set internal review checkpoint before submission",
          reason: "Review checkpoints reduce avoidable revisions and deadline risk.",
          priority: "medium",
          targetStage: "qualified",
        });
        break;
      case "proposal_sent":
        pushSuggestion({
          title: "Send follow-up and confirm decision timeline",
          reason: "Post-submission follow-up improves conversion and planning clarity.",
          priority: "high",
          targetStage: "won",
        });
        if (!hasProposalSubmission) {
          pushSuggestion({
            title: "Log submission evidence and acknowledgement",
            reason: "Proposal stage should include explicit submission traceability.",
            priority: "medium",
            targetStage: "proposal_sent",
          });
        }
        break;
      case "won":
        pushSuggestion({
          title: "Kick off implementation and reporting cadence",
          reason: "Won opportunities should transition to delivery and compliance tracking.",
          priority: "medium",
          targetStage: "won",
        });
        if (row.fundingLane === "CSR" && (!row.ucDueDate || !row.impactReportDueDate)) {
          pushSuggestion({
            title: "Complete CSR compliance due dates",
            reason: "CSR wins require UC and impact-report deadlines to be set.",
            priority: "high",
            targetStage: "won",
          });
        }
        break;
      case "lost":
        pushSuggestion({
          title: "Capture loss reasons and archive playbook notes",
          reason: "Loss learnings improve future qualification and messaging.",
          priority: "medium",
        });
        break;
      default:
        pushSuggestion({
          title: "Validate stage and assign a concrete next action",
          reason: "Unknown stage should be normalized before progression.",
          priority: "high",
        });
        break;
    }

    const topSuggestions = suggestions
      .sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority))
      .slice(0, 3);

    return {
      entryId: row.id,
      orgName: row.orgName,
      stage,
      generatedAt: now.toISOString(),
      suggestions: topSuggestions.length
        ? topSuggestions
        : [
            {
              title: "Set a concrete next action with due date",
              reason: "A clear next action is required to keep opportunity momentum.",
              priority: "high",
            },
          ],
    };
  }
}

function dbToActivityRecord(a: {
  id: string;
  donorId: string | null;
  orgId: string | null;
  type: string;
  notes: string | null;
  timestamp: Date;
  createdBy: string | null;
}): ActivityRecord {
  return {
    id: a.id,
    donorId: a.donorId ?? undefined,
    orgId: a.orgId ?? undefined,
    type: a.type as ActivityRecord["type"],
    notes: a.notes ?? undefined,
    timestamp: a.timestamp.toISOString(),
    createdBy: a.createdBy ?? undefined,
  };
}

function dbToPipelineEntry(row: {
  id: string;
  orgName: string;
  contactName: string | null;
  contactEmail: string | null;
  stage: string;
  owner: string | null;
  nextAction: string | null;
  nextActionDate: Date | null;
  lastContactDate: Date | null;
  probability: number | null;
  notes: string | null;
  sectorTags: string[];
  geography: string | null;
  estimatedGrantSize: string | null;
  deadline: Date | null;
  submissionEmail: string | null;
  driveFolderUrl: string | null;
  fundingLane: string | null;
  complianceRiskFlag: string | null;
  bankRouteHint: string | null;
  foreignSourceHint: boolean | null;
  csr1Status: string | null;
  csr1Number: string | null;
  grantAgreementStatus: string | null;
  reportingCadence: string | null;
  ucDueDate: Date | null;
  impactReportDueDate: Date | null;
}): PipelineEntry {
  return {
    id: row.id,
    orgName: row.orgName,
    contactName: row.contactName ?? undefined,
    contactEmail: row.contactEmail ?? undefined,
    stage: row.stage as PipelineEntry["stage"],
    assignedTo: row.owner ?? undefined,
    nextAction: row.nextAction ?? undefined,
    nextActionDate: row.nextActionDate?.toISOString() ?? undefined,
    lastContactDate: row.lastContactDate?.toISOString() ?? undefined,
    probability: row.probability ?? undefined,
    notes: row.notes ?? undefined,
    sectorTags: row.sectorTags?.length ? row.sectorTags : undefined,
    geography: row.geography ?? undefined,
    estimatedGrantSize: row.estimatedGrantSize ?? undefined,
    deadline: row.deadline?.toISOString() ?? undefined,
    submissionEmail: row.submissionEmail ?? undefined,
    driveFolderUrl: row.driveFolderUrl ?? undefined,
    fundingLane: (row.fundingLane as PipelineEntry["fundingLane"]) ?? undefined,
    complianceRiskFlag: row.complianceRiskFlag ?? undefined,
    bankRouteHint: row.bankRouteHint ?? undefined,
    foreignSourceHint: row.foreignSourceHint ?? undefined,
    csr1Status: row.csr1Status ?? undefined,
    csr1Number: row.csr1Number ?? undefined,
    grantAgreementStatus: row.grantAgreementStatus ?? undefined,
    reportingCadence: row.reportingCadence ?? undefined,
    ucDueDate: row.ucDueDate?.toISOString() ?? undefined,
    impactReportDueDate: row.impactReportDueDate?.toISOString() ?? undefined,
  };
}
