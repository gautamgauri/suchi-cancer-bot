import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet, mockPost, mockPatch, mockDefaults } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPatch: vi.fn(),
  mockDefaults: { baseURL: "http://localhost:3001/v1" as string },
}));

vi.mock("axios", () => ({
  default: {
    create: () => ({
      get: mockGet,
      post: mockPost,
      patch: mockPatch,
      defaults: mockDefaults,
    }),
  },
}));

import {
  fundingApiService,
  getFundingApiBaseURL,
  setFundingApiBaseURL,
} from "./fundingApi";

describe("fundingApiService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPipeline", () => {
    it("returns entries from GET /pipeline", async () => {
      const entries = [{ id: "e1", orgName: "Org A", stage: "lead" }];
      mockGet.mockResolvedValueOnce({ data: { entries } });

      const result = await fundingApiService.getPipeline();

      expect(result.entries).toEqual(entries);
      expect(mockGet).toHaveBeenCalledWith("/pipeline");
    });
  });

  describe("logActivity", () => {
    it("sends payload to POST /pipeline/activity and returns record", async () => {
      const payload = { orgId: "org-1", type: "email_sent" as const, notes: "Sent intro" };
      const record = {
        id: "act-1",
        orgId: "org-1",
        type: "email_sent",
        notes: "Sent intro",
        timestamp: new Date().toISOString(),
      };
      mockPost.mockResolvedValueOnce({ data: record });

      const result = await fundingApiService.logActivity(payload);

      expect(result).toEqual(record);
      expect(mockPost).toHaveBeenCalledWith("/pipeline/activity", payload);
    });
  });

  describe("getFundingApiBaseURL / setFundingApiBaseURL", () => {
    it("getFundingApiBaseURL returns default when localStorage is empty", () => {
      const url = getFundingApiBaseURL();
      expect(url).toBeDefined();
      expect(url.length).toBeGreaterThan(0);
      expect(url).toMatch(/\/v1$/);
    });

    it("setFundingApiBaseURL updates axios defaults baseURL", () => {
      setFundingApiBaseURL("https://api.example.com/v1");
      expect(mockDefaults.baseURL).toBe("https://api.example.com/v1");
    });
  });
});
