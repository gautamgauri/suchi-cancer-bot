import { IntentClassifier } from "./intent-classifier";
import { AbstentionService } from "../abstention/abstention.service";
import { EvidenceChunk, EvidenceGateResult } from "../evidence/evidence-gate.service";

describe("IntentClassifier - identify questions", () => {
  let classifier: IntentClassifier;
  let mockAbstention: jest.Mocked<AbstentionService>;

  beforeEach(() => {
    mockAbstention = {
      hasUrgencyIndicators: jest.fn().mockReturnValue(false),
    } as any;
    classifier = new IntentClassifier(mockAbstention);
  });

  const mockEvidenceChunks: EvidenceChunk[] = [];
  const mockGateResult: EvidenceGateResult = {
    shouldAbstain: false,
    confidence: "medium",
    quality: "weak"
  };

  test("how to identify lymphoma -> INFORMATIONAL_GENERAL", () => {
    const result = classifier.classify(
      "how to identify lymphoma",
      mockEvidenceChunks,
      mockGateResult,
      "normal"
    );
    expect(result.intent).toBe("INFORMATIONAL_GENERAL");
    expect(result.confidence).toBe("medium");
  });

  test("i want to identify if i have lymphoma -> PERSONAL_SYMPTOMS", () => {
    const result = classifier.classify(
      "i want to identify if i have lymphoma",
      mockEvidenceChunks,
      mockGateResult,
      "normal"
    );
    expect(result.intent).toBe("PERSONAL_SYMPTOMS");
    expect(result.confidence).toBe("medium");
  });

  test("how to detect breast cancer -> INFORMATIONAL_GENERAL", () => {
    const result = classifier.classify(
      "how to detect breast cancer",
      mockEvidenceChunks,
      mockGateResult,
      "normal"
    );
    expect(result.intent).toBe("INFORMATIONAL_GENERAL");
    expect(result.confidence).toBe("medium");
  });

  test("signs of lymphoma -> INFORMATIONAL_GENERAL", () => {
    const result = classifier.classify(
      "signs of lymphoma",
      mockEvidenceChunks,
      mockGateResult,
      "normal"
    );
    expect(result.intent).toBe("INFORMATIONAL_GENERAL");
    expect(result.confidence).toBe("medium");
  });

  test("how do I know if I have cancer -> PERSONAL_SYMPTOMS", () => {
    const result = classifier.classify(
      "how do I know if I have cancer",
      mockEvidenceChunks,
      mockGateResult,
      "normal"
    );
    expect(result.intent).toBe("PERSONAL_SYMPTOMS");
    expect(result.confidence).toBe("medium");
  });
});











