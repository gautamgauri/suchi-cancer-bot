import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { AuditTrailService } from "./audit-trail.service";

describe("AuditTrailService", () => {
  let service: AuditTrailService;
  const mockPrisma = {
    governanceAuditEntry: {
      upsert: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditTrailService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AuditTrailService>(AuditTrailService);
  });

  it("persists audit and does not throw", async () => {
    await service.persist({
      eventId: "evt-test-1",
      eventType: "funding.write.preview",
      module: "pipeline",
      action: "create",
      entityType: "pipeline_entry",
      entityId: "org-1",
      actor: { actorType: "agent", actorId: "test" },
      timestamp: new Date().toISOString(),
      status: "rejected",
      metadata: { enforcement: "BR-GOV-01" },
    });
    expect(mockPrisma.governanceAuditEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-test-1" },
        create: expect.objectContaining({
          eventId: "evt-test-1",
          module: "pipeline",
          status: "rejected",
        }),
      }),
    );
  });

  it("query returns page with entries and total", async () => {
    const result = await service.query({ limit: 10, offset: 0 });
    expect(result).toEqual({
      entries: [],
      total: 0,
      limit: 10,
      offset: 0,
    });
    expect(mockPrisma.governanceAuditEntry.findMany).toHaveBeenCalled();
    expect(mockPrisma.governanceAuditEntry.count).toHaveBeenCalled();
  });

  it("query applies module and status filters", async () => {
    mockPrisma.governanceAuditEntry.findMany.mockResolvedValue([]);
    mockPrisma.governanceAuditEntry.count.mockResolvedValue(0);
    await service.query({
      module: "pipeline",
      status: "rejected",
      limit: 5,
    });
    expect(mockPrisma.governanceAuditEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { module: "pipeline", status: "rejected" },
        take: 5,
      }),
    );
  });
});
