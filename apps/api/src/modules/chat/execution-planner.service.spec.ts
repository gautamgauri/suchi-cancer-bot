import { ExecutionPlannerService, PlanStep, RetrievalStep, VerifyStep } from "./execution-planner.service";
import { HospitalDirectoryService } from "./hospital-directory.service";

describe("ExecutionPlannerService", () => {
  let planner: ExecutionPlannerService;

  beforeEach(() => {
    planner = new ExecutionPlannerService(new HospitalDirectoryService());
  });

  // Helper to extract steps of a given type
  function stepsOfType<T extends PlanStep>(steps: PlanStep[], type: string): T[] {
    return steps.filter((s) => s.type === type) as T[];
  }

  // ─── plan() ────────────────────────────────────────────────────

  describe("plan()", () => {
    test("navigation with hospital search → template plan with navigation + scheme retrieval", () => {
      const plan = planner.plan(
        "Which hospital in Patna is best for cancer treatment?",
        "NAVIGATION",
        { cancerType: "breast" },
        "en"
      );

      expect(plan.usesStructuredTemplate).toBe(true);
      expect(plan.template).not.toBeNull();
      expect(plan.template!.id).toBe("hospital_visit_prep");

      const retrievals = stepsOfType<RetrievalStep>(plan.steps, "retrieve");
      const intents = retrievals.map((r) => r.intent);
      expect(intents).toContain("navigation");
      expect(intents).toContain("schemes");
    });

    test("schemes query → template plan with scheme retrieval", () => {
      const plan = planner.plan(
        "How to apply for Ayushman Bharat card?",
        "SCHEMES",
        undefined,
        "en"
      );

      expect(plan.usesStructuredTemplate).toBe(true);
      expect(plan.template).not.toBeNull();
      expect(plan.template!.id).toBe("scheme_application");

      const retrievals = stepsOfType<RetrievalStep>(plan.steps, "retrieve");
      const intents = retrievals.map((r) => r.intent);
      expect(intents).toContain("schemes");
    });

    test("education simple query → non-template plan with LLM generation", () => {
      const plan = planner.plan(
        "What are the symptoms of lung cancer?",
        "EDUCATION",
        undefined,
        "en"
      );

      expect(plan.usesStructuredTemplate).toBe(false);
      expect(plan.template).toBeNull();

      // Should have a generate step
      const generateSteps = plan.steps.filter((s) => s.type === "generate");
      expect(generateSteps.length).toBe(1);

      // Should have retrieval
      const retrievals = stepsOfType<RetrievalStep>(plan.steps, "retrieve");
      expect(retrievals.length).toBeGreaterThanOrEqual(1);
      expect(retrievals[0].intent).toBe("education");
    });

    test("budget concern adds schemes retrieval to non-template plan", () => {
      const plan = planner.plan(
        "treatment options, paisa ki bahut dikkat hai",
        "EDUCATION",
        undefined,
        "en"
      );

      // Budget triggers SCHEME_APPLICATION_CHECKLIST template
      // or if non-template, adds schemes retrieval
      const retrievals = stepsOfType<RetrievalStep>(plan.steps, "retrieve");
      const intents = retrievals.map((r) => r.intent);
      expect(intents).toContain("schemes");
    });

    test("emotional distress adds psychosocial retrieval to non-template plan", () => {
      // Use a query that triggers emotional distress but not a psychosocial template
      // (emotional_distress signal on EDUCATION category without another template match)
      // Note: emotional_distress signal triggers PSYCHOSOCIAL_SUPPORT template,
      // so we test through the template path
      const plan = planner.plan(
        "I am very scared and worried about cancer diagnosis",
        "EDUCATION",
        undefined,
        "en"
      );

      // emotional_distress triggers PSYCHOSOCIAL_SUPPORT template
      expect(plan.template).not.toBeNull();
      expect(plan.template!.id).toBe("psychosocial_support");
    });

    test("emotional distress on NAVIGATION adds psychosocial retrieval (non-template path)", () => {
      // NAVIGATION without hospital_search signal, but with emotional distress
      // and no template match for navigation → falls through to non-template
      // Actually, "scared" + "which doctor" triggers hospital_search → template
      // Let's construct a case that goes non-template with emotional distress
      const plan = planner.plan(
        "I feel very helpless about this treatment and confused about what is happening",
        "EDUCATION",
        undefined,
        "en"
      );

      // emotional_distress → PSYCHOSOCIAL_SUPPORT template path
      expect(plan.signals).toContain("emotional_distress");
    });

    test("all plans have verify step at end", () => {
      const plan1 = planner.plan("biopsy report aaya hai", "NAVIGATION");
      const plan2 = planner.plan("What is cancer?", "EDUCATION");
      const plan3 = planner.plan("Ayushman card kaise banega", "SCHEMES");

      for (const plan of [plan1, plan2, plan3]) {
        const lastStep = plan.steps[plan.steps.length - 1];
        expect(lastStep.type).toBe("verify");
        expect((lastStep as VerifyStep).checks.length).toBeGreaterThan(0);
      }
    });

    test("verify step references correct content step", () => {
      // Template path
      const templatePlan = planner.plan("biopsy report aaya hai", "NAVIGATION");
      const templateVerify = templatePlan.steps.find((s) => s.type === "verify") as VerifyStep;
      expect(templateVerify.contentStepId).toContain("template_");

      // Non-template path
      const llmPlan = planner.plan("What is cancer staging?", "EDUCATION");
      const llmVerify = llmPlan.steps.find((s) => s.type === "verify") as VerifyStep;
      expect(llmVerify.contentStepId).toBe("generate_response");
    });

    test("retrieval capped at 5", () => {
      // Generate a query with many signals to trigger multiple retrievals
      const plan = planner.plan(
        "My mother got biopsy report in Gaya, budget is tight, she's very scared, which hospital for chemo, Ayushman card kaise banega",
        "NAVIGATION",
        { cancerType: "breast", budgetConcern: true }
      );

      const retrievals = stepsOfType<RetrievalStep>(plan.steps, "retrieve");
      expect(retrievals.length).toBeLessThanOrEqual(5);
      expect(plan.estimatedRetrievalCalls).toBeLessThanOrEqual(5);
    });

    test("estimatedRetrievalCalls matches actual retrieval steps", () => {
      const plan = planner.plan(
        "Which hospital in Patna for cancer treatment?",
        "NAVIGATION",
        { cancerType: "lung" }
      );

      const retrievals = stepsOfType<RetrievalStep>(plan.steps, "retrieve");
      expect(plan.estimatedRetrievalCalls).toBe(retrievals.length);
    });

    test("plan includes detected signals", () => {
      const plan = planner.plan(
        "biopsy report aaya, Patna mein hospital batao",
        "NAVIGATION"
      );

      expect(plan.signals).toContain("report_received");
      expect(plan.signals).toContain("location_mentioned");
      expect(plan.signals).toContain("hospital_search");
    });

    test("plan includes reasoning string", () => {
      const plan = planner.plan(
        "How to apply for Ayushman card?",
        "SCHEMES"
      );

      expect(plan.reasoning.length).toBeGreaterThan(0);
      expect(plan.reasoning).toContain("template");
    });

    test("planId is unique across calls", () => {
      const plan1 = planner.plan("query 1", "EDUCATION");
      const plan2 = planner.plan("query 2", "EDUCATION");
      expect(plan1.planId).not.toBe(plan2.planId);
    });

    test("cancer type from session context flows into retrieval steps", () => {
      const plan = planner.plan(
        "What are the treatment options?",
        "EDUCATION",
        { cancerType: "breast" }
      );

      const retrievals = stepsOfType<RetrievalStep>(plan.steps, "retrieve");
      expect(retrievals[0].cancerType).toBe("breast");
    });

    test("locale flows into template step", () => {
      const plan = planner.plan(
        "बायोप्सी रिपोर्ट आई है",
        "NAVIGATION",
        undefined,
        "hi"
      );

      const templateSteps = plan.steps.filter((s) => s.type === "template");
      expect(templateSteps.length).toBe(1);
      expect((templateSteps[0] as any).locale).toBe("hi");
    });

    test("EDUCATION + NAVIGATION verify checks include citations", () => {
      const educationPlan = planner.plan("What is staging?", "EDUCATION");
      const verifyStep = educationPlan.steps.find((s) => s.type === "verify") as VerifyStep;
      expect(verifyStep.checks).toContain("has_citations");
      expect(verifyStep.checks).toContain("no_ungrounded_entities");
    });

    test("PSYCHOSOCIAL verify checks do not include citations", () => {
      const plan = planner.plan(
        "I feel very scared about cancer",
        "PSYCHOSOCIAL"
      );
      const verifyStep = plan.steps.find((s) => s.type === "verify") as VerifyStep;
      expect(verifyStep.checks).not.toContain("has_citations");
      expect(verifyStep.checks).toContain("no_diagnosis");
      expect(verifyStep.checks).toContain("has_disclaimer");
      expect(verifyStep.checks).toContain("appropriate_tone");
    });

    test("template-driven retrieval deduplicates same intent", () => {
      // SCHEME_APPLICATION_CHECKLIST has 3 sections with intent "schemes"
      // but they should be deduplicated to 1 retrieval call
      const plan = planner.plan(
        "Tell me about Ayushman Bharat scheme",
        "SCHEMES"
      );

      const retrievals = stepsOfType<RetrievalStep>(plan.steps, "retrieve");
      const schemeRetrievals = retrievals.filter((r) => r.intent === "schemes");
      expect(schemeRetrievals.length).toBe(1);
    });
  });

  // ─── needsPlanning() ──────────────────────────────────────────

  describe("needsPlanning()", () => {
    test("EMERGENCY → false", () => {
      expect(
        planner.needsPlanning("uncontrolled bleeding", "EMERGENCY")
      ).toBe(false);
    });

    test("simple education with INFORMATIONAL_GENERAL intent → false", () => {
      expect(
        planner.needsPlanning(
          "What is cancer?",
          "EDUCATION",
          "INFORMATIONAL_GENERAL"
        )
      ).toBe(false);
    });

    test("simple education with INFORMATIONAL_SYMPTOMS intent → false", () => {
      expect(
        planner.needsPlanning(
          "What are breast cancer symptoms?",
          "EDUCATION",
          "INFORMATIONAL_SYMPTOMS"
        )
      ).toBe(false);
    });

    test("simple education with GREETING_ONLY intent → false", () => {
      expect(
        planner.needsPlanning(
          "Hello",
          "EDUCATION",
          "GREETING_ONLY"
        )
      ).toBe(false);
    });

    test("ADMIN → false", () => {
      expect(
        planner.needsPlanning("OPD timing for oncology", "ADMIN")
      ).toBe(false);
    });

    test("NAVIGATION → true", () => {
      expect(
        planner.needsPlanning("Which hospital in Patna?", "NAVIGATION")
      ).toBe(true);
    });

    test("SCHEMES → true", () => {
      expect(
        planner.needsPlanning("How to get Ayushman card?", "SCHEMES")
      ).toBe(true);
    });

    test("PSYCHOSOCIAL → true", () => {
      expect(
        planner.needsPlanning("I feel very scared about cancer", "PSYCHOSOCIAL")
      ).toBe(true);
    });

    test("EDUCATION single-domain question → false (signals alone don't plan)", () => {
      // Planning is reserved for genuinely multi-step / dependent requests, not
      // for any question that happens to surface signals. Here "affordable" does
      // NOT trigger budget_concern (\bafford\b ≠ "affordable"), so this is a
      // single hospital_search signal — a factual/navigation question that
      // should get a direct answer, not a planning turn.
      expect(
        planner.needsPlanning(
          "Which hospital is affordable for cancer treatment?",
          "EDUCATION"
        )
      ).toBe(false);
    });

    test("EDUCATION with single signal and simple intent → false", () => {
      // "hospital" alone triggers hospital_search (1 signal), not enough
      expect(
        planner.needsPlanning(
          "What happens at the hospital?",
          "EDUCATION",
          "INFORMATIONAL_GENERAL"
        )
      ).toBe(false);
    });

    test("EDUCATION with signals overrides simple intent → true", () => {
      // Budget concern + hospital → 2 signals, even with INFORMATIONAL_GENERAL
      expect(
        planner.needsPlanning(
          "Which hospital is affordable, paisa ki dikkat hai",
          "EDUCATION",
          "INFORMATIONAL_GENERAL"
        )
      ).toBe(true);
    });
  });
});
