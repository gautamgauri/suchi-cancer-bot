import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { OpportunityDocument, OpportunityPayload } from "./opportunity.types";
import type { OpportunityRecord } from "./opportunity.service";
import { OpportunityFitScoreService } from "./opportunity-fit-score.service";
import { OpportunityService } from "./opportunity.service";
import { OpportunityIntelligenceService } from "./extract/opportunity-intelligence.service";

describe("OpportunityFitScoreService", () => {
  let service: OpportunityFitScoreService;
  let opportunityService: OpportunityService;

  const mockPayload: OpportunityPayload = {
    opportunityId: "OPP-TEST123",
    source: {
      emailMessageId: "msg-1",
      threadId: "t-1",
      receivedAt: new Date().toISOString(),
      from: { email: "funder@example.com" },
      to: [],
      subject: "RFP Education",
      attachments: [],
    },
    funder: { name: "Test Funder", programName: "Education Grants" },
    keyConstraints: {
      deadline: "2026-03-01",
      geography: ["Bihar", "India"],
      maxGrantAmountINR: 50_00_000,
    },
    themes: { primary: ["education", "livelihood"], secondary: [] },
  };

  const mockRecord: OpportunityRecord = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    opportunityId: "OPP-TEST123",
    schemaVersion: "1.0",
    jsonBlob: { schemaVersion: "1.0", opportunity: mockPayload },
    status: "received",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockOpportunityService = {
    findById: jest.fn(),
    findByOpportunityId: jest.fn(),
    getPayload: jest.fn((r: OpportunityRecord) => (r.jsonBlob as OpportunityDocument).opportunity),
    update: jest.fn().mockResolvedValue(undefined),
  };

  const mockCard = {
    funder: "Test Funder",
    program: "Education Grants",
    deadline: "2026-03-01",
    fcraRelevance: "not_mentioned" as const,
    geographyFit: "strong_fit" as const,
    thematicFit: "strong_fit" as const,
    confidence: 0.8,
  };

  const mockFitAssessment = {
    score: 85,
    reasons: [
      "Deadline identified: 2026-03-01.",
      "Geography strongly overlaps with current focus geographies.",
      "Themes strongly align with education and livelihood priorities.",
      "Grant size signal available: INR 50,00,000.",
    ],
    confidence: 0.8,
    missingInfo: [] as Array<{ field: string; question: string; priority: string }>,
  };

  const mockIntelligence = {
    buildCard: jest.fn().mockReturnValue(mockCard),
    buildFitAssessment: jest.fn().mockReturnValue(mockFitAssessment),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOpportunityService.getPayload.mockImplementation((r: OpportunityRecord) =>
      (r.jsonBlob as OpportunityDocument).opportunity,
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpportunityFitScoreService,
        { provide: OpportunityService, useValue: mockOpportunityService },
        { provide: OpportunityIntelligenceService, useValue: mockIntelligence },
      ],
    }).compile();
    service = module.get<OpportunityFitScoreService>(OpportunityFitScoreService);
    opportunityService = module.get<OpportunityService>(OpportunityService);
  });

  it("returns stored triageCard and fitAssessment when present and refresh=false", async () => {
    const storedPayload = {
      ...mockPayload,
      triageCard: mockCard,
      fitAssessment: mockFitAssessment,
    };
    const recordWithStored = {
      ...mockRecord,
      jsonBlob: { schemaVersion: "1.0", opportunity: storedPayload },
    };
    mockOpportunityService.findByOpportunityId.mockResolvedValue(recordWithStored);

    const result = await service.getFitScore("OPP-TEST123");

    expect(result.triageCard).toEqual(mockCard);
    expect(result.fitAssessment).toEqual(mockFitAssessment);
    expect(mockIntelligence.buildCard).not.toHaveBeenCalled();
    expect(mockIntelligence.buildFitAssessment).not.toHaveBeenCalled();
  });

  it("recomputes when refresh=true", async () => {
    const storedPayload = {
      ...mockPayload,
      triageCard: mockCard,
      fitAssessment: mockFitAssessment,
    };
    const recordWithStored = {
      ...mockRecord,
      jsonBlob: { schemaVersion: "1.0", opportunity: storedPayload },
    };
    mockOpportunityService.findByOpportunityId.mockResolvedValue(recordWithStored);

    const result = await service.getFitScore("OPP-TEST123", { refresh: true });

    expect(mockIntelligence.buildCard).toHaveBeenCalled();
    expect(mockIntelligence.buildFitAssessment).toHaveBeenCalled();
    expect(result.triageCard).toEqual(mockCard);
    expect(result.fitAssessment).toEqual(mockFitAssessment);
  });

  it("computes fit when no stored assessment", async () => {
    mockOpportunityService.findByOpportunityId.mockResolvedValue(mockRecord);

    const result = await service.getFitScore("OPP-TEST123");

    expect(mockIntelligence.buildCard).toHaveBeenCalled();
    expect(mockIntelligence.buildFitAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: mockPayload,
        card: mockCard,
      }),
    );
    expect(result.fitAssessment.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("throws NotFoundException when opportunity does not exist", async () => {
    mockOpportunityService.findByOpportunityId.mockResolvedValue(null);
    mockOpportunityService.findById.mockRejectedValue(new NotFoundException("not found"));

    await expect(service.getFitScore("OPP-NONEXISTENT")).rejects.toThrow(NotFoundException);
  });
});
