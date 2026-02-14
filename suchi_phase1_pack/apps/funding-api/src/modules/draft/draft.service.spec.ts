import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { DraftService } from "./draft.service";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import { SourceRegistryService } from "../source_registry/source-registry.service";
import { EmailNotificationService } from "../notifications/email-notification.service";
import { GovernanceDeliveryGuard } from "../notifications/governance-delivery.guard";

describe("DraftService", () => {
  let draftService: DraftService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const env: Record<string, string | number | undefined> = {
        FUNDING_OPENAI_API_KEY: "test-key",
        FUNDING_MODEL_DRAFT: "deepseek-chat",
        FUNDING_MODEL_EVAL: "deepseek-chat",
        FUNDING_LLM_TIMEOUT_MS: 45000,
      };
      return env[key];
    }),
  };

  const mockSourceRegistryService = {
    upsertFromEvidence: jest.fn().mockResolvedValue(null),
    getByDocId: jest.fn().mockResolvedValue(null),
    getByDocIds: jest.fn().mockResolvedValue([]),
    setSnapshotUrl: jest.fn().mockResolvedValue(null),
  };

  const mockEmailNotificationService = {
    sendGeneratedContent: jest.fn().mockResolvedValue({ sent: false, blocked: true }),
  };

  const mockGovernanceGuard = {
    enforceNumericClaimDiscipline: jest.fn((text: string) => ({
      text,
      flaggedCount: 0,
      flaggedLines: [],
    })),
    logAudit: jest.fn(),
  };

  describe("empty chunks -> MISSING_EVIDENCE + checklist (real behavior)", () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DraftService,
          FundingLlmService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: SourceRegistryService, useValue: mockSourceRegistryService },
          { provide: EmailNotificationService, useValue: mockEmailNotificationService },
          { provide: GovernanceDeliveryGuard, useValue: mockGovernanceGuard },
        ],
      }).compile();

      draftService = module.get<DraftService>(DraftService);
    });

    it("returns MISSING_EVIDENCE and a checklist when chunks is empty", async () => {
      const result = await draftService.draftNeedStatement(
        "Context for need statement",
        "Draft a need statement",
        []
      );

      expect(result.text).toContain("MISSING_EVIDENCE");
      expect(result.text.toLowerCase()).toMatch(/checklist|todo/);
    });
  });

  describe("non-empty chunks -> citation + Section 6 (contract test)", () => {
    const mockLlmResponse =
      "**Section 1:** Some draft content [citation:doc1:chunk1].\n\n**Section 6: Evidence Gaps & Next Inputs** TODO: gather more data.";

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DraftService,
          {
            provide: FundingLlmService,
            useValue: {
              generateWithCitations: jest.fn().mockResolvedValue(mockLlmResponse),
            },
          },
          { provide: SourceRegistryService, useValue: mockSourceRegistryService },
          { provide: EmailNotificationService, useValue: mockEmailNotificationService },
          { provide: GovernanceDeliveryGuard, useValue: mockGovernanceGuard },
        ],
      }).compile();

      draftService = module.get<DraftService>(DraftService);
    });

    it("returns text with at least one [citation: and Section 6 when chunks provided", async () => {
      const result = await draftService.draftNeedStatement(
        "Context",
        "Draft need statement",
        [{ id: "chunk1", source: "doc1", text: "Evidence text here.", title: "Doc Title" }]
      );

      expect(result.text).toContain("[citation:");
      expect(result.text).toContain("Section 6");
    });
  });

  describe("draftEmail (smoke)", () => {
    const mockEmailText = "Dear Contact,\n\nThank you for your interest...";

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DraftService,
          {
            provide: FundingLlmService,
            useValue: {
              getEmailPrompt: jest.fn().mockReturnValue("You are a fundraising assistant."),
              generatePlain: jest.fn().mockResolvedValue(mockEmailText),
              generateWithCitations: jest.fn().mockResolvedValue(mockEmailText),
            },
          },
          { provide: SourceRegistryService, useValue: mockSourceRegistryService },
          { provide: EmailNotificationService, useValue: mockEmailNotificationService },
          { provide: GovernanceDeliveryGuard, useValue: mockGovernanceGuard },
        ],
      }).compile();

      draftService = module.get<DraftService>(DraftService);
    });

    it("returns { text } for template-only email (no chunks)", async () => {
      const result = await draftService.draftEmail("intro", "We are Diksha Foundation.", undefined, undefined, []);
      expect(result).toHaveProperty("text");
      expect(result.text).toBe(mockEmailText);
    });

    it("returns { text } when chunks provided (citations path)", async () => {
      const result = await draftService.draftEmail(
        "thank_you",
        "Context",
        { orgName: "Acme", contactName: "Jane" },
        undefined,
        [{ id: "c1", source: "s1", text: "Evidence." }]
      );
      expect(result).toHaveProperty("text");
      expect(result.text).toBe(mockEmailText);
    });
  });

  describe("draftNeedStatementRefine (smoke)", () => {
    const mockDraft = "Draft text with [citation:doc1:chunk1].";
    const mockEvaluation = { score: 4, weaknesses: ["Add more evidence."] };
    const mockRefined = "Refined draft with [citation:doc1:chunk1].";

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DraftService,
          {
            provide: FundingLlmService,
            useValue: {
              generateWithCitations: jest.fn().mockResolvedValue(mockDraft),
              evaluateDraft: jest.fn().mockResolvedValue(mockEvaluation),
              refineDraft: jest.fn().mockResolvedValue(mockRefined),
            },
          },
          { provide: SourceRegistryService, useValue: mockSourceRegistryService },
          { provide: EmailNotificationService, useValue: mockEmailNotificationService },
          { provide: GovernanceDeliveryGuard, useValue: mockGovernanceGuard },
        ],
      }).compile();

      draftService = module.get<DraftService>(DraftService);
    });

    it("returns draft, evaluation, refined", async () => {
      const result = await draftService.draftNeedStatementRefine(
        "Context",
        "Draft need statement",
        [{ id: "chunk1", source: "doc1", text: "Evidence.", title: "Doc" }],
        undefined
      );
      expect(result.draft).toBe(mockDraft);
      expect(result.evaluation).toBeDefined();
      expect(result.evaluation.score).toBe(4);
      expect(Array.isArray(result.evaluation.weaknesses)).toBe(true);
      expect(result.refined).toBe(mockRefined);
    });
  });
});
