import { Test, TestingModule } from "@nestjs/testing";
import { PipelineService } from "./pipeline.service";
import { PrismaService } from "../prisma/prisma.service";
import { SheetsClientService } from "../sheets/sheets-client.service";

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

  beforeEach(async () => {
    mockPrisma.pipelineEntry.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SheetsClientService, useValue: mockSheets },
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
    expect(record).toHaveProperty("id");
    expect(typeof record.id).toBe("string");
    expect(record.id.length).toBeGreaterThan(0);
    expect(record).toHaveProperty("timestamp");
    expect(record).toHaveProperty("type", "email_sent");
    expect(record).toHaveProperty("notes", "Intro email sent");
  });
});
