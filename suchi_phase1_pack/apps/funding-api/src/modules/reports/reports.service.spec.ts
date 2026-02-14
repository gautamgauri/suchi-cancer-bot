import { ConfigService } from "@nestjs/config";
import { ReportsService } from "./reports.service";
import { PipelineService } from "../pipeline/pipeline.service";
import { RetrievalService } from "../evidence_ingest/retrieval.service";

describe("ReportsService", () => {
  let service: ReportsService;

  const mockPipeline = {
    getEntries: jest.fn(),
    getNextBestActions: jest.fn(),
    getEntry: jest.fn(),
    getActivitiesForEntry: jest.fn(),
    findEntryByOrgName: jest.fn(),
  } as unknown as PipelineService;

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === "FUNDING_STALLED_PROSPECT_DAYS") return 30;
      return undefined;
    }),
  } as unknown as ConfigService;

  const mockRetrieval = {
    retrieve: jest.fn(),
  } as unknown as RetrievalService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportsService(mockPipeline, mockConfig, mockRetrieval);
  });

  it("applies stale threshold override for stalled prospects", async () => {
    (mockPipeline.getEntries as jest.Mock).mockResolvedValue([
      {
        id: "e1",
        orgName: "Alpha Org",
        stage: "qualified",
        lastContactDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "e2",
        orgName: "Beta Org",
        stage: "proposal_sent",
        lastContactDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
    (mockPipeline.getNextBestActions as jest.Mock).mockResolvedValue({
      suggestions: [{ title: "Follow up with donor" }],
    });

    const result = await service.getStalledProspects(10);
    expect(result.staleThresholdDays).toBe(10);
    expect(result.count).toBe(1);
    expect(result.nudges[0].orgName).toBe("Alpha Org");
    expect(result.nudges[0].recommendations.length).toBeGreaterThan(0);
    expect(result.nudges[0].slackMessagePreview).toContain("Stalled Prospect Nudge");
  });

  it("generates meeting prep brief with required sections and citations", async () => {
    (mockPipeline.getEntry as jest.Mock).mockResolvedValue({
      id: "entry-1",
      orgName: "Gamma Foundation",
      stage: "proposal_sent",
      contactName: "Priya",
      contactEmail: "priya@example.org",
      nextAction: "Follow up next week",
      nextActionDate: new Date().toISOString(),
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      geography: "Bengaluru",
      sectorTags: ["education"],
    });
    (mockPipeline.getActivitiesForEntry as jest.Mock).mockResolvedValue([
      {
        id: "a1",
        type: "meeting",
        notes: "Budget clarifications requested",
        timestamp: new Date().toISOString(),
      },
    ]);
    (mockRetrieval.retrieve as jest.Mock).mockResolvedValue([
      {
        id: "chunk-1",
        source: "doc-1",
        text: "Funder prioritizes outcomes in adolescent learning.",
        title: "Donor brief",
        urlOrPath: "https://example.org/doc-1",
      },
    ]);

    const brief = await service.getMeetingPrepBrief("entry-1");
    expect(brief.orgName).toBe("Gamma Foundation");
    expect(brief.summaryForSlack).toBeDefined();
    expect(brief.summaryForSlack).toContain("Gamma Foundation");
    expect(brief.summaryForSlack).toContain("proposal_sent");
    expect(brief.donorProfile.length).toBeGreaterThan(0);
    expect(brief.proposalStatus.length).toBeGreaterThan(0);
    expect(brief.askStrategy.length).toBeGreaterThan(0);
    expect(brief.suggestedQuestions).toHaveLength(5);
    expect(brief.briefText).toContain("## References");
    expect(brief.references.length).toBeGreaterThan(0);
    expect(brief.references[0].url).toBe("https://example.org/doc-1");
  });

  it("getMeetingPrepBriefForOrgOrId resolves org name to entry and returns brief", async () => {
    (mockPipeline.findEntryByOrgName as jest.Mock).mockResolvedValue({
      id: "entry-1",
      orgName: "Gamma Foundation",
      stage: "proposal_sent",
    });
    (mockPipeline.getEntry as jest.Mock).mockResolvedValue({
      id: "entry-1",
      orgName: "Gamma Foundation",
      stage: "proposal_sent",
      contactName: "Priya",
      nextAction: "Follow up",
      geography: "Bengaluru",
      sectorTags: [],
    });
    (mockPipeline.getActivitiesForEntry as jest.Mock).mockResolvedValue([]);
    (mockRetrieval.retrieve as jest.Mock).mockResolvedValue([
      { id: "c1", source: "d1", text: "Context.", title: "Doc", urlOrPath: undefined },
    ]);

    const brief = await service.getMeetingPrepBriefForOrgOrId("Gamma Foundation");
    expect(brief.entryId).toBe("entry-1");
    expect(brief.orgName).toBe("Gamma Foundation");
    expect(mockPipeline.findEntryByOrgName).toHaveBeenCalledWith("Gamma Foundation");
  });
});
