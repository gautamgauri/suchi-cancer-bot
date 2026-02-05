import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { FundingLlmService } from "./funding-llm.service";

const mockCreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

jest.mock("../../common/structured-logger", () => ({
  logStructured: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function mockConfig(overrides: Record<string, string | number | undefined> = {}) {
  return {
    get: jest.fn((key: string) => {
      const env: Record<string, string | number | undefined> = {
        FUNDING_OPENAI_API_KEY: "test-key",
        FUNDING_MODEL_DRAFT: "deepseek-chat",
        FUNDING_MODEL_EVAL: "deepseek-chat",
        FUNDING_LLM_TIMEOUT_MS: 5000,
        FUNDING_LLM_MAX_RETRIES: 2,
        FUNDING_LLM_RETRY_DELAY_MS: 10,
        ...overrides,
      };
      return env[key];
    }),
  };
}

function makeChunk(overrides: Partial<{ chunkId: string; docId: string; content: string; title: string }> = {}) {
  return {
    chunkId: "chunk1",
    docId: "doc1",
    content: "Evidence text.",
    document: { title: "Doc Title" },
    ...overrides,
  };
}

describe("FundingLlmService", () => {
  let service: FundingLlmService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("retry behavior", () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [FundingLlmService, { provide: ConfigService, useValue: mockConfig({ FUNDING_LLM_RETRY_DELAY_MS: 10 }) }],
      }).compile();
      service = module.get<FundingLlmService>(FundingLlmService);
    });

    it("retries on transient error then succeeds", async () => {
      const validResponse = { choices: [{ message: { content: "Draft with [citation:doc1:chunk1]." } }] };
      mockCreate
        .mockRejectedValueOnce(Object.assign(new Error("503"), { status: 503 }))
        .mockResolvedValueOnce(validResponse);

      const result = await service.generateWithCitations(
        "draft",
        "Context",
        "Draft need statement",
        [makeChunk() as any]
      );

      expect(result).toContain("[citation:");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 4xx and throws", async () => {
      mockCreate.mockRejectedValueOnce(Object.assign(new Error("Bad request"), { status: 400 }));

      await expect(
        service.generateWithCitations("draft", "Context", "Draft", [makeChunk() as any])
      ).rejects.toMatchObject({ message: "Bad request" });

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("returns MISSING_EVIDENCE fallback after timeout when retries exhausted", async () => {
      mockCreate.mockRejectedValue(new DOMException("aborted", "AbortError"));

      const result = await service.generateWithCitations(
        "draft",
        "Context",
        "Draft",
        [makeChunk() as any]
      );

      expect(result).toContain("MISSING_EVIDENCE");
      expect(mockCreate).toHaveBeenCalledTimes(3); // maxRetries 2 => 3 attempts
    });

    it("generatePlain returns empty string after timeout when retries exhausted", async () => {
      mockCreate.mockRejectedValue(new DOMException("aborted", "AbortError"));

      const result = await service.generatePlain("You are a helper.", "Context", "Hello");

      expect(result).toBe("");
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe("empty response", () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [FundingLlmService, { provide: ConfigService, useValue: mockConfig() }],
      }).compile();
      service = module.get<FundingLlmService>(FundingLlmService);
    });

    it("returns MISSING_EVIDENCE when API returns empty content", async () => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: "" } }] });

      const result = await service.generateWithCitations(
        "draft",
        "Context",
        "Draft",
        [makeChunk() as any]
      );

      expect(result).toContain("MISSING_EVIDENCE");
    });

    it("returns MISSING_EVIDENCE when chunks is empty (no API call)", async () => {
      const result = await service.generateWithCitations("draft", "Context", "Draft", []);

      expect(result).toContain("MISSING_EVIDENCE");
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("callEvalModel (no timeout fallback)", () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [FundingLlmService, { provide: ConfigService, useValue: mockConfig() }],
      }).compile();
      service = module.get<FundingLlmService>(FundingLlmService);
    });

    it("evaluateDraft returns parsed score and weaknesses", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: '{"score": 4, "dimensions": {"clarity": 4}, "weaknesses": ["Add more evidence."]}',
            },
          },
        ],
      });

      const result = await service.evaluateDraft("Some draft text.");

      expect(result.score).toBe(4);
      expect(result.weaknesses).toContain("Add more evidence.");
    });

    it("evaluateDraft returns fallback when JSON invalid", async () => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: "not json" } }] });

      const result = await service.evaluateDraft("Draft.");

      expect(result.score).toBe(3);
      expect(Array.isArray(result.weaknesses)).toBe(true);
    });
  });
});
