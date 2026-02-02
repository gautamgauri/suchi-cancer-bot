import { Test, TestingModule } from "@nestjs/testing";
import { DonorService } from "./donor.service";
import { FundingLlmService } from "../core_ai/funding-llm.service";

describe("DonorService", () => {
  let donorService: DonorService;

  const mockLlm = {
    generateDonorProfile: jest.fn().mockResolvedValue({
      mission: "Test mission",
      focusAreas: ["health", "education"],
      geographicFocus: "US",
      pastGrants: "Unknown",
      eligibilityNotes: "Nonprofits",
      contactNotes: "See website",
      evidenceGaps: ["TODO: verify contact"],
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DonorService,
        { provide: FundingLlmService, useValue: mockLlm },
      ],
    }).compile();

    donorService = module.get<DonorService>(DonorService);
  });

  it("generateProfile calls LLM with orgName and returns profile + evidenceGaps", async () => {
    const result = await donorService.generateProfile({
      orgName: "Example Foundation",
      urls: ["https://example.org"],
      notes: "Health focus",
    });
    expect(mockLlm.generateDonorProfile).toHaveBeenCalledWith({
      orgName: "Example Foundation",
      urls: ["https://example.org"],
      notes: "Health focus",
      chunks: undefined,
    });
    expect(result).toHaveProperty("mission", "Test mission");
    expect(result).toHaveProperty("evidenceGaps");
    expect(Array.isArray(result.evidenceGaps)).toBe(true);
  });

  it("generateProfile passes chunks when provided", async () => {
    await donorService.generateProfile({
      orgName: "Acme Fund",
      chunks: [{ content: "Acme funds education.", title: "About" }],
    });
    expect(mockLlm.generateDonorProfile).toHaveBeenCalledWith({
      orgName: "Acme Fund",
      urls: undefined,
      notes: undefined,
      chunks: [{ content: "Acme funds education.", title: "About", url: undefined }],
    });
  });
});
