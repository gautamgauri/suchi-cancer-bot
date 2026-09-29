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

  describe("required sections of a same-intent template (Codex review, PR #174)", () => {
    /**
     * SCHEME_APPLICATION_CHECKLIST declares THREE retrieval sections with the
     * same retrievalIntent "schemes": scheme_overview and eligibility (both
     * required) and additional_schemes (optional). findChunksForIntent hands
     * all three the same chunks, so all three format byte-identically — the
     * same shape as PSYCHOSOCIAL_SUPPORT's duplicate pair, but two of these
     * sections are REQUIRED, and renderTemplate answers an unfilled required
     * section with "_Information not available…_".
     */
    const PMJAY_OVERVIEW_CHUNK = [
      "# Ayushman Bharat PM-JAY",
      "",
      "The scheme covers hospitalisation costs up to Rs 5 lakh per family per year at empanelled hospitals.",
    ].join("\n");

    const PMJAY_ELIGIBILITY_CHUNK = [
      "# Who can apply",
      "",
      "Families listed in the SECC database are eligible, and the e-card is issued free of cost.",
    ].join("\n");

    function schemePlan(): ExecutionPlan {
      const retrieve: RetrievalStep = {
        type: "retrieve",
        intent: "schemes",
        query: "how do I apply for Ayushman Bharat for cancer treatment",
        topK: 5,
        stepId: "retrieve_schemes_0",
      };
      const template: TemplateStep = {
        type: "template",
        templateId: "scheme_application",
        retrievalStepIds: ["retrieve_schemes_0"],
        locale: "en",
        stepId: "template_scheme_application",
      };
      return {
        planId: "plan_test_schemes",
        steps: [retrieve, template],
        usesStructuredTemplate: true,
        template: null as any,
        signals: [],
        reasoning: "test",
        estimatedRetrievalCalls: 1,
      } as unknown as ExecutionPlan;
    }

    /** The rendered body between `heading` and the next section heading. */
    function sectionBody(text: string, heading: string): string {
      const start = text.indexOf(heading);
      if (start === -1) return "";
      const rest = text.slice(start + heading.length);
      const next = rest.search(/\n\*\*|\n---/);
      return next === -1 ? rest : rest.slice(0, next);
    }

    async function schemeResponse(): Promise<string> {
      buildExecutor([
        chunk("kb_pmjay::chunk::1", "kb_pmjay", PMJAY_OVERVIEW_CHUNK),
        chunk("kb_pmjay::chunk::2", "kb_pmjay", PMJAY_ELIGIBILITY_CHUNK),
      ]);

      const result = await executor.execute(
        schemePlan(),
        "how do I apply for Ayushman Bharat",
        "en"
      );
      return result.responseText || "";
    }

    it("does not claim information is unavailable when the retrieval returned evidence", async () => {
      const text = await schemeResponse();

      expect(text).not.toContain("Information not available");
    });

    it("fills the required eligibility section from the retrieved chunks", async () => {
      const text = await schemeResponse();

      expect(text).toContain("**Eligibility Criteria**");
      expect(visible(sectionBody(text, "**Eligibility Criteria**"))).toContain(
        "Families listed in the SECC database are eligible"
      );
      expect(visible(sectionBody(text, "**Scheme Overview**"))).toContain(
        "The scheme covers hospitalisation costs up to Rs 5 lakh"
      );
    });

    it("still suppresses the optional duplicate section", async () => {
      const text = await schemeResponse();

      // additional_schemes is optional and would repeat the overview verbatim
      // a third time — the defect issue #173 reported.
      expect(text).not.toContain("**Other Financial Support**");
    });

    it("keeps the template's own scheme content intact", async () => {
      const text = await schemeResponse();

      expect(text).toContain("**Documents Required**");
      expect(text).toContain("**How to Apply (Step by Step)**");
      expect(text).toContain("**Helpline:** Call 14555 (toll-free)");
    });

    /**
     * Issue #158. A knowledge-base document is itself a numbered list of
     * sections (`### 1. …`, `### 2. …`, see kb/en/99_local_navigation/
     * cancer-treatment-costs-india.md). The chunker cuts it on length, so a
     * continuation chunk opens on `### 4. …`. Each chunk is quoted as ONE bullet
     * (`- <heading>: <first sentence>`), so the source document's section number
     * came along verbatim: the reply showed `- 4. Other Accredited Hospitals …`
     * under "Scheme Overview" and again under "Eligibility Criteria", with no
     * 1–3 anywhere. Items 1–3 are sibling sections living in OTHER chunks — they
     * were never in this bullet, so nothing is lost by dropping the number; the
     * number simply has no list to belong to once the chunk is a bullet.
     *
     * All hospital names below are synthetic.
     */
    describe("a chunk's own list numbering (#158)", () => {
      /** Continuation chunk that opens on section 4 of a numbered document. */
      const NUMBERED_SECTION_CHUNK = [
        "### 4. Other Accredited Hospitals with Surgical Oncology",
        "",
        "- **Example Cancer Hospital, Patna**: NABH accredited (synthetic entry).",
        "- **Sample Oncology Centre, Patna**: NABH accredited (synthetic entry).",
      ].join("\n");

      /** Numbered line with a trailing colon — not recognised as a heading. */
      const NUMBERED_COLON_LINE_CHUNK = [
        "4. **Other Accredited Hospitals with Surgical Oncology:**",
        "- **Example Cancer Hospital, Patna**: NABH accredited (synthetic entry).",
      ].join("\n");

      /** Heading followed by the document's own numbered steps. */
      const NUMBERED_STEPS_CHUNK = [
        "### How to get the e-card",
        "",
        "1. Visit the nearest Common Service Centre with your Aadhaar card.",
        "2. The operator checks your name on the beneficiary list.",
      ].join("\n");

      /** Devanagari section numbering. */
      const DEVANAGARI_NUMBERED_CHUNK = [
        "### ४. अन्य मान्यता प्राप्त अस्पताल",
        "",
        "उदाहरण कैंसर अस्पताल, पटना में सर्जिकल ऑन्कोलॉजी उपलब्ध है।",
      ].join("\n");

      async function responseFor(content: string): Promise<string> {
        buildExecutor([chunk("kb_synthetic::chunk::7", "kb_synthetic", content)]);
        const result = await executor.execute(
          schemePlan(),
          "how much will treatment cost under Ayushman Bharat",
          "en"
        );
        return visible(result.responseText || "");
      }

      /** Bullets rendered under a retrieval section. */
      function retrievalBullets(text: string): string[] {
        return [
          sectionBody(text, "**Scheme Overview**"),
          sectionBody(text, "**Eligibility Criteria**"),
        ]
          .join("\n")
          .split("\n")
          .filter((line) => line.startsWith("- "));
      }

      it("does not open a bullet with the source document's section number", async () => {
        const text = await responseFor(NUMBERED_SECTION_CHUNK);

        expect(text).not.toContain("- 4. Other Accredited Hospitals");
        for (const bullet of retrievalBullets(text)) {
          expect(bullet).not.toMatch(/^- \d{1,2}[.)]\s/);
        }
      });

      it("keeps the heading and the first entry the number was attached to", async () => {
        const text = await responseFor(NUMBERED_SECTION_CHUNK);

        expect(text).toContain(
          "- Other Accredited Hospitals with Surgical Oncology: Example Cancer Hospital, Patna: NABH accredited (synthetic entry)."
        );
      });

      it("does not reduce a numbered first line to a bare `4.` bullet", async () => {
        // The first-sentence cut stopped at the `.` of `4.`, so the whole bullet
        // was `- 4.` plus a citation — the chunk's content never reached the reader.
        const text = await responseFor(NUMBERED_COLON_LINE_CHUNK);

        for (const bullet of retrievalBullets(text)) {
          expect(bullet.trim()).not.toMatch(/^- \d{1,2}[.)]?$/);
        }
        expect(text).toContain("Other Accredited Hospitals with Surgical Oncology:");
        expect(text).toContain("Example Cancer Hospital, Patna: NABH accredited (synthetic entry).");
      });

      it("quotes the first step's words rather than its bare number", async () => {
        const text = await responseFor(NUMBERED_STEPS_CHUNK);

        expect(text).not.toContain("How to get the e-card: 1.");
        expect(text).toContain(
          "How to get the e-card: Visit the nearest Common Service Centre with your Aadhaar card."
        );
      });

      it("drops Devanagari section numbering too", async () => {
        const text = await responseFor(DEVANAGARI_NUMBERED_CHUNK);

        expect(text).not.toContain("- ४.");
        expect(text).toContain(
          "अन्य मान्यता प्राप्त अस्पताल: उदाहरण कैंसर अस्पताल, पटना में सर्जिकल ऑन्कोलॉजी उपलब्ध है।"
        );
      });

      it("leaves numbers that are content, not list markers, untouched", async () => {
        const text = await responseFor(
          [
            "### Coverage",
            "",
            "1.5 lakh families in the district hold an e-card (synthetic figure).",
          ].join("\n")
        );

        expect(text).toContain(
          "Coverage: 1.5 lakh families in the district hold an e-card (synthetic figure)."
        );
      });
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
