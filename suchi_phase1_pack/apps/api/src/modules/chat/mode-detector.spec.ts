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

    test("can I identify if my mother has cancer -> NAVIGATE (personal reference)", () => {
      expect(ModeDetector.detectMode("can I identify if my mother has cancer")).toBe("navigate");
    });
  });

  describe("hasPersonalDiagnosisSignal", () => {
    test("detects first-person pronouns", () => {
      expect(ModeDetector.hasPersonalDiagnosisSignal("I want to know")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("my symptoms")).toBe(true);
      expect(ModeDetector.hasPersonalDiagnosisSignal("me personally")).toBe(true);
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
});











