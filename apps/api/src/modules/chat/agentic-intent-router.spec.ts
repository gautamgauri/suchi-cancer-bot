import {
  classifyFastPath,
  mapDetailedIntentToCategory,
  classifyAgenticIntent,
} from "./agentic-intent-router";

describe("AgenticIntentRouter", () => {
  describe("classifyFastPath — EMERGENCY", () => {
    const emergencyCases = [
      "uncontrolled bleeding",
      "I can't breathe",
      "severe chest pain",
      "she's unconscious",
      "खून बहुत आ रहा है",
      "सांस नहीं आ रही",
      "behosh ho gaya",
      "call 108 ambulance",
      "एम्बुलेंस भेजो",
    ];

    test.each(emergencyCases)("classifies as EMERGENCY: %s", (text) => {
      const result = classifyFastPath(text);
      expect(result).not.toBeNull();
      expect(result!.category).toBe("EMERGENCY");
      expect(result!.confidence).toBe(1.0);
      expect(result!.isRuleBased).toBe(true);
    });
  });

  describe("classifyFastPath — PSYCHOSOCIAL", () => {
    const psychoCases = [
      "I want to die",
      "feeling so alone with this cancer",
      "I'm depressed and can't cope",
      "need someone to talk to about my diagnosis",
      "बहुत डर लग रहा है cancer ke baare mein",
      "how do I tell my children about the diagnosis",
      "bahut darr lag raha hai",
    ];

    test.each(psychoCases)("classifies as PSYCHOSOCIAL: %s", (text) => {
      const result = classifyFastPath(text);
      expect(result).not.toBeNull();
      expect(result!.category).toBe("PSYCHOSOCIAL");
    });

    test("crisis indicators get confidence 1.0", () => {
      const result = classifyFastPath("I want to kill myself");
      expect(result!.confidence).toBe(1.0);
    });

    test("non-crisis gets lower confidence", () => {
      const result = classifyFastPath("feeling depressed about my diagnosis");
      expect(result!.confidence).toBeLessThan(1.0);
      expect(result!.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("classifyFastPath — SCHEMES", () => {
    const schemeCases = [
      "How to apply for Ayushman Bharat card?",
      "Ayushman card kaise banega?",
      "government scheme for cancer treatment",
      "सरकारी योजना cancer ke liye",
      "PMJAY mein cancer cover hota hai?",
      "financial help for cancer treatment",
      "आयुष्मान कार्ड कैसे बनेगा",
      "BPL family cancer treatment",
      "paisa ki madad chahiye treatment ke liye",
    ];

    test.each(schemeCases)("classifies as SCHEMES: %s", (text) => {
      const result = classifyFastPath(text);
      expect(result).not.toBeNull();
      expect(result!.category).toBe("SCHEMES");
    });
  });

  describe("classifyFastPath — ADMIN", () => {
    const adminCases = [
      "OPD timing for AIIMS oncology department",
      "which floor is the oncology department",
      "how to book appointment at Tata Memorial",
      "what documents do I need to bring",
      "ओपीडी का समय क्या है",
      "appointment kaise book kare",
    ];

    test.each(adminCases)("classifies as ADMIN: %s", (text) => {
      const result = classifyFastPath(text);
      expect(result).not.toBeNull();
      expect(result!.category).toBe("ADMIN");
    });
  });

  describe("classifyFastPath — NAVIGATION", () => {
    const navCases = [
      "Which hospital is best for chemo in Patna?",
      "Biopsy report aaya hai, aage kya karna hai?",
      "I need a second opinion on my diagnosis",
      "how to prepare for my first chemo session",
      "best oncologist near Gaya Bihar",
      "बायोप्सी रिपोर्ट आई है, आगे क्या करें",
      "where should we go for treatment",
    ];

    test.each(navCases)("classifies as NAVIGATION: %s", (text) => {
      const result = classifyFastPath(text);
      expect(result).not.toBeNull();
      expect(result!.category).toBe("NAVIGATION");
    });
  });

  describe("classifyFastPath — returns null for ambiguous", () => {
    const ambiguousCases = [
      "What is cancer?",
      "How does chemotherapy work?",
      "breast cancer symptoms",
      "side effects of radiation",
      "Hello",
    ];

    test.each(ambiguousCases)("returns null for: %s", (text) => {
      const result = classifyFastPath(text);
      expect(result).toBeNull();
    });
  });

  describe("mapDetailedIntentToCategory", () => {
    test("INFORMATIONAL_GENERAL -> EDUCATION", () => {
      const result = mapDetailedIntentToCategory("INFORMATIONAL_GENERAL", "high");
      expect(result.category).toBe("EDUCATION");
      expect(result.confidence).toBe(0.9);
    });

    test("CARE_NAVIGATION_PROVIDER_CHOICE -> NAVIGATION", () => {
      const result = mapDetailedIntentToCategory("CARE_NAVIGATION_PROVIDER_CHOICE", "high");
      expect(result.category).toBe("NAVIGATION");
    });

    test("PSYCHOLOGICAL_CRISIS -> PSYCHOSOCIAL", () => {
      const result = mapDetailedIntentToCategory("PSYCHOLOGICAL_CRISIS", "high");
      expect(result.category).toBe("PSYCHOSOCIAL");
    });

    test("SYMPTOMS_URGENT_RED_FLAGS -> EMERGENCY", () => {
      const result = mapDetailedIntentToCategory("SYMPTOMS_URGENT_RED_FLAGS", "high");
      expect(result.category).toBe("EMERGENCY");
    });

    test("low confidence maps to 0.5 numeric", () => {
      const result = mapDetailedIntentToCategory("INFORMATIONAL_GENERAL", "low");
      expect(result.confidence).toBe(0.5);
    });
  });

  describe("classifyAgenticIntent — two-stage integration", () => {
    test("rule-based takes priority over detailed intent for emergencies", () => {
      const result = classifyAgenticIntent(
        "uncontrolled bleeding won't stop",
        "INFORMATIONAL_GENERAL",
        "high"
      );
      expect(result.category).toBe("EMERGENCY");
      expect(result.isRuleBased).toBe(true);
    });

    test("falls back to detailed intent for education queries", () => {
      const result = classifyAgenticIntent(
        "What is staging in cancer?",
        "INFORMATIONAL_GENERAL",
        "high"
      );
      expect(result.category).toBe("EDUCATION");
      expect(result.isRuleBased).toBe(false);
    });

    test("defaults to EDUCATION when no info available", () => {
      const result = classifyAgenticIntent("hello there");
      expect(result.category).toBe("EDUCATION");
      expect(result.confidence).toBe(0.3);
    });

    test("SCHEMES fast-path overrides NAVIGATION detailed intent", () => {
      const result = classifyAgenticIntent(
        "Ayushman card kaise banega?",
        "CARE_NAVIGATION_PROVIDER_CHOICE",
        "high"
      );
      expect(result.category).toBe("SCHEMES");
      expect(result.isRuleBased).toBe(true);
    });
  });

  describe("Priority ordering", () => {
    test("EMERGENCY takes priority over PSYCHOSOCIAL", () => {
      // Text with both emergency and psychosocial indicators
      const result = classifyFastPath("I can't breathe and I feel so alone");
      expect(result!.category).toBe("EMERGENCY");
    });

    test("PSYCHOSOCIAL takes priority over SCHEMES", () => {
      const result = classifyFastPath("I want to die, can't afford treatment");
      expect(result!.category).toBe("PSYCHOSOCIAL");
    });
  });

  // FR-CHAT-019 — medical therapy phrases must NOT fire PSYCHOSOCIAL fast-path
  describe("classifyFastPath — therapy false-positive guard (FR-CHAT-019)", () => {
    const medicalTherapyCases = [
      "what are the side effects of radiation therapy",
      "how does radiation therapy work",
      "tell me about targeted therapy for breast cancer",
      "chemotherapy vs radiation therapy",
      "immunotherapy options for lung cancer",
      "what is hormone therapy for prostate cancer",
      "I just finished radiation therapy, what next",
      "therapy",
    ];

    test.each(medicalTherapyCases)("medical therapy phrase does NOT classify as PSYCHOSOCIAL: %s", (text) => {
      const result = classifyFastPath(text);
      expect(result?.category).not.toBe("PSYCHOSOCIAL");
    });

    test.each([
      "I need talk therapy for my anxiety about cancer",
      "cognitive therapy for depression after diagnosis",
      "grief therapy after losing my mother to cancer",
    ])("mental health qualifier DOES classify as PSYCHOSOCIAL: %s", (text) => {
      const result = classifyFastPath(text);
      expect(result?.category).toBe("PSYCHOSOCIAL");
    });
  });
});
