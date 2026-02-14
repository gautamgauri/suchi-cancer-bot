import { Test, TestingModule } from "@nestjs/testing";
import { PipelineService } from "./pipeline.service";
import { PrismaService } from "../prisma/prisma.service";
import { SheetsClientService } from "../sheets/sheets-client.service";
import { GovernanceDeliveryGuard } from "../notifications/governance-delivery.guard";

describe("PipelineService", () => {
  let pipelineService: PipelineService;

  const mockSheets = {
    isConfigured: () => false,
    appendActivity: () => Promise.resolve(),
    getPipelineEntries: () => Promise.resolve(null),
  };

  const mockPrisma = {
    pipelineEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    activity: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "act-uuid-1",
          pipelineEntryId: data.pipelineEntryId ?? null,
          donorId: data.donorId ?? null,
          orgId: data.orgId ?? null,
          type: data.type,
          notes: data.notes ?? null,
          timestamp: data.timestamp ?? new Date(),
          createdBy: data.createdBy ?? null,
        }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockGovernanceGuard = {
    requireWriteApproval: jest.fn().mockImplementation((params) => ({
      approved: true,
      reason: "approved",
      preview: {
        previewId: "prv-1",
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        actor: params.actor,
        reason: params.reason,
        timestamp: new Date().toISOString(),
        before: params.before,
        after: params.after,
      },
      approval: params.approval,
      audit: {
        eventId: "evt-1",
        eventType: "funding.write.confirmed",
        module: params.module,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        actor: params.actor,
        timestamp: new Date().toISOString(),
        status: "accepted",
      },
    })),
  };

  beforeEach(async () => {
    mockGovernanceGuard.requireWriteApproval.mockClear();
    mockPrisma.pipelineEntry.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SheetsClientService, useValue: mockSheets },
        { provide: GovernanceDeliveryGuard, useValue: mockGovernanceGuard },
      ],
    }).compile();

    pipelineService = module.get<PipelineService>(PipelineService);
  });

  it("GET pipeline returns entries array", async () => {
    const entries = await pipelineService.getEntries();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(0);
    if (entries.length > 0) {
      expect(entries[0]).toHaveProperty("orgName");
      expect(entries[0]).toHaveProperty("stage");
    }
  });

  it("POST activity returns record with id and timestamp", async () => {
    const record = await pipelineService.logActivity({
      orgId: "org-1",
      type: "email_sent",
      notes: "Intro email sent",
    });
    expect("blocked" in record).toBe(false);
    if ("blocked" in record) {
      throw new Error(`Expected activity record, got guard block: ${record.reason}`);
    }
    expect(record).toHaveProperty("id");
    expect(typeof record.id).toBe("string");
    expect(record.id.length).toBeGreaterThan(0);
    expect(record).toHaveProperty("timestamp");
    expect(record).toHaveProperty("type", "email_sent");
    expect(record).toHaveProperty("notes", "Intro email sent");
  });

  it("returns write preview when approval is blocked", async () => {
    mockGovernanceGuard.requireWriteApproval.mockReturnValueOnce({
      approved: false,
      reason: "missing or invalid write approval",
      preview: {
        previewId: "prv-blocked",
        action: "create",
        entityType: "pipeline_activity",
        entityId: "org-1",
        actor: { actorType: "agent", actorId: "pipeline_service_activity" },
        reason: "Log pipeline activity",
        timestamp: new Date().toISOString(),
        before: null,
        after: { orgId: "org-1", type: "note", notes: "guarded" },
      },
      approval: undefined,
      audit: {
        eventId: "evt-blocked",
        eventType: "funding.write.preview",
        module: "pipeline",
        action: "create",
        entityType: "pipeline_activity",
        entityId: "org-1",
        actor: { actorType: "agent", actorId: "pipeline_service_activity" },
        timestamp: new Date().toISOString(),
        status: "rejected",
      },
    });

    const result = await pipelineService.logActivity({
      orgId: "org-1",
      type: "note",
      notes: "guarded",
    });
    expect(result).toMatchObject({
      blocked: true,
      approvalRequired: true,
      reason: "missing or invalid write approval",
    });
  });

  it("setLane throws ConflictException when foreignSourceHint and lane is DOMESTIC_80G", async () => {
    mockPrisma.pipelineEntry.findUnique.mockResolvedValue({
      id: "entry-1",
      orgName: "Foreign Corp",
      contactName: null,
      contactEmail: null,
      stage: "lead",
      owner: null,
      nextAction: null,
      nextActionDate: null,
      lastContactDate: null,
      probability: null,
      notes: null,
      sectorTags: [],
      geography: null,
      estimatedGrantSize: null,
      deadline: null,
      submissionEmail: null,
      driveFolderUrl: null,
      fundingLane: null,
      complianceRiskFlag: null,
      bankRouteHint: null,
      foreignSourceHint: true,
      csr1Status: null,
      csr1Number: null,
      grantAgreementStatus: null,
      reportingCadence: null,
      ucDueDate: null,
      impactReportDueDate: null,
    });
    await expect(
      pipelineService.setLane("entry-1", "DOMESTIC_80G"),
    ).rejects.toThrow("foreign source");
    await expect(
      pipelineService.setLane("entry-1", "CSR"),
    ).rejects.toThrow("foreign source");
  });

  it("setLane succeeds when lane is FCRA even with foreignSourceHint", async () => {
    mockPrisma.pipelineEntry.findUnique.mockResolvedValue({
      id: "entry-1",
      orgName: "Foreign Corp",
      contactName: null,
      contactEmail: null,
      stage: "lead",
      owner: null,
      nextAction: null,
      nextActionDate: null,
      lastContactDate: null,
      probability: null,
      notes: null,
      sectorTags: [],
      geography: null,
      estimatedGrantSize: null,
      deadline: null,
      submissionEmail: null,
      driveFolderUrl: null,
      fundingLane: null,
      complianceRiskFlag: null,
      bankRouteHint: null,
      foreignSourceHint: true,
      csr1Status: null,
      csr1Number: null,
      grantAgreementStatus: null,
      reportingCadence: null,
      ucDueDate: null,
      impactReportDueDate: null,
    });
    mockPrisma.pipelineEntry.update.mockResolvedValue({
      id: "entry-1",
      orgName: "Foreign Corp",
      fundingLane: "FCRA",
      bankRouteHint: "SBI FCRA account",
      contactName: null,
      contactEmail: null,
      stage: "lead",
      owner: null,
      nextAction: null,
      nextActionDate: null,
      lastContactDate: null,
      probability: null,
      notes: null,
      sectorTags: [],
      geography: null,
      estimatedGrantSize: null,
      deadline: null,
      submissionEmail: null,
      driveFolderUrl: null,
      complianceRiskFlag: null,
      foreignSourceHint: true,
      csr1Status: null,
      csr1Number: null,
      grantAgreementStatus: null,
      reportingCadence: null,
      ucDueDate: null,
      impactReportDueDate: null,
    });
    const result = await pipelineService.setLane("entry-1", "FCRA");
    expect("blocked" in result).toBe(false);
    if ("blocked" in result) {
      throw new Error(`Expected lane update, got guard block: ${result.reason}`);
    }
    expect(result.fundingLane).toBe("FCRA");
    expect(result.bankRouteHint).toBe("SBI FCRA account");
  });

  it("returns stage-aware next-best actions with valid sequencing", async () => {
    mockPrisma.pipelineEntry.findUnique.mockResolvedValue({
      id: "entry-2",
      orgName: "Acme Foundation",
      stage: "lead",
      contactName: null,
      contactEmail: null,
      owner: "owner-1",
      nextAction: "Follow up with prospect",
      nextActionDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      lastContactDate: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
      probability: null,
      notes: null,
      sectorTags: [],
      geography: null,
      estimatedGrantSize: null,
      deadline: null,
      submissionEmail: null,
      driveFolderUrl: null,
      fundingLane: null,
      complianceRiskFlag: null,
      bankRouteHint: null,
      foreignSourceHint: null,
      csr1Status: null,
      csr1Number: null,
      grantAgreementStatus: null,
      reportingCadence: null,
      ucDueDate: null,
      impactReportDueDate: null,
      updatedAt: new Date(Date.now() - 24 * 24 * 60 * 60 * 1000),
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: "a-1",
        type: "email_sent",
        notes: "Followed up",
        timestamp: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
        createdBy: null,
        donorId: null,
        orgId: null,
      },
    ]);

    const result = await pipelineService.getNextBestActions("entry-2");
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
    expect(result.suggestions.some((s) => s.priority === "high")).toBe(true);
    for (const s of result.suggestions) {
      if (!s.targetStage) continue;
      expect(["lead", "qualified"]).toContain(s.targetStage);
    }
  });

  it("does not propose stage advancement from lost stage", async () => {
    mockPrisma.pipelineEntry.findUnique.mockResolvedValue({
      id: "entry-3",
      orgName: "Dormant Org",
      stage: "lost",
      contactName: null,
      contactEmail: null,
      owner: null,
      nextAction: null,
      nextActionDate: null,
      lastContactDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      probability: null,
      notes: null,
      sectorTags: [],
      geography: null,
      estimatedGrantSize: null,
      deadline: null,
      submissionEmail: null,
      driveFolderUrl: null,
      fundingLane: null,
      complianceRiskFlag: null,
      bankRouteHint: null,
      foreignSourceHint: null,
      csr1Status: null,
      csr1Number: null,
      grantAgreementStatus: null,
      reportingCadence: null,
      ucDueDate: null,
      impactReportDueDate: null,
      updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    });
    mockPrisma.activity.findMany.mockResolvedValue([]);

    const result = await pipelineService.getNextBestActions("entry-3");
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(result.suggestions.every((s) => !s.targetStage)).toBe(true);
  });
});
