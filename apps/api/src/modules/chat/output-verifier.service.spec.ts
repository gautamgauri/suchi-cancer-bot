import { OutputVerifierService } from "./output-verifier.service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

describe("OutputVerifierService", () => {
  let verifier: OutputVerifierService;

  beforeEach(() => {
    verifier = new OutputVerifierService();
  });

  // Helper to create a mock evidence chunk
  function makeEvidence(content: string, source = "NCBI"): EvidenceChunk {
    return {
      chunkId: "chunk_1",
      docId: "doc_1",
      content,
      document: {
        title: "Test Document",
        url: "https://example.com",
        sourceType: "journal",
        source,
        citation: "Test et al. 2024",
        isTrustedSource: true,
      },
      similarity: 0.9,
    };
  }

  const ALL_CHECKS = [
    "no_diagnosis" as const,
    "no_prognosis" as const,
    "no_dosage" as const,
    "has_disclaimer" as const,
    "has_citations" as const,
    "appropriate_tone" as const,
    "no_ungrounded_entities" as const,
  ];

  // ─── verify() — no_diagnosis ────────────────────────────────────

  describe("no_diagnosis check", () => {
    test("catches 'you have cancer'", () => {
      const result = verifier.verify(
        "Based on the report, you have cancer and need treatment.",
        [],
        ["no_diagnosis"],
        "what does my report mean"
      );

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("no_diagnosis");
      expect(result.violations[0].severity).toBe("critical");
    });

    test("catches 'this is cancer'", () => {
      const result = verifier.verify(
        "Looking at your symptoms, this is cancer of the lung.",
        [],
        ["no_diagnosis"],
        "what is wrong"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_diagnosis");
    });

    test("catches 'you are diagnosed with'", () => {
      const result = verifier.verify(
        "It seems you are diagnosed with breast carcinoma.",
        [],
        ["no_diagnosis"],
        "what is my condition"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_diagnosis");
    });

    test("catches 'this confirms cancer'", () => {
      const result = verifier.verify(
        "The biopsy shows this confirms cancer in the tissue sample.",
        [],
        ["no_diagnosis"],
        "biopsy result"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_diagnosis");
    });

    test("catches 'I can confirm'", () => {
      const result = verifier.verify(
        "I can confirm that the cells are malignant.",
        [],
        ["no_diagnosis"],
        "report analysis"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_diagnosis");
    });

    test("catches Hindi: 'आपको कैंसर है'", () => {
      const result = verifier.verify(
        "जांच के अनुसार आपको कैंसर है और इलाज जरूरी है।",
        [],
        ["no_diagnosis"],
        "रिपोर्ट क्या कहती है"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_diagnosis");
    });

    test("catches Hindi: 'यह कैंसर है'", () => {
      const result = verifier.verify(
        "रिपोर्ट से लगता है यह कैंसर है।",
        [],
        ["no_diagnosis"],
        "report kya hai"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_diagnosis");
    });

    test("passes for educational content about cancer without diagnosis", () => {
      const result = verifier.verify(
        "Cancer is a group of diseases involving abnormal cell growth. Symptoms can include lumps, abnormal bleeding, and weight loss.",
        [],
        ["no_diagnosis"],
        "what is cancer"
      );

      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(0);
    });
  });

  // ─── verify() — no_prognosis ────────────────────────────────────

  describe("no_prognosis check", () => {
    test("catches 'you will survive X years'", () => {
      const result = verifier.verify(
        "With this treatment, you will survive 5 years or more.",
        [],
        ["no_prognosis"],
        "what is my outlook"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_prognosis");
      expect(result.violations[0].severity).toBe("critical");
    });

    test("catches 'you will live'", () => {
      const result = verifier.verify(
        "Don't worry, you will live a long life.",
        [],
        ["no_prognosis"],
        "will I be ok"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_prognosis");
    });

    test("catches percentage survival predictions", () => {
      const result = verifier.verify(
        "There is a 70% chance of survival with this treatment plan.",
        [],
        ["no_prognosis"],
        "what are my chances"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_prognosis");
    });

    test("catches 'your chances of'", () => {
      const result = verifier.verify(
        "Your chances of recovery are very good at this stage.",
        [],
        ["no_prognosis"],
        "how are my chances"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_prognosis");
    });

    test("catches 'you will recover'", () => {
      const result = verifier.verify(
        "With proper care, you will recover fully.",
        [],
        ["no_prognosis"],
        "will I get better"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_prognosis");
    });

    test("catches Hindi: 'आप ठीक हो जाएंगे'", () => {
      const result = verifier.verify(
        "चिंता मत करें, आप ठीक हो जाएंगे।",
        [],
        ["no_prognosis"],
        "क्या मैं ठीक होऊंगा"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_prognosis");
    });

    test("passes for general treatment info without prognosis", () => {
      const result = verifier.verify(
        "Treatment options for breast cancer include surgery, chemotherapy, and radiation therapy. Your doctor will create a personalized treatment plan.",
        [],
        ["no_prognosis"],
        "treatment options"
      );

      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(0);
    });
  });

  // ─── verify() — no_dosage ──────────────────────────────────────

  describe("no_dosage check", () => {
    test("catches 'take 500mg'", () => {
      const result = verifier.verify(
        "You should take 500mg of paracetamol for the pain.",
        [],
        ["no_dosage"],
        "pain management"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_dosage");
      expect(result.violations[0].severity).toBe("critical");
    });

    test("catches specific drug dosing: mg daily", () => {
      const result = verifier.verify(
        "The recommended regimen is 200mg twice daily for 6 weeks.",
        [],
        ["no_dosage"],
        "drug schedule"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_dosage");
    });

    test("catches 'take X tablets'", () => {
      const result = verifier.verify(
        "Take 2 tablet after meals for the nausea.",
        [],
        ["no_dosage"],
        "nausea"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_dosage");
    });

    test("catches mg of specific drug", () => {
      const result = verifier.verify(
        "Standard protocol includes 75mg of cisplatin every 3 weeks.",
        [],
        ["no_dosage"],
        "chemo protocol"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_dosage");
    });

    test("catches 'prescribe' with dosage", () => {
      const result = verifier.verify(
        "Your doctor may prescribe 20mg for pain relief.",
        [],
        ["no_dosage"],
        "pain treatment"
      );

      expect(result.passed).toBe(false);
      expect(result.violations[0].check).toBe("no_dosage");
    });

    test("passes for general drug mentions without dosage", () => {
      const result = verifier.verify(
        "Chemotherapy drugs like cisplatin may be used. Your oncologist will determine the appropriate dosage based on your weight and condition.",
        [],
        ["no_dosage"],
        "chemo info"
      );

      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(0);
    });
  });

  // ─── verify() — has_disclaimer ─────────────────────────────────

  describe("has_disclaimer check", () => {
    test("auto-adds disclaimer when missing from medical content", () => {
      const content = "Cancer treatment involves chemotherapy, radiation, and surgery.";
      const result = verifier.verify(
        content,
        [],
        ["has_disclaimer"],
        "treatment info"
      );

      // Should pass because auto-fixed
      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].check).toBe("has_disclaimer");
      expect(result.violations[0].autoFixed).toBe(true);
      expect(result.violations[0].severity).toBe("warning");
      expect(result.fixedContent).not.toBeNull();
      expect(result.fixedContent).toContain("educational purposes");
      expect(result.fixedContent).toContain(content);
    });

    test("skips if disclaimer already present (common patterns)", () => {
      const content =
        "Cancer treatment involves chemotherapy. This information is for educational purposes and is not a diagnosis. Please consult your healthcare provider.";
      const result = verifier.verify(
        content,
        [],
        ["has_disclaimer"],
        "treatment info"
      );

      expect(result.violations.length).toBe(0);
      expect(result.fixedContent).toBeNull();
    });

    test("skips disclaimer check for non-medical content", () => {
      const content = "Hello! How can I help you today? Feel free to ask any questions.";
      const result = verifier.verify(
        content,
        [],
        ["has_disclaimer"],
        "hello"
      );

      // Non-medical content does not need a disclaimer
      expect(result.violations.length).toBe(0);
      expect(result.fixedContent).toBeNull();
    });
  });

  // ─── verify() — appropriate_tone ───────────────────────────────

  describe("appropriate_tone check", () => {
    test("catches 'just relax'", () => {
      const result = verifier.verify(
        "You should just relax and not worry about the test results.",
        [],
        ["appropriate_tone"],
        "I am anxious"
      );

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("appropriate_tone");
    });

    test("catches 'don't worry'", () => {
      const result = verifier.verify(
        "Please just don't worry, everything will be fine.",
        [],
        ["appropriate_tone"],
        "I feel scared"
      );

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("appropriate_tone");
    });

    test("catches 'be positive'", () => {
      const result = verifier.verify(
        "You need to be positive and think good thoughts.",
        [],
        ["appropriate_tone"],
        "feeling down"
      );

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("appropriate_tone");
    });

    test("catches 'think positive'", () => {
      const result = verifier.verify(
        "Try to think positive and keep your spirits up.",
        [],
        ["appropriate_tone"],
        "I am depressed"
      );

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("appropriate_tone");
    });

    test("catches 'everything happens for a reason'", () => {
      const result = verifier.verify(
        "Remember, everything happens for a reason.",
        [],
        ["appropriate_tone"],
        "why me"
      );

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("appropriate_tone");
    });

    test("catches 'stop worrying'", () => {
      const result = verifier.verify(
        "You need to stop worrying about things you can't control.",
        [],
        ["appropriate_tone"],
        "I am anxious"
      );

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("appropriate_tone");
    });

    test("catches Hindi: 'चिंता मत करो'", () => {
      const result = verifier.verify(
        "बस चिंता मत करो, सब ठीक हो जाएगा।",
        [],
        ["appropriate_tone"],
        "बहुत डर लगता है"
      );

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("appropriate_tone");
    });

    test("passes for empathetic, supportive tone", () => {
      const result = verifier.verify(
        "It is completely understandable to feel anxious about your diagnosis. Many patients experience similar feelings. Speaking with a counselor can help you process these emotions.",
        [],
        ["appropriate_tone"],
        "I am scared"
      );

      expect(result.violations.length).toBe(0);
    });
  });

  // ─── verify() — has_citations ──────────────────────────────────

  describe("has_citations check", () => {
    test("warns if medical content has no citations but evidence exists", () => {
      const evidence = [makeEvidence("Breast cancer is the most common cancer in women.")];
      const result = verifier.verify(
        "Breast cancer is the most common cancer in women. Early detection through screening improves outcomes.",
        evidence,
        ["has_citations"],
        "breast cancer info"
      );

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("has_citations");
      expect(result.violations[0].severity).toBe("warning");
    });

    test("passes if medical content has citation markers", () => {
      const evidence = [makeEvidence("Breast cancer is the most common cancer.")];
      const result = verifier.verify(
        "Breast cancer is the most common cancer in women [citation:test_doc_1]. Early detection improves outcomes.",
        evidence,
        ["has_citations"],
        "breast cancer info"
      );

      expect(result.violations.filter((v) => v.check === "has_citations").length).toBe(0);
    });

    test("skips citation check for non-medical content", () => {
      const result = verifier.verify(
        "Hello! How can I help you today?",
        [],
        ["has_citations"],
        "hello"
      );

      expect(result.violations.length).toBe(0);
    });

    test("skips citation check when no evidence chunks provided", () => {
      const result = verifier.verify(
        "Cancer is a serious disease that requires treatment.",
        [],
        ["has_citations"],
        "cancer info"
      );

      // No evidence chunks → no citation warning
      expect(result.violations.filter((v) => v.check === "has_citations").length).toBe(0);
    });
  });

  // ─── verify() — no_ungrounded_entities ─────────────────────────

  describe("no_ungrounded_entities check", () => {
    test("catches percentage claims not in evidence", () => {
      const evidence = [makeEvidence("Treatment has shown good response rates in clinical trials.")];
      const result = verifier.verify(
        "This treatment has a 95% chance of curing your cancer type.",
        evidence,
        ["no_ungrounded_entities"],
        "treatment effectiveness"
      );

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0].check).toBe("no_ungrounded_entities");
    });

    test("passes when percentage claim exists in evidence", () => {
      const evidence = [makeEvidence("The 5-year survival rate is approximately 85% for early stage breast cancer.")];
      const result = verifier.verify(
        "The 85% survival rate applies to early stage cases.",
        evidence,
        ["no_ungrounded_entities"],
        "survival rates"
      );

      expect(result.violations.filter((v) => v.check === "no_ungrounded_entities").length).toBe(0);
    });

    test("skips check when no evidence chunks", () => {
      const result = verifier.verify(
        "About 50% of patients respond to this treatment.",
        [],
        ["no_ungrounded_entities"],
        "treatment info"
      );

      // No evidence → no ungrounded check
      expect(result.violations.filter((v) => v.check === "no_ungrounded_entities").length).toBe(0);
    });

    test("skips check when no percentage claims in content", () => {
      const evidence = [makeEvidence("Cancer treatment involves multiple modalities.")];
      const result = verifier.verify(
        "Cancer treatment typically involves surgery, chemotherapy, or radiation.",
        evidence,
        ["no_ungrounded_entities"],
        "treatment overview"
      );

      expect(result.violations.filter((v) => v.check === "no_ungrounded_entities").length).toBe(0);
    });
  });

  // ─── verify() — clean content passes all checks ────────────────

  describe("clean content passes all checks", () => {
    test("well-written educational content with disclaimer passes everything", () => {
      const evidence = [
        makeEvidence("Breast cancer treatment options include surgery, chemotherapy, and radiation. Early detection leads to better outcomes."),
      ];
      const content = [
        "Breast cancer treatment typically involves a combination of approaches. [citation:test_doc_1]",
        "",
        "Your oncologist will evaluate your specific case and recommend a personalized treatment plan.",
        "",
        "It is completely normal to have concerns. Please discuss your questions with your healthcare team.",
        "",
        "---",
        "*This information is for general educational purposes only and is not a substitute for professional medical advice, diagnosis, or treatment. Always consult your healthcare provider for personalized guidance.*",
      ].join("\n");

      const result = verifier.verify(content, evidence, ALL_CHECKS, "breast cancer treatment");

      expect(result.passed).toBe(true);
      expect(result.violations.filter((v) => v.severity === "critical").length).toBe(0);
    });

    test("non-medical greeting passes all checks", () => {
      const result = verifier.verify(
        "Hello! I am Suchi, your cancer care navigation assistant. How can I help you today?",
        [],
        ALL_CHECKS,
        "hello"
      );

      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(0);
    });
  });

  // ─── verify() — multiple violations ────────────────────────────

  describe("multiple violations", () => {
    test("detects both diagnosis and prognosis violations", () => {
      const result = verifier.verify(
        "You have cancer. You will survive 5 years with treatment.",
        [],
        ["no_diagnosis", "no_prognosis"],
        "what is my condition"
      );

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBe(2);
      const checks = result.violations.map((v) => v.check);
      expect(checks).toContain("no_diagnosis");
      expect(checks).toContain("no_prognosis");
    });

    test("critical unfixed violation causes failure even with auto-fixed warning", () => {
      const result = verifier.verify(
        "You have cancer. Your doctor will guide you on treatment.",
        [],
        ["no_diagnosis", "has_disclaimer"],
        "what is my condition"
      );

      expect(result.passed).toBe(false);
      // diagnosis is critical and unfixed
      const diagViolation = result.violations.find((v) => v.check === "no_diagnosis");
      expect(diagViolation).toBeDefined();
      expect(diagViolation!.severity).toBe("critical");
      expect(diagViolation!.autoFixed).toBe(false);
    });
  });

  // ─── verify() — summary ────────────────────────────────────────

  describe("summary output", () => {
    test("clean content produces 'All checks passed' summary", () => {
      const result = verifier.verify(
        "Hello there!",
        [],
        ["no_diagnosis", "no_prognosis"],
        "hello"
      );

      expect(result.summary).toBe("All checks passed");
    });

    test("violations produce descriptive summary", () => {
      const result = verifier.verify(
        "You have cancer.",
        [],
        ["no_diagnosis"],
        "what is my condition"
      );

      expect(result.summary).toContain("critical");
      expect(result.summary).toContain("no_diagnosis");
    });

    test("auto-fixed violations show (auto-fixed) in summary", () => {
      const result = verifier.verify(
        "Chemotherapy is a common cancer treatment.",
        [],
        ["has_disclaimer"],
        "chemo info"
      );

      expect(result.summary).toContain("auto-fixed");
    });
  });

  // ─── quickVerify() ─────────────────────────────────────────────

  describe("quickVerify()", () => {
    test("runs essential checks: no_diagnosis, no_prognosis, no_dosage, has_disclaimer", () => {
      const result = verifier.quickVerify(
        "You have cancer. Take 500mg of cisplatin. You will survive 3 years.",
        [],
        "what should I do"
      );

      expect(result.passed).toBe(false);
      const checks = result.violations.map((v) => v.check);
      expect(checks).toContain("no_diagnosis");
      expect(checks).toContain("no_prognosis");
      expect(checks).toContain("no_dosage");
    });

    test("does NOT run has_citations or appropriate_tone", () => {
      const evidence = [makeEvidence("Cancer info here.")];
      const result = verifier.quickVerify(
        "Cancer treatment info without citations. Just relax about it.",
        evidence,
        "cancer treatment"
      );

      // quickVerify does not include has_citations or appropriate_tone
      const checks = result.violations.map((v) => v.check);
      expect(checks).not.toContain("has_citations");
      expect(checks).not.toContain("appropriate_tone");
      expect(checks).not.toContain("no_ungrounded_entities");
    });

    test("clean content passes quickVerify", () => {
      const result = verifier.quickVerify(
        "Cancer is a group of diseases. Please consult your doctor for medical advice.",
        [],
        "what is cancer"
      );

      expect(result.passed).toBe(true);
    });

    test("auto-adds disclaimer for medical content", () => {
      const result = verifier.quickVerify(
        "Chemotherapy is used to treat many types of cancer.",
        [],
        "chemo info"
      );

      // Should pass (disclaimer auto-fixed is a warning, not critical)
      expect(result.passed).toBe(true);
      expect(result.fixedContent).not.toBeNull();
      expect(result.fixedContent).toContain("educational purposes");
    });
  });

  // ─── Auto-fix capability ───────────────────────────────────────

  describe("auto-fix capability", () => {
    test("disclaimer is prepended to medical content when missing", () => {
      const originalContent = "Surgery is the primary treatment for early-stage breast cancer.";
      const result = verifier.verify(
        originalContent,
        [],
        ["has_disclaimer"],
        "surgery info"
      );

      expect(result.fixedContent).not.toBeNull();
      // Disclaimer should be prepended
      expect(result.fixedContent!.startsWith("**Important:**")).toBe(true);
      // Original content should still be present
      expect(result.fixedContent).toContain(originalContent);
    });

    test("fixedContent is null when no fixes are needed", () => {
      const result = verifier.verify(
        "Hello! How can I help you?",
        [],
        ["has_disclaimer"],
        "greeting"
      );

      expect(result.fixedContent).toBeNull();
    });

    test("fixedContent is null when disclaimer already exists", () => {
      const content =
        "Cancer requires treatment. This is not a diagnosis. Please consult your healthcare provider for medical advice.";
      const result = verifier.verify(
        content,
        [],
        ["has_disclaimer"],
        "cancer info"
      );

      expect(result.fixedContent).toBeNull();
    });
  });
});
