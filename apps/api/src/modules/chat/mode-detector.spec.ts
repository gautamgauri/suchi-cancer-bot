import { ModeDetector } from "./mode-detector";

describe("ModeDetector - identify questions", () => {
  describe("detectMode", () => {
    test("how to identify lymphoma -> EXPLAIN", () => {
      expect(ModeDetector.detectMode("how to identify lymphoma")).toBe("explain");
    });

    test("i want to identify if i have lymphoma -> NAVIGATE", () => {
      expect(ModeDetector.detectMode("i want to identify if i have lymphoma")).toBe("navigate");
    });

    test("signs of lymphoma -> EXPLAIN", () => {
      expect(ModeDetector.detectMode("signs of lymphoma")).toBe("explain");
    });

    test("how do I know if I have lymphoma -> NAVIGATE (personal)", () => {
      expect(ModeDetector.detectMode("how do I know if I have lymphoma")).toBe("navigate");
    });

    test("how to detect breast cancer -> EXPLAIN", () => {
      expect(ModeDetector.detectMode("how to detect breast cancer")).toBe("explain");
    });

    // Issue #117 — live prod repro (web and WhatsApp): this awareness question
    // was routed to NAVIGATE and answered with "I can't list symptoms".
    test("early warning signs + 'I want to know what to look for' -> EXPLAIN", () => {
      expect(
        ModeDetector.detectMode("What are the early warning signs of breast cancer? I want to know what to look for."),
      ).toBe("explain");
    });

    test("signs of cancer + a real personal report still -> NAVIGATE", () => {
      expect(ModeDetector.detectMode("what are the signs of breast cancer? I have found a lump")).toBe("navigate");
    });

    test("can I identify if my mother has cancer -> NAVIGATE (personal reference)", () => {
      expect(ModeDetector.detectMode("can I identify if my mother has cancer")).toBe("navigate");
    });
  });

  describe("hasPersonalDiagnosisSignal", () => {
    test("detects first-person pronouns", () => {
      expect(ModeDetector.hasPersonalDiagnosisSignal("I think I have a lump")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("my symptoms")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("me personally")).toBe(true);
    });

    // Issue #117: "I want to know what to look for" is informational framing,
    // not a personal symptom report. The bare "I" must not flip an awareness
    // question into Navigate mode (which soft-redirects with no KB content).
    test("informational framing with a first-person verb is NOT a personal signal", () => {
      expect(ModeDetector.hasPersonalDiagnosisSignal("I want to know")).toBe(false);
      expect(ModeDetector.hasPersonalDiagnosisSignal("I would like to learn about the signs")).toBe(false);
      expect(ModeDetector.hasPersonalDiagnosisSignal("please tell me the warning signs")).toBe(false);
      expect(ModeDetector.hasPersonalDiagnosisSignal("can you explain to me how it is detected")).toBe(false);
    });

    test("informational framing does not mask a real personal signal", () => {
      expect(ModeDetector.hasPersonalDiagnosisSignal("I want to know if my lump is cancer")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("tell me what to do, I have a lump")).toBe(true);
      // Codex review on #119: a bare "help me" can be the only personal signal.
      expect(ModeDetector.hasPersonalDiagnosisSignal("how can you tell if cancer treatment will help me?")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("help me understand the warning signs")).toBe(false);
    });

    test("detects second-person direct questions", () => {
      expect(ModeDetector.hasPersonalDiagnosisSignal("do I have")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("can I tell")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("should I check")).toBe(true);
    });

    test("detects someone-specific references", () => {
      expect(ModeDetector.hasPersonalDiagnosisSignal("my mother has")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("my father")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("he has symptoms")).toBe(true);
    });

    test("detects symptom framing", () => {
      expect(ModeDetector.hasPersonalDiagnosisSignal("I have been experiencing")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("I feel pain")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("suffering from")).toBe(true);
    });

    test("does not detect general questions", () => {
      expect(ModeDetector.hasPersonalDiagnosisSignal("how to identify lymphoma")).toBe(false);
      expect(ModeDetector.hasPersonalDiagnosisSignal("what are the signs")).toBe(false);
      expect(ModeDetector.hasPersonalDiagnosisSignal("general information")).toBe(false);
    });
  });

  // Romanized Hindi / Hinglish — recovered WIP. Personal-concern wording in Latin
  // script must read as Navigate (personal) just like its Devanagari equivalent.
  describe("detectMode — Romanized Hindi / Hinglish", () => {
    test("personal pronoun: 'mujhe dard ho raha hai' -> NAVIGATE", () => {
      expect(ModeDetector.detectMode("mujhe dard ho raha hai")).toBe("navigate");
    });

    test("possessive: 'meri report aayi hai' -> NAVIGATE", () => {
      expect(ModeDetector.detectMode("meri report aayi hai")).toBe("navigate");
    });

    test("family framing: 'mere papa ko cancer hai' -> NAVIGATE", () => {
      expect(ModeDetector.detectMode("mere papa ko cancer hai")).toBe("navigate");
    });

    test("symptom framing without pronoun: 'pet mein dard ho raha hai' -> NAVIGATE", () => {
      expect(ModeDetector.detectMode("pet mein dard ho raha hai")).toBe("navigate");
    });

    test("spacing variant: 'mujhe   gaanth   hai' -> NAVIGATE", () => {
      expect(ModeDetector.detectMode("mujhe   gaanth   hai")).toBe("navigate");
    });

    test("mixed English-Hindi: 'mujhe lump feel ho raha hai' -> NAVIGATE", () => {
      expect(ModeDetector.detectMode("mujhe lump feel ho raha hai")).toBe("navigate");
    });

    test("typo variant: 'mujhko khansi or bukhar hai' -> NAVIGATE", () => {
      expect(ModeDetector.detectMode("mujhko khansi or bukhar hai")).toBe("navigate");
    });

    test("general Hinglish question (no personal framing) -> EXPLAIN", () => {
      // "what are the symptoms of cancer" in Hinglish, no mujhe/mera/family
      expect(ModeDetector.detectMode("cancer ke lakshan kya hote hain")).toBe("explain");
    });
  });
});











