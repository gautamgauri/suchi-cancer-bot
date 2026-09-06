/**
 * Regression tests for the structured-template response path.
 *
 * Issue #67 — `journey_treatment_prep_001` ("I'm starting chemotherapy next week…")
 * emitted every knowledge-base sentence exactly twice, and each item read
 * `<heading text><body text>` with no separator. Both defects live in the way
 * PlanExecutorService turns retrieved chunks into template section content.
 */

import { PlanExecutorService } from "./plan-executor.service";
import { ExecutionPlan, RetrievalStep, TemplateStep } from "./execution-planner.service";
import { RetrievalToolService } from "../rag/retrieval-tool.service";
import { OutputVerifierService } from "./output-verifier.service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

function chunk(chunkId: string, docId: string, content: string, similarity = 0.8): EvidenceChunk {
  return {
    chunkId,
    docId,
    content,
    similarity,
    document: {
      title: "Chemotherapy to Treat Cancer",
      url: "https://www.cancer.gov/about-cancer/treatment/types/chemotherapy",
      sourceType: "02_nci_core",
      source: "NCI",
      citation: "National Cancer Institute",
      isTrustedSource: true,
    },
  };
}

/** Verbatim shape of an NCI chunk: a `##` marker, the heading, then the body. */
const SIDE_EFFECTS_CHUNK_CONTENT = [
  "##",
  "",
  "Chemotherapy can cause side effects",
  "",
  "Chemotherapy not only kills fast-growing cancer cells, but also kills or slows the growth of healthy cells that grow and divide quickly. Examples are cells that line your mouth and intestines.",
].join("\n");

const AFFECTS_YOU_CHUNK_CONTENT = [
  "### How chemotherapy may affect you",
  "",
  "Chemotherapy affects people in different ways. How you feel depends on the type of chemotherapy you are getting.",
].join("\n");

/** The CHEMO_DAY_PREP plan the planner builds for a chemo-preparation question. */
function chemoPlan(): ExecutionPlan {
  const retrieve: RetrievalStep = {
    type: "retrieve",
    intent: "side_effects",
    query: "I'm starting chemotherapy next week for breast cancer. What should I expect?",
    topK: 5,
    stepId: "retrieve_side_effects_0",
  };
  const template: TemplateStep = {
    type: "template",
    templateId: "chemo_day_prep",
    retrievalStepIds: ["retrieve_side_effects_0"],
    locale: "en",
    stepId: "template_chemo_day_prep",
  };
  return {
    planId: "plan_test",
    steps: [retrieve, template],
    usesStructuredTemplate: true,
    template: null as any,
    signals: [],
    reasoning: "test",
    estimatedRetrievalCalls: 1,
  } as unknown as ExecutionPlan;
}

describe("PlanExecutorService — structured template composition", () => {
  let executor: PlanExecutorService;
  let retrievalTool: { retrieve: jest.Mock };
  let outputVerifier: { verify: jest.Mock; quickVerify: jest.Mock };

  function buildExecutor(chunks: EvidenceChunk[]) {
    retrievalTool = {
      retrieve: jest.fn().mockResolvedValue({
        chunks,
        query: "chemo",
        intent: "side_effects",
        count: chunks.length,
        latencyMs: 1,
      }),
    };
    outputVerifier = {
      verify: jest.fn(),
      quickVerify: jest.fn().mockReturnValue({ violations: [], fixedContent: null }),
    };
    executor = new PlanExecutorService(
      retrievalTool as unknown as RetrievalToolService,
      outputVerifier as unknown as OutputVerifierService
    );
  }

  /** Strip citation markers so assertions compare reader-visible text. */
  function visible(text: string): string {
    return text.replace(/\s*\[citation:[^\]]*\]/g, "");
  }

  it("does not emit the same knowledge-base sentence twice when two chunk rows carry identical text (#67)", async () => {
    // Two DISTINCT chunkIds with the same content — retrieval's chunkId dedup
    // cannot see this, e.g. a stale chunk row left behind by an earlier ingest.
    buildExecutor([
      chunk("doc-chemo::chunk::2", "doc-chemo", SIDE_EFFECTS_CHUNK_CONTENT),
      chunk("doc-chemo::chunk::9", "doc-chemo", SIDE_EFFECTS_CHUNK_CONTENT),
      chunk("doc-chemo::chunk::11", "doc-chemo", AFFECTS_YOU_CHUNK_CONTENT),
    ]);

    const result = await executor.execute(chemoPlan(), "chemo prep", "en");
    const text = visible(result.responseText || "");

    const occurrences = text.split("Chemotherapy not only kills fast-growing cancer cells").length - 1;
    expect(occurrences).toBe(1);

    // The distinct chunk still survives — dedup must not swallow real content.
    expect(text).toContain("Chemotherapy affects people in different ways");
  });

  it("separates a chunk's heading from its body instead of running them together (#67)", async () => {
    buildExecutor([chunk("doc-chemo::chunk::2", "doc-chemo", SIDE_EFFECTS_CHUNK_CONTENT)]);

    const result = await executor.execute(chemoPlan(), "chemo prep", "en");
    const text = visible(result.responseText || "");

    // The reported defect, verbatim: heading welded onto the body with no boundary.
    expect(text).not.toContain("side effects Chemotherapy not only kills");
    expect(text).toContain("Chemotherapy can cause side effects: Chemotherapy not only kills");
  });

  it("keeps the static template sections intact", async () => {
    buildExecutor([chunk("doc-chemo::chunk::2", "doc-chemo", SIDE_EFFECTS_CHUNK_CONTENT)]);

    const result = await executor.execute(chemoPlan(), "chemo prep", "en");
    const text = result.responseText || "";

    expect(text).toContain("**Before Your Chemo Session**");
    expect(text).toContain("**What to Bring**");
    expect(text).toContain("**Common Side Effects to Expect**");
  });

  it("emits a citation for every knowledge-base bullet it keeps", async () => {
    buildExecutor([
      chunk("doc-chemo::chunk::2", "doc-chemo", SIDE_EFFECTS_CHUNK_CONTENT),
      chunk("doc-chemo::chunk::11", "doc-chemo", AFFECTS_YOU_CHUNK_CONTENT),
    ]);

    const result = await executor.execute(chemoPlan(), "chemo prep", "en");
    const text = result.responseText || "";

    expect(text).toContain("[citation:doc-chemo:doc-chemo::chunk::2]");
    expect(text).toContain("[citation:doc-chemo:doc-chemo::chunk::11]");
  });
});
