import { evaluateEmergencyFastPath, _testExports } from "./emergency-fast-path";

describe("EmergencyFastPath", () => {
  describe("Critical emergencies (English)", () => {
    const criticalCases = [
      "I'm vomiting blood",
      "The bleeding won't stop",
      "Severe chest pain spreading to my left arm",
      "I can't breathe properly",
      "My mother has fainted and is unconscious",
      "He's having a seizure",
      "She's coughing up blood",
      "There's blood in his stool",
      "She collapsed during chemo",
      "I think it's a heart attack",
      "severe allergic reaction to the medicine",
    ];

    test.each(criticalCases)("detects critical: %s", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("critical");
      expect(result.responseText).toContain("112");
      expect(result.responseText).toContain("108");
      expect(result.confidence).toBe(1.0);
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
    });
  });

  describe("Critical emergencies (Hindi)", () => {
    const hindiCases = [
      "खून बहुत आ रहा है",
      "खून रुक नहीं रहा",
      "खून की उल्टी हो रही है",
      "सांस नहीं आ रही",
      "दम घुट रहा है",
      "छाती में बहुत तेज दर्द",
      "बेहोश हो गया है",
      "दौरा पड़ रहा है",
    ];

    test.each(hindiCases)("detects critical (Hindi): %s", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("critical");
    });
  });

  describe("Critical emergencies (Hinglish)", () => {
    const hinglishCases = [
      "khoon bahut aa raha hai",
      "khoon ruk nahi raha",
      "saans nahi aa raha",
      "behosh ho gaya hai",
      "seene mein bahut tez dard",
    ];

    test.each(hinglishCases)("detects critical (Hinglish): %s", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("critical");
    });
  });

  describe("Urgent situations", () => {
    const urgentCases = [
      "fever above 102 and on chemo",
      "severe headache that won't go away",
      "severe dehydration from vomiting",
      "I think I have a blood clot in my leg",
      "sudden vision loss in one eye",
    ];

    test.each(urgentCases)("detects urgent: %s", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("urgent");
      expect(result.responseText).toContain("108");
    });
  });

  describe("Non-emergencies (should pass through)", () => {
    const normalCases = [
      "What are the symptoms of breast cancer?",
      "How does chemotherapy work?",
      "Which hospital in Patna is best for cancer treatment?",
      "I feel tired after my last chemo session",
      "What is staging in cancer?",
      "My father was diagnosed with lung cancer last week",
      "How do I apply for Ayushman Bharat?",
      "What are the side effects of radiation?",
      "When should I get a mammogram?",
      "I'm worried about my test results",
      "Hello",
      "",
    ];

    test.each(normalCases)("does NOT flag: %s", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(false);
      expect(result.severity).toBe("none");
      expect(result.responseText).toBeNull();
    });
  });

  describe("Response content quality", () => {
    test("critical response includes India emergency numbers", () => {
      const result = evaluateEmergencyFastPath("uncontrolled bleeding");
      expect(result.responseText).toContain("112");
      expect(result.responseText).toContain("108");
      expect(result.responseText).toContain("102");
      expect(result.responseText).toContain("Aadhaar");
      expect(result.responseText).toContain("Ayushman");
    });

    test("urgent response includes care team contact guidance", () => {
      const result = evaluateEmergencyFastPath("severe pain in my abdomen");
      expect(result.responseText).toContain("oncologist");
      expect(result.responseText).toContain("108");
      expect(result.responseText).toContain("Emergency immediately if");
    });
  });

  describe("Performance", () => {
    test("non-match completes in < 5ms", () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        evaluateEmergencyFastPath("What are the symptoms of breast cancer?");
      }
      const elapsed = performance.now() - start;
      // 100 iterations in < 50ms means each < 0.5ms
      expect(elapsed).toBeLessThan(50);
    });

    test("match completes in < 5ms", () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        evaluateEmergencyFastPath("uncontrolled bleeding won't stop");
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("Pattern coverage", () => {
    test("has sufficient critical patterns", () => {
      expect(_testExports.CRITICAL_PATTERNS.length).toBeGreaterThanOrEqual(30);
    });

    test("has sufficient urgent patterns", () => {
      expect(_testExports.URGENT_PATTERNS.length).toBeGreaterThanOrEqual(10);
    });
  });

  // FR-CHAT-003 / NFR-PERF-002 — each call < 1ms (sub-1ms budget)
  describe("Per-call timing < 1ms (FR-CHAT-003)", () => {
    test("non-emergency completes in < 1ms", () => {
      const start = performance.now();
      evaluateEmergencyFastPath("what are the side effects of chemotherapy");
      expect(performance.now() - start).toBeLessThan(1);
    });

    test("emergency match completes in < 1ms", () => {
      const start = performance.now();
      evaluateEmergencyFastPath("severe chest pain spreading to left arm");
      expect(performance.now() - start).toBeLessThan(1);
    });
  });

  // FR-SAFETY-002 — function is synchronous; no DB or LLM calls possible
  describe("Synchronous guarantee — no async calls (FR-SAFETY-002)", () => {
    test("return value is not a Promise", () => {
      const result = evaluateEmergencyFastPath("uncontrolled bleeding");
      // A Promise has a .then method; a plain object does not
      expect(typeof (result as any).then).toBe("undefined");
    });
  });
});
