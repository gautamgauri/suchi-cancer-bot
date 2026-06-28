/**
 * Unit tests for LlmService — the LLM-failure → safe-response contract
 * (FR-CHAT-004 / NFR-AVAIL-001).
 *
 * The whole chat pipeline relies on generateWithCitations() NEVER throwing:
 * on provider failure it must return a safe, non-medical fallback string so the
 * user gets a graceful answer instead of a 500. We force failure by stubbing
 * the private callGeminiLLM seam (which itself swallows errors → null).
 *
 * Constructed directly with a ConfigService stub (GEMINI_API_KEY present so the
 * provider resolves to gemini) and a no-op ObservabilityService.
 */

import { LlmService } from "./llm.service";

function makeConfig(overrides: Record<string, string> = {}) {
  const map: Record<string, string> = { GEMINI_API_KEY: "test-key", ...overrides };
  return { get: (key: string) => map[key] };
}

function makeChunks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    docId: `doc-${i}`,
    chunkId: `chunk-${i}`,
    content: `Reference content number ${i} about cancer care.`,
    similarity: 0.8,
    document: { title: `Source ${i}`, sourceType: "kb", isTrustedSource: true },
  }));
}

describe("LlmService — failure → safe response (FR-CHAT-004)", () => {
  let service: LlmService;
  let callGemini: jest.SpyInstance;

  beforeEach(() => {
    service = new LlmService(makeConfig() as never, {} as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callGemini = jest.spyOn(service as any, "callGeminiLLM");
  });

  it("returns the abstention response (never throws) when the LLM yields nothing", async () => {
    callGemini.mockResolvedValue(null);

    const out = await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(5) as never);

    // Safe, non-medical abstention text with Indian helplines — not a thrown 500.
    expect(typeof out).toBe("string");
    expect(out).toContain("1800-22-1951");
    expect(out).not.toMatch(/you have cancer/i);
  });

  it("retries once with reduced context before abstaining when there are >3 chunks", async () => {
    callGemini.mockResolvedValue(null);

    await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(5) as never);

    // First full attempt + one reduced-context retry = 2 provider calls.
    expect(callGemini).toHaveBeenCalledTimes(2);
  });

  it("does not retry when there are <=3 chunks", async () => {
    callGemini.mockResolvedValue(null);

    await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(2) as never);

    expect(callGemini).toHaveBeenCalledTimes(1);
  });

  it("returns the safe fallback (never throws) when the provider call rejects", async () => {
    callGemini.mockRejectedValue(new Error("network down"));

    const out = await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(2) as never);

    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    // Fallback is generic + safety-first, never a diagnosis.
    expect(out).not.toMatch(/you have cancer/i);
  });

  it("returns the model output unchanged on the happy path", async () => {
    const answer = "Chemotherapy uses drugs to treat cancer [citation:doc-0:chunk-0].";
    callGemini.mockResolvedValue(answer);

    const out = await service.generateWithCitations("explain", "", "what is chemotherapy", makeChunks(5) as never);

    expect(out).toBe(answer);
    expect(callGemini).toHaveBeenCalledTimes(1); // no retry needed
  });

  it("throws at construction when gemini is selected with no credentials", () => {
    expect(() => new LlmService(makeConfig({ GEMINI_API_KEY: "" }) as never, {} as never)).toThrow(
      /GEMINI_API_KEY/,
    );
  });
});
