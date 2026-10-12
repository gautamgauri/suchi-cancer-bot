/**
 * Issue #182 — when the references do not answer the question, the reply must not
 * narrate the reference inventory ("the references do not define cancer; they do
 * mention colorectal cancer, a drug, suicide risk, clinical trials…").
 *
 * The existing rule "If the references don't cover something, say so briefly"
 * was followed literally and then over-served: the model told a patient what the
 * retrieved chunks were about, including an alarming off-topic subject. Retrieved
 * chunks are internal context, not content to report. Every generation prompt must
 * say so explicitly, in both the system prompt and the per-turn instructions
 * (the fallback provider and the definitional path only share the latter).
 */
import { LlmService } from "./llm.service";

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({ getGenerativeModel: jest.fn() })),
}));

function makeChunks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    docId: `doc-${i}`,
    chunkId: `chunk-${i}`,
    content: `Synthetic reference content number ${i}.`,
    similarity: 0.8,
    document: { title: `Source ${i}`, sourceType: "kb", isTrustedSource: true },
  }));
}

/** The rule, in any wording: do not list / describe / summarise what the references contain or mention. */
const NO_INVENTORY_RULE = /(never|do not|don't)\s+(list|describe|summari[sz]e|enumerate)[^\n]*\breferences?\b[^\n]*\b(contain|cover|mention|include)/i;

describe("LlmService — no reference-inventory narration (issue #182)", () => {
  let service: LlmService;
  let callGemini: jest.SpyInstance;

  beforeEach(() => {
    service = new LlmService({ get: (k: string) => (k === "GEMINI_API_KEY" ? "test-key" : undefined) } as never, {} as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callGemini = jest.spyOn(service as any, "callGeminiLLM").mockResolvedValue("ok [citation:doc-0:chunk-0]");
  });

  it.each(["explain", "navigate"])("the %s-mode per-turn instructions forbid describing the references", async (mode) => {
    await service.generateWithCitations(mode, "", "synthetic awareness question", makeChunks(2) as never);
    const [, userInstructions] = callGemini.mock.calls[0];
    expect(userInstructions).toMatch(NO_INVENTORY_RULE);
  });

  it("the explain-mode system prompt forbids describing the references", async () => {
    await service.generateWithCitations("explain", "", "synthetic awareness question", makeChunks(2) as never);
    const [systemPrompt] = callGemini.mock.calls[0];
    expect(systemPrompt).toMatch(NO_INVENTORY_RULE);
  });

  it("the definitional (answer-first) prompt path carries the rule via the per-turn instructions", async () => {
    await service.generateWithCitations(service.getDefinitionalExplainPrompt(), "", "synthetic question", makeChunks(2) as never);
    const [, userInstructions] = callGemini.mock.calls[0];
    expect(userInstructions).toMatch(NO_INVENTORY_RULE);
  });
});
