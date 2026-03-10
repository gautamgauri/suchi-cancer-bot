import { QueryDecomposerService, SessionContext } from "./query-decomposer.service";

describe("QueryDecomposerService", () => {
  let decomposer: QueryDecomposerService;

  beforeEach(() => {
    decomposer = new QueryDecomposerService();
  });

  describe("Simple single-intent queries", () => {
    test("general education query → 1 call (education)", () => {
      const result = decomposer.decompose(
        "What are the symptoms of breast cancer?",
        "EDUCATION"
      );
      expect(result.calls.length).toBe(1);
      expect(result.calls[0].intent).toBe("education");
    });

    test("simple scheme query → 1 call (schemes)", () => {
      const result = decomposer.decompose(
        "How to apply for Ayushman Bharat card?",
        "SCHEMES"
      );
      expect(result.calls.length).toBeGreaterThanOrEqual(1);
      expect(result.calls.some((c) => c.intent === "schemes")).toBe(true);
    });
  });

  describe("Complex multi-intent queries (the key upgrade)", () => {
    test("biopsy + location + budget → 3 calls", () => {
      const result = decomposer.decompose(
        "My uncle has a biopsy report, we're in Gaya, budget is tight",
        "NAVIGATION",
        { cancerType: "lung", userContext: "caregiver" }
      );

      expect(result.calls.length).toBeGreaterThanOrEqual(2);

      const intents = result.calls.map((c) => c.intent);
      // Should have navigation (for hospital) + checklist (for biopsy docs) + schemes (for budget)
      expect(intents).toContain("navigation");
      expect(
        intents.includes("schemes") || intents.includes("checklist")
      ).toBe(true);

      expect(result.detectedSignals).toContain("location_mentioned");
      expect(result.detectedSignals).toContain("budget_concern");
    });

    test("biopsy report received + what next → navigation + checklist", () => {
      const result = decomposer.decompose(
        "Biopsy report aaya hai, aage kya karna hai?",
        "NAVIGATION"
      );

      expect(result.calls.length).toBeGreaterThanOrEqual(2);
      const intents = result.calls.map((c) => c.intent);
      expect(intents).toContain("checklist");
      expect(intents).toContain("navigation");
      expect(result.detectedSignals).toContain("report_received");
      expect(result.detectedSignals).toContain("next_steps");
    });

    test("hospital search + financial concern → navigation + schemes", () => {
      const result = decomposer.decompose(
        "Which hospital for chemo in Patna? We can't afford much.",
        "NAVIGATION",
        { cancerType: "breast" }
      );

      expect(result.calls.length).toBeGreaterThanOrEqual(2);
      const intents = result.calls.map((c) => c.intent);
      expect(intents).toContain("navigation");
      expect(intents).toContain("schemes");
    });

    test("emotional distress + navigation → psychosocial + navigation", () => {
      const result = decomposer.decompose(
        "I'm very scared about the diagnosis, which doctor should we see in Patna?",
        "NAVIGATION"
      );

      expect(result.calls.length).toBeGreaterThanOrEqual(2);
      const intents = result.calls.map((c) => c.intent);
      expect(intents).toContain("psychosocial");
      expect(intents).toContain("navigation");
    });
  });

  describe("Hindi queries", () => {
    test("Hindi biopsy + next steps", () => {
      const result = decomposer.decompose(
        "बायोप्सी रिपोर्ट आई है, आगे क्या करें",
        "NAVIGATION"
      );

      expect(result.detectedSignals).toContain("report_received");
      expect(result.detectedSignals).toContain("next_steps");
      expect(result.calls.length).toBeGreaterThanOrEqual(2);
    });

    test("Hindi emotional + location", () => {
      const result = decomposer.decompose(
        "बहुत डर लग रहा है, Patna में कौन सा hospital अच्छा है",
        "NAVIGATION"
      );

      expect(result.detectedSignals).toContain("emotional_distress");
      expect(result.detectedSignals).toContain("location_mentioned");
    });
  });

  describe("Hinglish queries", () => {
    test("Hinglish hospital + budget", () => {
      const result = decomposer.decompose(
        "kaun sa hospital acha hai Patna mein, paisa ki dikkat hai",
        "NAVIGATION"
      );

      expect(result.detectedSignals).toContain("hospital_search");
      expect(result.detectedSignals).toContain("location_mentioned");
    });

    test("Hinglish biopsy + what next", () => {
      const result = decomposer.decompose(
        "biopsy report aa gaya hai, aage kya karna hai",
        "NAVIGATION"
      );

      expect(result.detectedSignals).toContain("report_received");
      expect(result.detectedSignals).toContain("next_steps");
    });
  });

  describe("Session context influence", () => {
    test("budget concern from session adds schemes call", () => {
      const result = decomposer.decompose(
        "Which hospital in Patna for lung cancer?",
        "NAVIGATION",
        { cancerType: "lung", budgetConcern: true }
      );

      const intents = result.calls.map((c) => c.intent);
      expect(intents).toContain("schemes");
    });

    test("cancer type flows into retrieval queries", () => {
      const result = decomposer.decompose(
        "Which hospital is best?",
        "NAVIGATION",
        { cancerType: "breast" }
      );

      expect(result.calls[0].cancerType).toBe("breast");
    });
  });

  describe("needsDecomposition", () => {
    test("emergency → false (fast-path handles it)", () => {
      expect(
        decomposer.needsDecomposition("uncontrolled bleeding", "EMERGENCY")
      ).toBe(false);
    });

    test("simple education → false", () => {
      expect(
        decomposer.needsDecomposition(
          "What is cancer?",
          "EDUCATION"
        )
      ).toBe(false);
    });

    test("navigation → true", () => {
      expect(
        decomposer.needsDecomposition(
          "Which hospital in Patna?",
          "NAVIGATION"
        )
      ).toBe(true);
    });

    test("multi-signal query → true", () => {
      expect(
        decomposer.needsDecomposition(
          "Biopsy report aaya, Patna mein hospital batao, paisa kam hai",
          "NAVIGATION"
        )
      ).toBe(true);
    });
  });

  describe("Cap at 5 calls", () => {
    test("even very complex query produces max 5 calls", () => {
      const result = decomposer.decompose(
        "My mother got biopsy report in Gaya, budget is tight, she's very scared, which hospital for chemo, Ayushman card kaise banega, prepare for first visit",
        "NAVIGATION",
        { cancerType: "breast", budgetConcern: true }
      );

      expect(result.calls.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Reasoning output", () => {
    test("includes detected signals in reasoning", () => {
      const result = decomposer.decompose(
        "Hospital in Patna, paisa ki dikkat hai",
        "NAVIGATION"
      );

      expect(result.reasoning).toContain("location_mentioned");
      expect(result.reasoning.length).toBeGreaterThan(10);
    });

    test("no-signal reasoning mentions default", () => {
      const result = decomposer.decompose("Hello", "EDUCATION");
      expect(result.reasoning).toContain("default");
    });
  });
});
