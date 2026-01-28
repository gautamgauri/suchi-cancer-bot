import { EmpathyDetector } from "./empathy-detector";

describe("EmpathyDetector", () => {
  let detector: EmpathyDetector;

  beforeEach(() => {
    detector = new EmpathyDetector();
  });

  describe("detectMentalHealthNeed", () => {
    describe("crisis detection", () => {
      it("should detect suicidal ideation as crisis", () => {
        const result = detector.detectMentalHealthNeed("I don't want to live anymore");
        expect(result.isCrisis).toBe(true);
        expect(result.needsSupport).toBe(true);
        expect(result.category).toBe("crisis");
      });

      it("should detect 'want to die' as crisis", () => {
        const result = detector.detectMentalHealthNeed("I just want to die");
        expect(result.isCrisis).toBe(true);
        expect(result.category).toBe("crisis");
      });

      it("should detect self-harm mentions as crisis", () => {
        const result = detector.detectMentalHealthNeed("I've been thinking about harming myself");
        expect(result.isCrisis).toBe(true);
        expect(result.category).toBe("crisis");
      });

      it("should detect 'no point in living' as crisis", () => {
        const result = detector.detectMentalHealthNeed("There's no point in living with this diagnosis");
        expect(result.isCrisis).toBe(true);
        expect(result.category).toBe("crisis");
      });
    });

    describe("isolation detection", () => {
      it("should detect isolation patterns", () => {
        const result = detector.detectMentalHealthNeed("I feel so alone in this cancer journey");
        expect(result.isCrisis).toBe(false);
        expect(result.needsSupport).toBe(true);
        expect(result.category).toBe("isolation");
      });

      it("should detect 'no one understands'", () => {
        const result = detector.detectMentalHealthNeed("No one understands what I'm going through");
        expect(result.needsSupport).toBe(true);
        expect(result.category).toBe("isolation");
      });

      it("should detect feeling like a burden", () => {
        const result = detector.detectMentalHealthNeed("I feel like a burden to my family");
        expect(result.needsSupport).toBe(true);
        expect(result.category).toBe("isolation");
      });
    });

    describe("depression detection", () => {
      it("should detect depression patterns", () => {
        const result = detector.detectMentalHealthNeed("I've been feeling really depressed since my diagnosis");
        expect(result.isCrisis).toBe(false);
        expect(result.needsSupport).toBe(true);
        expect(result.category).toBe("depression");
      });

      it("should detect hopelessness", () => {
        const result = detector.detectMentalHealthNeed("I feel completely hopeless about my situation");
        expect(result.needsSupport).toBe(true);
        expect(result.category).toBe("depression");
      });

      it("should detect 'can't cope'", () => {
        const result = detector.detectMentalHealthNeed("I can't cope with this anymore");
        expect(result.needsSupport).toBe(true);
        expect(result.category).toBe("depression");
      });
    });

    describe("support-seeking detection", () => {
      it("should detect support group requests", () => {
        const result = detector.detectMentalHealthNeed("Are there any cancer support groups I can join?");
        expect(result.needsSupport).toBe(true);
        expect(result.category).toBe("support-seeking");
      });

      it("should detect therapy/counselor requests", () => {
        const result = detector.detectMentalHealthNeed("I think I need to see a therapist");
        expect(result.needsSupport).toBe(true);
        expect(result.category).toBe("support-seeking");
      });

      it("should detect 'need someone to talk to'", () => {
        const result = detector.detectMentalHealthNeed("I just need someone to talk to about all this");
        expect(result.needsSupport).toBe(true);
        // Could be either depression or support-seeking depending on context
        expect(["depression", "support-seeking"]).toContain(result.category);
      });
    });

    describe("no mental health need", () => {
      it("should not flag general cancer questions", () => {
        const result = detector.detectMentalHealthNeed("What are the symptoms of breast cancer?");
        expect(result.needsSupport).toBe(false);
        expect(result.isCrisis).toBe(false);
        expect(result.category).toBeNull();
      });

      it("should not flag treatment questions", () => {
        const result = detector.detectMentalHealthNeed("What are the side effects of chemotherapy?");
        expect(result.needsSupport).toBe(false);
        expect(result.isCrisis).toBe(false);
      });

      it("should not flag normal greetings", () => {
        const result = detector.detectMentalHealthNeed("Hello, how can you help me?");
        expect(result.needsSupport).toBe(false);
        expect(result.isCrisis).toBe(false);
      });
    });
  });

  describe("detectEmotionalTone", () => {
    it("should detect anxious tone", async () => {
      const result = await detector.detectEmotionalTone("I'm really scared about my test results");
      expect(result.tone).toBe("anxious");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should detect sad tone", async () => {
      const result = await detector.detectEmotionalTone("My mother passed away from cancer");
      expect(result.tone).toBe("sad");
    });

    it("should detect urgent tone", async () => {
      const result = await detector.detectEmotionalTone("I just found out I have cancer and need help now");
      expect(result.tone).toBe("urgent");
    });

    it("should detect calm/neutral tone", async () => {
      const result = await detector.detectEmotionalTone("I'm just curious about cancer prevention");
      expect(["calm", "neutral"]).toContain(result.tone);
    });

    it("should detect caregiver context", async () => {
      const result = await detector.detectEmotionalTone("My mother was just diagnosed with lung cancer");
      expect(result.keywords).toContain("caregiver");
    });
  });
});
