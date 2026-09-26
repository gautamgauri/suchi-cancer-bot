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
    status: "ok",
    approvedChunks: [],
    reasonCode: null,
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

  test("signs of lymphoma -> INFORMATIONAL_SYMPTOMS", () => {
    // A general symptom-listing question ("signs of X") is more precisely
    // INFORMATIONAL_SYMPTOMS than INFORMATIONAL_GENERAL — it asks specifically
    // about symptoms/signs, not a broad overview.
    const result = classifier.classify(
      "signs of lymphoma",
      mockEvidenceChunks,
      mockGateResult,
      "normal"
    );
    expect(result.intent).toBe("INFORMATIONAL_SYMPTOMS");
    expect(result.confidence).toBe("high");
  });

  // Issue #184: the bare question answered from 6 KB chunks; the same question
  // with a trailing "I should look for" returned 0 chunks and 0 citations,
  // because it classified as PERSONAL_SYMPTOMS and the Navigate soft-redirect
  // branch in ChatService never calls RAG. Both phrasings must land on the same
  // intent, which is the intent that is served from the knowledge base.
  test("mouth cancer signs: trailing 'I should look for' keeps the KB-served intent", () => {
    const bare = classifier.classify(
      "What are the early signs of mouth cancer?",
      mockEvidenceChunks,
      mockGateResult,
      "normal"
    );
    const withClause = classifier.classify(
      "What are the early signs of mouth cancer I should look for?",
      mockEvidenceChunks,
      mockGateResult,
      "normal"
    );
    expect(bare.intent).toBe("INFORMATIONAL_SYMPTOMS");
    expect(withClause.intent).toBe(bare.intent);
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











