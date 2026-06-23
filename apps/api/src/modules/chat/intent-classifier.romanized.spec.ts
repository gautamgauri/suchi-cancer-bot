import { IntentClassifier } from "./intent-classifier";
import { AbstentionService } from "../abstention/abstention.service";
import { EvidenceChunk, EvidenceGateResult } from "../evidence/evidence-gate.service";

/**
 * Romanized Hindi / Hinglish detection (recovered WIP).
 *
 * A user writing symptoms in Latin-script Hindi ("mujhe pet mein dard ho raha
 * hai") must be classified the same as the Devanagari/English equivalents:
 *  - personal framing -> PERSONAL_SYMPTOMS (Navigate mode)
 *  - general framing   -> INFORMATIONAL_SYMPTOMS (Explain mode)
 *
 * Kept in a separate spec with its own setup so it is independent of the other
 * intent-classifier suites / branches.
 */
describe("IntentClassifier - Romanized Hindi / Hinglish symptoms", () => {
  let classifier: IntentClassifier;

  beforeEach(() => {
    const mockAbstention = {
      hasUrgencyIndicators: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<AbstentionService>;
    classifier = new IntentClassifier(mockAbstention);
  });

  const chunks: EvidenceChunk[] = [];
  const gate: EvidenceGateResult = {
    status: "ok",
    approvedChunks: [],
    reasonCode: null,
    shouldAbstain: false,
    confidence: "medium",
    quality: "weak",
  };
  const run = (text: string) => classifier.classify(text, chunks, gate, "normal").intent;

  describe("personal framing -> PERSONAL_SYMPTOMS", () => {
    test("mujhe pet mein dard ho raha hai", () => {
      expect(run("mujhe pet mein dard ho raha hai")).toBe("PERSONAL_SYMPTOMS");
    });

    test("mujhe gaanth hai (lump)", () => {
      expect(run("mujhe gaanth hai")).toBe("PERSONAL_SYMPTOMS");
    });

    test("family framing: mere papa ko khoon aa raha hai", () => {
      expect(run("mere papa ko khoon aa raha hai")).toBe("PERSONAL_SYMPTOMS");
    });

    test("typo/spacing variant: 'mujhko   bukhar he'", () => {
      expect(run("mujhko   bukhar he")).toBe("PERSONAL_SYMPTOMS");
    });

    test("mixed English-Hindi: 'mujhe lump feel ho raha hai'", () => {
      expect(run("mujhe lump feel ho raha hai")).toBe("PERSONAL_SYMPTOMS");
    });
  });

  describe("general framing -> INFORMATIONAL_SYMPTOMS", () => {
    test("dard aur khansi ki bimari (no personal pronoun)", () => {
      expect(run("dard aur khansi ki bimari")).toBe("INFORMATIONAL_SYMPTOMS");
    });
  });
});
