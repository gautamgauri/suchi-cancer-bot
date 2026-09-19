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

  describe("raw chunk text reaching the patient bubble (#173)", () => {
    /**
     * The chunks behind the reported reply, in the shape the ingest stores them:
     * an NCI page heading followed by the page's own image markup, and two
     * consecutive chunks of a long document that the chunker cut mid-word.
     */
    const COPING_FEELINGS_CHUNK = [
      "# Emotions and Cancer",
      "![Sick woman lying in man's arms relaxing on couch.](/sites/g/files/xnrzdm211/files/styles/cgov_article/public/cgov_image/media_image/2023-11/iStock-1301700665.jpg)",
      "",
      "When you have cancer, you may feel a wide range of emotions, and they can change from day to day.",
    ].join("\n");

    /** Opens on the tail of "caregivers", cut by the previous chunk's boundary. */
    const CAREGIVERS_TAIL_CHUNK = [
      "rs experienced greater depressive symptoms when patients used emotional support coping or expressed optimism about their prognosis.",
      "Caregiver burden is lower when family members share day-to-day tasks.",
    ].join("\n");

    /** Opens on the tail of "in your area" and has no complete sentence at all. */
    const SUPPORT_GROUP_TAIL_CHUNK = "n your area, try a support group online.";

    function psychosocialPlan(): ExecutionPlan {
      const retrieve: RetrievalStep = {
        type: "retrieve",
        intent: "psychosocial",
        query: "मेरी माँ को कैंसर है और वह बहुत डरी हुई हैं, मैं उन्हें कैसे हिम्मत दूँ?",
        topK: 5,
        stepId: "retrieve_psychosocial_0",
      };
      const template: TemplateStep = {
        type: "template",
        templateId: "psychosocial_support",
        retrievalStepIds: ["retrieve_psychosocial_0"],
        locale: "en",
        stepId: "template_psychosocial_support",
      };
      return {
        planId: "plan_test_psychosocial",
        steps: [retrieve, template],
        usesStructuredTemplate: true,
        template: null as any,
        signals: [],
        reasoning: "test",
        estimatedRetrievalCalls: 1,
      } as unknown as ExecutionPlan;
    }

    async function psychosocialResponse(): Promise<string> {
      buildExecutor([
        chunk("kb_coping::chunk::1", "kb_coping", COPING_FEELINGS_CHUNK),
        chunk("kb_caregivers::chunk::53", "kb_caregivers", CAREGIVERS_TAIL_CHUNK),
        chunk("kb_caregivers::chunk::54", "kb_caregivers", SUPPORT_GROUP_TAIL_CHUNK),
      ]);

      const result = await executor.execute(
        psychosocialPlan(),
        "how do I give my mother courage",
        "en"
      );
      return result.responseText || "";
    }

    it("does not paste the source page's image markup into the reply", async () => {
      const text = await psychosocialResponse();

      expect(text).not.toContain("![");
      expect(text).not.toContain("/sites/g/files/");
      expect(text).not.toContain("Sick woman lying in man's arms");
      // The heading the image sat next to is real content and survives.
      expect(visible(text)).toContain(
        "Emotions and Cancer: When you have cancer, you may feel a wide range of emotions"
      );
    });

    it("does not quote a chunk's mid-word opening fragment", async () => {
      const text = await psychosocialResponse();

      expect(text).not.toContain("rs experienced greater depressive symptoms");
      expect(text).not.toContain("n your area, try a support group online");
      // The complete sentence that followed the fragment is still delivered.
      expect(visible(text)).toContain(
        "Caregiver burden is lower when family members share day-to-day tasks."
      );
    });

    it("does not print the same retrieved list twice under two headings", async () => {
      const text = await psychosocialResponse();

      const emotionsBullets =
        text.split("Emotions and Cancer: When you have cancer").length - 1;
      expect(emotionsBullets).toBe(1);

      // Two PSYCHOSOCIAL_SUPPORT sections share retrievalIntent "psychosocial",
      // so both were filled from the same chunks. Only the first keeps the list.
      expect(text).toContain("**Coping Strategies**");
      expect(text).not.toContain("**Support Groups & Communities**");

      const citations = text.match(/\[citation:/g) || [];
      expect(citations).toHaveLength(2);
    });

    it("keeps the template's own psychosocial content intact", async () => {
      const text = await psychosocialResponse();

      expect(text).toContain("**Your Feelings Are Valid**");
      expect(text).toContain("**Support Helplines**");
      expect(text).toContain("**For Caregivers**");
      expect(text).toContain("**Vandrevala Foundation**: 9999666555");
    });
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
