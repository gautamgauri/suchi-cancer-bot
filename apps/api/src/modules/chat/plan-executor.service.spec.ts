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

  describe("navigation checklist built from a research-document chunk (#214)", () => {
    /**
     * HOSPITAL_VISIT_PREP declares TWO retrieval sections with DIFFERENT
     * intents — hospital_info ("navigation") and financial_support
     * ("schemes") — so the planner issues two retrievals for the same user
     * text and each section is filled from its own step's chunks.
     *
     * The Bihar accreditation document is a numbered deep-research report, so
     * its chunks open with a section ordinal ("4. Other Accredited Hospitals
     * with Surgical Oncology") above a markdown bullet list. That chunk scores
     * for both intents, and because the two sections' chunk lists overlap
     * without being identical, the whole-content duplicate check could not see
     * it: the same hospital line was printed under the hospital heading and
     * again under "Financial Support Options" (issue #214, prod revision
     * suchi-api-00425-hm4).
     */
    const ACCREDITED_HOSPITALS_CHUNK = [
      "### 4. Other Accredited Hospitals with Surgical Oncology",
      "",
      "- **Savera Cancer and Multispeciality Hospital, Patna**: NABH Recommended (20 May 2025).",
      "- **Ford Hospital and Research Centre, Patna**: NABH Entry Level.",
    ].join("\n");

    const RADIOTHERAPY_CHUNK = [
      "### 2. Centres with Radiation Oncology",
      "",
      "- **Mahavir Cancer Sansthan, Patna**: Departments include Linear Accelerators, HDR Brachytherapy, IMRT and IGRT.",
    ].join("\n");

    const PMJAY_CHUNK = [
      "# Ayushman Bharat PM-JAY",
      "",
      "The scheme covers hospitalisation costs up to Rs 5 lakh per family per year at empanelled hospitals.",
    ].join("\n");

    function hospitalPlan(): ExecutionPlan {
      const retrieveNavigation: RetrievalStep = {
        type: "retrieve",
        intent: "navigation",
        query: "Patna mein radiotherapy kahan hoti hai",
        topK: 5,
        stepId: "retrieve_navigation_0",
      };
      const retrieveSchemes: RetrievalStep = {
        type: "retrieve",
        intent: "schemes",
        query: "Patna mein radiotherapy kahan hoti hai",
        topK: 5,
        stepId: "retrieve_schemes_1",
      };
      const template: TemplateStep = {
        type: "template",
        templateId: "hospital_visit_prep",
        retrievalStepIds: ["retrieve_navigation_0", "retrieve_schemes_1"],
        locale: "en",
        stepId: "template_hospital_visit_prep",
      };
      return {
        planId: "plan_test_navigation",
        steps: [retrieveNavigation, retrieveSchemes, template],
        usesStructuredTemplate: true,
        template: null as any,
        signals: [],
        reasoning: "test",
        estimatedRetrievalCalls: 2,
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

    /**
     * Each intent returns its own chunk list, overlapping on the accreditation
     * chunk — the shape that defeats the whole-content duplicate check.
     */
    async function navigationResponse(): Promise<string> {
      buildExecutor([]);
      retrievalTool.retrieve.mockImplementation(async ({ intent }: { intent: string }) => {
        const chunks =
          intent === "schemes"
            ? [
                chunk("kb_bihar_nabh::chunk::4", "kb_bihar_nabh", ACCREDITED_HOSPITALS_CHUNK, 0.82),
                chunk("kb_pmjay::chunk::1", "kb_pmjay", PMJAY_CHUNK, 0.7),
              ]
            : [
                chunk("kb_bihar_nabh::chunk::4", "kb_bihar_nabh", ACCREDITED_HOSPITALS_CHUNK, 0.82),
                chunk("kb_bihar_nabh::chunk::2", "kb_bihar_nabh", RADIOTHERAPY_CHUNK, 0.75),
              ];
        return { chunks, query: "patna", intent, count: chunks.length, latencyMs: 1 };
      });

      const result = await executor.execute(
        hospitalPlan(),
        "Patna mein radiotherapy kahan hoti hai",
        "en"
      );
      return result.responseText || "";
    }

    it("does not print the research document's section numbering or list marker", async () => {
      const text = visible(await navigationResponse());

      // The reported line, verbatim.
      expect(text).not.toContain(
        "4. Other Accredited Hospitals with Surgical Oncology: - Savera"
      );
      expect(text).not.toContain("4. Other Accredited Hospitals");
      expect(text).not.toContain(": - Savera");
      // The hospital itself still reaches the reader.
      expect(text).toContain("Savera Cancer and Multispeciality Hospital");
    });

    it("lists the hospital once, under the hospital heading only", async () => {
      const text = visible(await navigationResponse());

      const occurrences =
        text.split("Savera Cancer and Multispeciality Hospital").length - 1;
      expect(occurrences).toBe(1);

      expect(
        sectionBody(text, "**Hospital / Treatment Centre Information**")
      ).toContain("Savera Cancer and Multispeciality Hospital");
      expect(
        sectionBody(text, "**Financial Support Options**")
      ).not.toContain("Savera Cancer and Multispeciality Hospital");
    });

    it("keeps the financial section's own scheme evidence", async () => {
      const text = visible(await navigationResponse());

      expect(sectionBody(text, "**Financial Support Options**")).toContain(
        "The scheme covers hospitalisation costs up to Rs 5 lakh"
      );
    });

    it("keeps the template's own checklist content intact", async () => {
      const text = await navigationResponse();

      expect(text).toContain("**Documents to Carry**");
      expect(text).toContain("**Questions to Ask Your Doctor**");
      expect(text).toContain("**Practical Tips**");
    });
  });

  describe("hospital section rendered from the directory, not from chunks (#218)", () => {
    /**
     * Prod, 2026-10-12: "Darbhanga ke paas radiotherapy wala cancer hospital
     * kaun sa hai?" was routed to NAVIGATION (#213) and the planner ranked
     * HBCH Muzaffarpur first, but the HOSPITAL_VISIT_PREP template filled its
     * hospital section from the navigation retrieval's chunks: a PDQ
     * editorial-board paragraph, the research report's preamble, and Patna
     * centres. Muzaffarpur never appeared.
     */
    const EDITORIAL_BOARD_CHUNK = [
      "## About This PDQ Summary",
      "",
      "PDQ® Cancer Genetics Editorial Board: This Editorial Board consists of experts in the fields of genetics, clinical oncology, epidemiology, psychology, and the social sciences.",
    ].join("\n");

    const REPORT_PREAMBLE_CHUNK = [
      "# Cancer Treatment Centres in Bihar",
      "",
      "Based on comprehensive research into the healthcare landscape of Bihar, the following report details the cancer treatment centers that hold National accreditation.",
    ].join("\n");

    const IGIMS_CHUNK = [
      "### 1. State Cancer Institute",
      "",
      "- **IGIMS (State Cancer Institute), Patna**: Indira Gandhi Institute of Medical Sciences (IGIMS), Sheikhpura in Patna is a state government tertiary hospital with a dedicated oncology department.",
    ].join("\n");

    const PMJAY_CHUNK = [
      "# Ayushman Bharat PM-JAY",
      "",
      "The scheme covers hospitalisation costs up to Rs 5 lakh per family per year at empanelled hospitals.",
    ].join("\n");

    function hospital(partial: Record<string, unknown>) {
      return {
        id: "x",
        name: "X",
        short_name: "X",
        city: "Patna",
        state: "Bihar",
        type: "Government",
        tier: "A",
        departments: ["medical_oncology"],
        cost_tier: "Low",
        pmjay_empanelled: true,
        ncg_member: false,
        contact: { phone: null, address: null },
        key_doctors: [],
        notes: "",
        navigation_notes: [],
        score: 1,
        ...partial,
      };
    }

    const HBCH = hospital({
      id: "hbch-muzaffarpur",
      name: "Homi Bhabha Cancer Hospital & Research Centre",
      short_name: "HBCH Muzaffarpur",
      city: "Muzaffarpur",
      departments: ["medical_oncology", "surgical_oncology", "radiation_oncology"],
      distance_km: 58.4,
    });
    const MAHAVIR = hospital({
      id: "mahavir",
      name: "Mahavir Cancer Sansthan",
      short_name: "Mahavir Cancer Sansthan",
      departments: ["Radiotherapy", "Medical Oncology"],
      pmjay_empanelled: null,
      distance_km: 73.2,
      contact: { phone: "0612-2253957", address: null },
    });
    const SILIGURI = hospital({
      id: "nbmch",
      name: "North Bengal Medical College",
      short_name: "NBMCH Siliguri",
      city: "Siliguri",
      state: "West Bengal",
      departments: ["radiation_oncology"],
      pmjay_empanelled: false,
      distance_km: 191,
    });
    const TMH = hospital({
      id: "tmh",
      name: "Tata Memorial Hospital",
      short_name: "TMH Mumbai",
      city: "Mumbai",
      state: "Maharashtra",
      departments: ["radiation_oncology", "medical_oncology", "surgical_oncology"],
      national_referral: true,
    });

    const DARBHANGA_GEOGRAPHY = {
      stage: "distance" as const,
      requestedCity: "Darbhanga",
      resolvedState: "Bihar",
      requiredDepartments: ["radiation_oncology"],
    };

    function navigationPlan(withDirectory: boolean): ExecutionPlan {
      const retrieveNavigation: RetrievalStep = {
        type: "retrieve",
        intent: "navigation",
        query: "Darbhanga ke paas radiotherapy wala cancer hospital kaun sa hai?",
        topK: 5,
        stepId: "retrieve_navigation_0",
      };
      const retrieveSchemes: RetrievalStep = {
        type: "retrieve",
        intent: "schemes",
        query: "Darbhanga ke paas radiotherapy wala cancer hospital kaun sa hai?",
        topK: 5,
        stepId: "retrieve_schemes_1",
      };
      const template: TemplateStep = {
        type: "template",
        templateId: "hospital_visit_prep",
        retrievalStepIds: ["retrieve_navigation_0", "retrieve_schemes_1"],
        locale: "en",
        stepId: "template_hospital_visit_prep",
      };
      return {
        planId: "plan_test_218",
        steps: [retrieveNavigation, retrieveSchemes, template],
        usesStructuredTemplate: true,
        template: null as any,
        signals: ["location_mentioned", "hospital_search"],
        reasoning: "test",
        estimatedRetrievalCalls: 2,
        structuredHospitalResults: withDirectory ? [HBCH, MAHAVIR, SILIGURI, TMH] : null,
        structuredHospitalGeography: withDirectory ? DARBHANGA_GEOGRAPHY : null,
      } as unknown as ExecutionPlan;
    }

    function sectionBody(text: string, heading: string): string {
      const start = text.indexOf(heading);
      if (start === -1) return "";
      const rest = text.slice(start + heading.length);
      const next = rest.search(/\n\*\*|\n---/);
      return next === -1 ? rest : rest.slice(0, next);
    }

    async function respond(withDirectory: boolean): Promise<string> {
      buildExecutor([]);
      retrievalTool.retrieve.mockImplementation(async ({ intent }: { intent: string }) => {
        const chunks =
          intent === "schemes"
            ? [chunk("kb_pmjay::chunk::1", "kb_pmjay", PMJAY_CHUNK, 0.7)]
            : [
                chunk("kb_pdq_genetics::chunk::0", "kb_pdq_genetics", EDITORIAL_BOARD_CHUNK, 0.81),
                chunk("kb_bihar_nabh::chunk::0", "kb_bihar_nabh", REPORT_PREAMBLE_CHUNK, 0.8),
                chunk("kb_bihar_nabh::chunk::1", "kb_bihar_nabh", IGIMS_CHUNK, 0.78),
              ];
        return { chunks, query: "darbhanga", intent, count: chunks.length, latencyMs: 1 };
      });
      const result = await executor.execute(
        navigationPlan(withDirectory),
        "Darbhanga ke paas radiotherapy wala cancer hospital kaun sa hai?",
        "en"
      );
      return visible(result.responseText || "");
    }

    const HOSPITAL_HEADING = "**Hospital / Treatment Centre Information**";

    it("lists the directory's nearest capable centre first, with its distance", async () => {
      const body = sectionBody(await respond(true), HOSPITAL_HEADING);
      expect(body).toContain("HBCH Muzaffarpur");
      expect(body.indexOf("HBCH Muzaffarpur")).toBeLessThan(body.indexOf("Mahavir Cancer Sansthan"));
      expect(body).toContain("About 60 km away");
      expect(body).toContain("Radiotherapy available");
      expect(body).toContain("PM-JAY empanelled");
    });

    it("does not fill the hospital section from knowledge-base chunks when the directory answered", async () => {
      const body = sectionBody(await respond(true), HOSPITAL_HEADING);
      expect(body).not.toContain("IGIMS");
      expect(body).not.toContain("Editorial Board");
      expect(body).not.toContain("Based on comprehensive research");
    });

    it("never shows a travel time, a road distance or the word straight-line", async () => {
      const text = await respond(true);
      expect(text).not.toMatch(/straight-line/i);
      expect(text).not.toMatch(/\b(hours?|minutes?|drive|driving|by road)\b/i);
      expect(text).toContain("the road or rail journey is longer");
    });

    it("names the state of a centre across the border and asks the patient to confirm their scheme", async () => {
      const body = sectionBody(await respond(true), HOSPITAL_HEADING);
      expect(body).toContain("NBMCH Siliguri");
      expect(body).toContain("This centre is in West Bengal");
      expect(body).toContain("Bihar state scheme is accepted there");
      expect(body).toContain("Not PM-JAY empanelled");
    });

    it("states unverified PM-JAY status as unverified and shows a phone number when the record has one", async () => {
      const body = sectionBody(await respond(true), HOSPITAL_HEADING);
      expect(body).toContain("PM-JAY status not verified; confirm with the hospital");
      expect(body).toContain("Phone: 0612-2253957");
    });

    it("mentions national referral centres separately and ends with the confirmation sentence", async () => {
      const body = sectionBody(await respond(true), HOSPITAL_HEADING);
      expect(body).toContain("patients from this region also travel to: TMH Mumbai (Mumbai)");
      expect(body).toContain(
        "Hospital services, doctors, costs, and PM-JAY availability can change. Please confirm directly with the hospital before travel or payment."
      );
    });

    it("keeps the financial section on its own scheme evidence", async () => {
      const text = await respond(true);
      expect(sectionBody(text, "**Financial Support Options**")).toContain("Rs 5 lakh");
    });

    it("falls back to the chunks when the plan carries no directory results, still without boilerplate", async () => {
      const body = sectionBody(await respond(false), HOSPITAL_HEADING);
      expect(body).toContain("IGIMS");
      expect(body).not.toContain("Editorial Board");
      expect(body).not.toContain("Based on comprehensive research");
      expect(body).not.toContain("HBCH Muzaffarpur");
    });
  });

  describe("financial section filled with hospital-description chunks (#220)", () => {
    /**
     * Prod, suchi-api-00429-zzn (main @ e1172ef): after #219 the hospital
     * section renders from the geocoded directory, but the section below it,
     * "Financial Support Options" / "आर्थिक सहायता के विकल्प", was still filled
     * from whatever the schemes retrieval returned. For a Patna or Darbhanga
     * radiotherapy question that is four hospital profiles — IGIMS, AIIMS
     * Patna, Mahavir Cancer Sansthan, the Savera NABH note — and not one word
     * about money: no PM-JAY, no Bihar CM relief fund, no charity desk.
     */
    const IGIMS_CHUNK = [
      "### 1. State Cancer Institute",
      "",
      "- **IGIMS (State Cancer Institute), Patna**: Indira Gandhi Institute of Medical Sciences, Sheikhpura, is a state government tertiary hospital with a dedicated oncology department.",
    ].join("\n");

    const AIIMS_CHUNK = [
      "### 3. AIIMS Patna",
      "",
      "- **AIIMS Patna**: The All India Institute of Medical Sciences at Phulwari Sharif runs radiation oncology and medical oncology services.",
    ].join("\n");

    const MAHAVIR_CHUNK = [
      "### 2. Centres with Radiation Oncology",
      "",
      "- **Mahavir Cancer Sansthan, Patna**: Departments include Linear Accelerators, HDR Brachytherapy, IMRT and IGRT.",
    ].join("\n");

    const SAVERA_NABH_CHUNK = [
      "### 4. Other Accredited Hospitals with Surgical Oncology",
      "",
      "- **Savera Cancer and Multispeciality Hospital, Patna**: NABH Recommended (20 May 2025).",
    ].join("\n");

    const PMJAY_CHUNK = [
      "# Ayushman Bharat PM-JAY",
      "",
      "The scheme covers hospitalisation costs up to Rs 5 lakh per family per year at empanelled hospitals.",
    ].join("\n");

    const CMRF_CHUNK = [
      "## Chief Minister's Relief Fund (Bihar)",
      "",
      "Patients can apply to the Bihar Chief Minister's Relief Fund through the district magistrate's office with an income certificate and the hospital's treatment estimate.",
    ].join("\n");

    /** A chunk about treatment itself: on no reading is it financial help. */
    const RADIOTHERAPY_EDUCATION_CHUNK = [
      "## External beam radiation therapy",
      "",
      "External beam radiation therapy is delivered from a machine outside the body over several weeks of daily sessions.",
    ].join("\n");

    function hospitalChunk(
      chunkId: string,
      docId: string,
      content: string,
      similarity: number
    ): EvidenceChunk {
      const c = chunk(chunkId, docId, content, similarity);
      c.document.title = "NABH Accredited Cancer Treatment Centers in Bihar";
      c.document.sourceType = "99_local_navigation";
      return c;
    }

    /**
     * The directory results #219 made the hospital section render from. They
     * matter here because that path records NO bullets, so the per-bullet
     * suppression of #214 no longer claims the hospital chunks before the
     * financial section is filled — which is why #220 surfaced only after #219
     * landed.
     */
    const PATNA_DIRECTORY = [
      {
        id: "mahavir",
        name: "Mahavir Cancer Sansthan",
        short_name: "Mahavir Cancer Sansthan",
        city: "Patna",
        state: "Bihar",
        type: "Trust",
        tier: "B",
        departments: ["radiation_oncology"],
        cost_tier: "Low",
        pmjay_empanelled: true,
        ncg_member: false,
        contact: { phone: null, address: null },
        key_doctors: [],
        notes: "",
        navigation_notes: [],
        score: 1,
      },
    ];

    const PATNA_GEOGRAPHY = {
      stage: "city" as const,
      requestedCity: "Patna",
      resolvedState: "Bihar",
      requiredDepartments: ["radiation_oncology"],
    };

    function plan(withSchemesStep: boolean, withDirectory = false): ExecutionPlan {
      const retrieveNavigation: RetrievalStep = {
        type: "retrieve",
        intent: "navigation",
        query: "Patna mein radiotherapy kahan hoti hai",
        topK: 5,
        stepId: "retrieve_navigation_0",
      };
      const retrieveSchemes: RetrievalStep = {
        type: "retrieve",
        intent: "schemes",
        query: "Patna mein radiotherapy kahan hoti hai financial assistance",
        topK: 5,
        stepId: "retrieve_schemes_1",
      };
      const steps = withSchemesStep
        ? [retrieveNavigation, retrieveSchemes]
        : [retrieveNavigation];
      const template: TemplateStep = {
        type: "template",
        templateId: "hospital_visit_prep",
        retrievalStepIds: steps.map((s) => s.stepId),
        locale: "en",
        stepId: "template_hospital_visit_prep",
      };
      return {
        planId: "plan_test_220",
        steps: [...steps, template],
        usesStructuredTemplate: true,
        template: null as any,
        signals: ["location_mentioned", "hospital_search"],
        reasoning: "test",
        estimatedRetrievalCalls: steps.length,
        structuredHospitalResults: withDirectory ? PATNA_DIRECTORY : null,
        structuredHospitalGeography: withDirectory ? PATNA_GEOGRAPHY : null,
      } as unknown as ExecutionPlan;
    }

    function sectionBody(text: string, heading: string): string {
      const start = text.indexOf(heading);
      if (start === -1) return "";
      const rest = text.slice(start + heading.length);
      const next = rest.search(/\n\*\*|\n---/);
      return next === -1 ? rest : rest.slice(0, next);
    }

    const FINANCIAL_HEADING = "**Financial Support Options**";

    /**
     * @param schemeChunks what the schemes retrieval returns
     * @param withSchemesStep false reproduces the other route into the same
     *   defect: no schemes step in the plan, so `findChunksForIntent` falls
     *   back to the merged chunk list — all of it navigation text.
     */
    async function respond(
      schemeChunks: EvidenceChunk[],
      withSchemesStep = true
    ): Promise<string> {
      buildExecutor([]);
      retrievalTool.retrieve.mockImplementation(async ({ intent }: { intent: string }) => {
        const chunks =
          intent === "schemes"
            ? schemeChunks
            : [
                hospitalChunk("kb_bihar_nabh::chunk::1", "kb_en_bihar_nabh_cancer_centers_v1", IGIMS_CHUNK, 0.8),
                hospitalChunk("kb_bihar_nabh::chunk::3", "kb_en_bihar_nabh_cancer_centers_v1", AIIMS_CHUNK, 0.78),
              ];
        return { chunks, query: "patna", intent, count: chunks.length, latencyMs: 1 };
      });
      const result = await executor.execute(
        plan(withSchemesStep),
        "Patna mein radiotherapy kahan hoti hai",
        "en"
      );
      return visible(result.responseText || "");
    }

    /** The four hospital profiles of the report, verbatim from prod. */
    const HOSPITAL_PROFILE_CHUNKS = [
      hospitalChunk("kb_bihar_nabh::chunk::1", "kb_en_bihar_nabh_cancer_centers_v1", IGIMS_CHUNK, 0.8),
      hospitalChunk("kb_bihar_nabh::chunk::3", "kb_en_bihar_nabh_cancer_centers_v1", AIIMS_CHUNK, 0.78),
      hospitalChunk("kb_bihar_nabh::chunk::2", "kb_en_bihar_nabh_cancer_centers_v1", MAHAVIR_CHUNK, 0.76),
      hospitalChunk("kb_bihar_nabh::chunk::4", "kb_en_bihar_nabh_cancer_centers_v1", SAVERA_NABH_CHUNK, 0.74),
    ];

    it("does not put hospital descriptions under the financial heading", async () => {
      const text = await respond(HOSPITAL_PROFILE_CHUNKS);
      const body = sectionBody(text, FINANCIAL_HEADING);

      expect(body).not.toContain("IGIMS");
      expect(body).not.toContain("AIIMS Patna");
      expect(body).not.toContain("Mahavir Cancer Sansthan");
      expect(body).not.toContain("Savera Cancer and Multispeciality Hospital");
    });

    it("drops the financial heading entirely when retrieval found nothing about money", async () => {
      const text = await respond(HOSPITAL_PROFILE_CHUNKS);

      expect(text).not.toContain(FINANCIAL_HEADING);
      // The rest of the checklist is untouched.
      expect(text).toContain("**Documents to Carry**");
      expect(text).toContain("**Questions to Ask Your Doctor**");
      expect(text).toContain("**Practical Tips**");
    });

    it("drops the heading in Hindi too, with the hospital section rendered from the directory (#219)", async () => {
      buildExecutor([]);
      retrievalTool.retrieve.mockResolvedValue({
        chunks: HOSPITAL_PROFILE_CHUNKS,
        query: "patna",
        intent: "schemes",
        count: HOSPITAL_PROFILE_CHUNKS.length,
        latencyMs: 1,
      });
      const result = await executor.execute(
        plan(true, true),
        "Patna mein radiotherapy kahan hoti hai",
        "hi"
      );
      const text = result.responseText || "";

      expect(text).not.toContain("आर्थिक सहायता के विकल्प");
      expect(text).not.toContain("Savera Cancer and Multispeciality Hospital");
      // The directory still answers the hospital question.
      expect(text).toContain("Mahavir Cancer Sansthan");
    });

    it("keeps the scheme and relief-fund evidence when retrieval does find it", async () => {
      const text = await respond([
        hospitalChunk("kb_bihar_nabh::chunk::1", "kb_en_bihar_nabh_cancer_centers_v1", IGIMS_CHUNK, 0.82),
        chunk("kb_pmjay::chunk::1", "kb_en_pmjay_ayushman_bharat_cancer_v1", PMJAY_CHUNK, 0.7),
        chunk("kb_ngo::chunk::5", "kb_en_india_cancer_ngo_financial_assistance_v1", CMRF_CHUNK, 0.68),
      ]);
      const body = sectionBody(text, FINANCIAL_HEADING);

      expect(body).toContain("The scheme covers hospitalisation costs up to Rs 5 lakh");
      expect(body).toContain("Chief Minister's Relief Fund");
      expect(body).not.toContain("IGIMS");
    });

    it("drops an on-source chunk that is simply not about money", async () => {
      const text = await respond([
        chunk("kb_rt::chunk::2", "kb_en_radiotherapy_basics_v1", RADIOTHERAPY_EDUCATION_CHUNK, 0.72),
      ]);

      expect(text).not.toContain(FINANCIAL_HEADING);
      expect(text).not.toContain("External beam radiation therapy is delivered");
    });

    it("does not pad the section from the merged chunks when the plan has no schemes step", async () => {
      const text = await respond([], false);

      expect(text).not.toContain(FINANCIAL_HEADING);
      // The navigation chunks still fill the hospital section above it — they
      // are only wrong under the money heading.
      expect(sectionBody(text, "**Hospital / Treatment Centre Information**")).toContain(
        "Indira Gandhi Institute of Medical Sciences"
      );
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
