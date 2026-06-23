import {
  selectOutputTemplate,
  renderTemplate,
  TEMPLATE_REGISTRY,
  BIOPSY_NEXT_STEPS,
  CHEMO_DAY_PREP,
  SECOND_OPINION_PREP,
  SCHEME_APPLICATION_CHECKLIST,
  PSYCHOSOCIAL_SUPPORT,
  HOSPITAL_VISIT_PREP,
  OutputTemplate,
} from "./structured-output-templates";

describe("StructuredOutputTemplates", () => {
  // ─── selectOutputTemplate ──────────────────────────────────────

  describe("selectOutputTemplate", () => {
    describe("Biopsy report queries → BIOPSY_NEXT_STEPS", () => {
      test("signal: report_received", () => {
        const result = selectOutputTemplate("NAVIGATION", ["report_received"], "my biopsy is done");
        expect(result).toBe(BIOPSY_NEXT_STEPS);
      });

      // ── Biopsy routing contract (acceptance cases) ──
      // At this boundary, the "report_received" signal represents reliable
      // ACTIVE biopsy context (the upstream sets it from the current message or
      // recent session context, NOT from a stale/unrelated historical mention).

      // "What next?" alone → generic next-steps, never the biopsy template.
      test('"what next?" alone does NOT route to biopsy', () => {
        expect(selectOutputTemplate("NAVIGATION", ["next_steps"], "what next?")).not.toBe(BIOPSY_NEXT_STEPS);
      });

      // Biopsy context in the current message → biopsy template.
      test('"Biopsy ho gayi, ab kya?" → biopsy template', () => {
        expect(selectOutputTemplate("NAVIGATION", [], "Biopsy ho gayi, ab kya?")).toBe(BIOPSY_NEXT_STEPS);
      });

      // Prior turn established biopsy (active session context → report_received) +
      // current "what next?" → biopsy template.
      test('active biopsy session context + "what next?" → biopsy template', () => {
        expect(
          selectOutputTemplate("NAVIGATION", ["report_received", "next_steps"], "what next?"),
        ).toBe(BIOPSY_NEXT_STEPS);
      });

      // Stale/unrelated historical biopsy → upstream does NOT set report_received,
      // so a bare "what next?" must NOT auto-route to biopsy.
      test("stale biopsy history (no active signal) does NOT route to biopsy", () => {
        expect(selectOutputTemplate("NAVIGATION", ["next_steps"], "what next?")).not.toBe(BIOPSY_NEXT_STEPS);
      });

      test("keyword: biopsy in text", () => {
        const result = selectOutputTemplate("EDUCATION", [], "my biopsy report came back");
        expect(result).toBe(BIOPSY_NEXT_STEPS);
      });

      test("Hindi keyword: बायोप्सी", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "बायोप्सी रिपोर्ट आई है");
        expect(result).toBe(BIOPSY_NEXT_STEPS);
      });
    });

    describe("Chemo preparation queries → CHEMO_DAY_PREP", () => {
      test("chemo + prepare", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "how to prepare for chemotherapy");
        expect(result).toBe(CHEMO_DAY_PREP);
      });

      test("chemo + day", () => {
        const result = selectOutputTemplate("EDUCATION", [], "what to do on chemo day");
        expect(result).toBe(CHEMO_DAY_PREP);
      });

      test("chemo + what to", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "what to bring for chemo session");
        expect(result).toBe(CHEMO_DAY_PREP);
      });

      test("Hindi: कीमो + तैयारी", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "कीमो की तैयारी कैसे करें");
        expect(result).toBe(CHEMO_DAY_PREP);
      });

      test("Hinglish: chemo + kaise", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "chemo ke liye kaise ready hona hai");
        expect(result).toBe(CHEMO_DAY_PREP);
      });
    });

    describe("Second opinion queries → SECOND_OPINION_PREP", () => {
      test("English: second opinion", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "I want to get a second opinion");
        expect(result).toBe(SECOND_OPINION_PREP);
      });

      test("Hindi: दूसरी राय", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "दूसरी राय कहां लें");
        expect(result).toBe(SECOND_OPINION_PREP);
      });

      test("Hinglish: dusri raay", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "dusri raay leni chahiye kya");
        expect(result).toBe(SECOND_OPINION_PREP);
      });
    });

    describe("Scheme/financial queries → SCHEME_APPLICATION_CHECKLIST", () => {
      test("category: SCHEMES", () => {
        const result = selectOutputTemplate("SCHEMES", [], "tell me about government help");
        expect(result).toBe(SCHEME_APPLICATION_CHECKLIST);
      });

      test("signal: budget_concern", () => {
        const result = selectOutputTemplate("EDUCATION", ["budget_concern"], "treatment cost is too much");
        expect(result).toBe(SCHEME_APPLICATION_CHECKLIST);
      });

      test("keyword: ayushman", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "how to get ayushman bharat card");
        expect(result).toBe(SCHEME_APPLICATION_CHECKLIST);
      });

      test("keyword: scheme", () => {
        const result = selectOutputTemplate("EDUCATION", [], "government scheme for cancer");
        expect(result).toBe(SCHEME_APPLICATION_CHECKLIST);
      });

      test("Hindi: योजना", () => {
        const result = selectOutputTemplate("EDUCATION", [], "सरकारी योजना कैसे मिलेगी");
        expect(result).toBe(SCHEME_APPLICATION_CHECKLIST);
      });

      test("Hindi: आयुष्मान", () => {
        const result = selectOutputTemplate("EDUCATION", [], "आयुष्मान कार्ड कैसे बनता है");
        expect(result).toBe(SCHEME_APPLICATION_CHECKLIST);
      });

      test("keyword: paisa", () => {
        const result = selectOutputTemplate("EDUCATION", [], "paisa ki bahut dikkat hai");
        expect(result).toBe(SCHEME_APPLICATION_CHECKLIST);
      });
    });

    describe("Psychosocial queries → PSYCHOSOCIAL_SUPPORT", () => {
      test("category: PSYCHOSOCIAL", () => {
        const result = selectOutputTemplate("PSYCHOSOCIAL", [], "I feel very anxious");
        expect(result).toBe(PSYCHOSOCIAL_SUPPORT);
      });

      test("signal: emotional_distress", () => {
        const result = selectOutputTemplate("EDUCATION", ["emotional_distress"], "I am feeling scared");
        expect(result).toBe(PSYCHOSOCIAL_SUPPORT);
      });
    });

    describe("Navigation with hospital search → HOSPITAL_VISIT_PREP", () => {
      test("NAVIGATION + hospital_search signal", () => {
        const result = selectOutputTemplate("NAVIGATION", ["hospital_search"], "which hospital is good for cancer");
        expect(result).toBe(HOSPITAL_VISIT_PREP);
      });

      test("NAVIGATION + location_mentioned signal", () => {
        const result = selectOutputTemplate("NAVIGATION", ["location_mentioned"], "treatment centre in my district");
        expect(result).toBe(HOSPITAL_VISIT_PREP);
      });
    });

    describe("Returns null for simple education queries", () => {
      test("simple cancer info question with no signals", () => {
        const result = selectOutputTemplate("EDUCATION", [], "what is cancer");
        expect(result).toBeNull();
      });

      test("simple symptom question with no signals", () => {
        const result = selectOutputTemplate("EDUCATION", [], "what are symptoms of lung cancer");
        expect(result).toBeNull();
      });

      test("NAVIGATION without hospital_search or location_mentioned", () => {
        const result = selectOutputTemplate("NAVIGATION", [], "hello there");
        expect(result).toBeNull();
      });
    });
  });

  // ─── renderTemplate ────────────────────────────────────────────

  describe("renderTemplate", () => {
    test("renders all required sections with static content", () => {
      const filledSections = new Map<string, string>();
      const output = renderTemplate(BIOPSY_NEXT_STEPS, filledSections, "en");

      // Required sections with static content should appear
      expect(output).toContain("**Understanding Your Biopsy Report**");
      expect(output).toContain("**Immediate Next Steps**");
      expect(output).toContain("**Questions for Your Next Appointment**");
      // Static content should be present
      expect(output).toContain("Don't panic");
      expect(output).toContain("What type of cancer has been found?");
    });

    test("includes filled retrieval sections", () => {
      const filledSections = new Map<string, string>();
      filledSections.set("additional_tests", "CT scan and PET scan may be ordered next.");
      filledSections.set("treatment_overview", "Surgery followed by chemotherapy is common.");

      const output = renderTemplate(BIOPSY_NEXT_STEPS, filledSections, "en");

      expect(output).toContain("**Tests Your Doctor May Order Next**");
      expect(output).toContain("CT scan and PET scan may be ordered next.");
      expect(output).toContain("**Possible Treatment Pathways**");
      expect(output).toContain("Surgery followed by chemotherapy is common.");
    });

    test("skips optional sections without content", () => {
      const filledSections = new Map<string, string>();
      // Do NOT fill optional sections
      const output = renderTemplate(BIOPSY_NEXT_STEPS, filledSections, "en");

      // Optional sections (additional_tests, treatment_overview) should be skipped
      expect(output).not.toContain("**Tests Your Doctor May Order Next**");
      expect(output).not.toContain("**Possible Treatment Pathways**");
    });

    test("skips optional sections with empty string content", () => {
      const filledSections = new Map<string, string>();
      filledSections.set("additional_tests", "");
      filledSections.set("treatment_overview", "   ");

      const output = renderTemplate(BIOPSY_NEXT_STEPS, filledSections, "en");

      expect(output).not.toContain("**Tests Your Doctor May Order Next**");
      expect(output).not.toContain("**Possible Treatment Pathways**");
    });

    test("uses Hindi headings when locale is 'hi'", () => {
      const filledSections = new Map<string, string>();
      const output = renderTemplate(BIOPSY_NEXT_STEPS, filledSections, "hi");

      expect(output).toContain("**अपनी बायोप्सी रिपोर्ट को समझें**");
      expect(output).toContain("**तुरंत अगले कदम**");
      expect(output).toContain("**अगली मुलाकात के लिए सवाल**");
      // English headings should NOT be present
      expect(output).not.toContain("**Understanding Your Biopsy Report**");
    });

    test("uses Hindi headings for 'bh' locale (Bhojpuri)", () => {
      const filledSections = new Map<string, string>();
      const output = renderTemplate(HOSPITAL_VISIT_PREP, filledSections, "bh");

      expect(output).toContain("**ले जाने वाले कागज़ात**");
      expect(output).not.toContain("**Documents to Carry**");
    });

    test("uses Hindi headings for 'mai' locale (Maithili)", () => {
      const filledSections = new Map<string, string>();
      const output = renderTemplate(HOSPITAL_VISIT_PREP, filledSections, "mai");

      expect(output).toContain("**ले जाने वाले कागज़ात**");
    });

    test("appends closing note", () => {
      const filledSections = new Map<string, string>();
      const output = renderTemplate(BIOPSY_NEXT_STEPS, filledSections, "en");

      expect(output).toContain("---");
      expect(output).toContain(
        "A biopsy report is the starting point, not the final answer."
      );
    });

    test("appends Hindi closing note when locale is 'hi'", () => {
      const filledSections = new Map<string, string>();
      const output = renderTemplate(BIOPSY_NEXT_STEPS, filledSections, "hi");

      expect(output).toContain("बायोप्सी रिपोर्ट शुरुआत है, अंतिम उत्तर नहीं");
    });

    test("required section with no content and no static shows placeholder", () => {
      // Create a template with a required section that has no static content
      const testTemplate: OutputTemplate = {
        id: "test_template",
        name: "Test",
        triggerCategories: ["EDUCATION"],
        sections: [
          {
            id: "empty_required",
            heading: "**Test Heading**",
            required: true,
            source: "retrieval",
          },
        ],
      };
      const filledSections = new Map<string, string>();
      const output = renderTemplate(testTemplate, filledSections, "en");

      expect(output).toContain("**Test Heading**");
      expect(output).toContain("Information not available");
    });

    test("complete hospital visit template renders all expected sections", () => {
      const filledSections = new Map<string, string>();
      filledSections.set("hospital_info", "AIIMS Patna - Oncology Department, Floor 3");
      filledSections.set("financial_support", "Ayushman Bharat covers up to 5 lakh");

      const output = renderTemplate(HOSPITAL_VISIT_PREP, filledSections, "en");

      expect(output).toContain("**Documents to Carry**");
      expect(output).toContain("Aadhaar card");
      expect(output).toContain("**Hospital / Treatment Centre Information**");
      expect(output).toContain("AIIMS Patna");
      expect(output).toContain("**Questions to Ask Your Doctor**");
      expect(output).toContain("**Financial Support Options**");
      expect(output).toContain("Ayushman Bharat covers up to 5 lakh");
      expect(output).toContain("**Practical Tips**");
      expect(output).toContain("Arrive early");
    });
  });

  // ─── Template Registry ──────────────────────────────────────────

  describe("TEMPLATE_REGISTRY", () => {
    test("contains all 6 expected templates", () => {
      expect(Object.keys(TEMPLATE_REGISTRY)).toHaveLength(6);
    });

    test("has hospital_visit_prep", () => {
      expect(TEMPLATE_REGISTRY["hospital_visit_prep"]).toBe(HOSPITAL_VISIT_PREP);
    });

    test("has scheme_application", () => {
      expect(TEMPLATE_REGISTRY["scheme_application"]).toBe(SCHEME_APPLICATION_CHECKLIST);
    });

    test("has chemo_day_prep", () => {
      expect(TEMPLATE_REGISTRY["chemo_day_prep"]).toBe(CHEMO_DAY_PREP);
    });

    test("has second_opinion_prep", () => {
      expect(TEMPLATE_REGISTRY["second_opinion_prep"]).toBe(SECOND_OPINION_PREP);
    });

    test("has psychosocial_support", () => {
      expect(TEMPLATE_REGISTRY["psychosocial_support"]).toBe(PSYCHOSOCIAL_SUPPORT);
    });

    test("has biopsy_next_steps", () => {
      expect(TEMPLATE_REGISTRY["biopsy_next_steps"]).toBe(BIOPSY_NEXT_STEPS);
    });

    test("every template has an id matching its registry key", () => {
      for (const [key, template] of Object.entries(TEMPLATE_REGISTRY)) {
        expect(template.id).toBe(key);
      }
    });

    test("every template has at least one section", () => {
      for (const template of Object.values(TEMPLATE_REGISTRY)) {
        expect(template.sections.length).toBeGreaterThanOrEqual(1);
      }
    });

    test("every template has a closing note", () => {
      for (const template of Object.values(TEMPLATE_REGISTRY)) {
        expect(template.closingNote).toBeDefined();
        expect(template.closingNote!.length).toBeGreaterThan(0);
      }
    });

    test("every template has a Hindi closing note", () => {
      for (const template of Object.values(TEMPLATE_REGISTRY)) {
        expect(template.closingNoteHi).toBeDefined();
        expect(template.closingNoteHi!.length).toBeGreaterThan(0);
      }
    });

    test("every section has a Hindi heading", () => {
      for (const template of Object.values(TEMPLATE_REGISTRY)) {
        for (const section of template.sections) {
          expect(section.headingHi).toBeDefined();
          expect(section.headingHi!.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
