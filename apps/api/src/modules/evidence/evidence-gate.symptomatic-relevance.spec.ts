/**
 * Issue #53 — a SYMPTOMATIC_PATIENT query with no topically usable evidence
 * must not produce an ungrounded medical explanation.
 *
 * RQ-LUNG-02 ("persistent cough for 8 weeks") exposed the runtime gap: a total
 * retrieval miss still yielded a confident medical answer. The mechanism was
 * not that the gate lacked a relevance floor, but that source priority skipped
 * it — `adjustedThresholds` collapses to {1,1} whenever any Tier-1 chunk is
 * present, so `isVeryWeak` is false for any non-empty chunk set and the score
 * is never consulted.
 *
 * The invariant asserted here is about SAFE BEHAVIOUR WHEN GROUNDING IS
 * UNAVAILABLE. It is deliberately separate from whether retrieval works for
 * this query, which is a retrieval-quality question and is covered by the
 * RQ-LUNG-02 eval fixture instead. Improving retrieval must not be able to make
 * this test vacuous.
 */

import { EvidenceGateService, EvidenceChunk } from "./evidence-gate.service";
import { PrismaService } from "../prisma/prisma.service";

function chunk(
  id: string,
  similarity: number,
  sourceType = "02_nci_core",
  docId = "doc1"
): EvidenceChunk {
  return {
    chunkId: id,
    docId,
    content: "Some passage text.",
    document: {
      title: "NCI PDQ",
      sourceType,
      source: "NCI",
      citation: null,
      isTrustedSource: true,
    },
    similarity,
  } as EvidenceChunk;
}

describe("evidence gate — symptomatic relevance floor (issue #53)", () => {
  let service: EvidenceGateService;

  beforeEach(() => {
    service = new EvidenceGateService({} as jest.Mocked<PrismaService>);
  });

  const SYMPTOM_QUERY = "I've had a persistent cough for 8 weeks. What should I do?";

  describe("source prestige cannot rescue poor topical relevance", () => {
    it("abstains when Tier-1 chunks are topically irrelevant", async () => {
      // The exact shape that used to slip through: authoritative source,
      // relevance far below the floor.
      const result = await service.validateEvidence(
        [chunk("c1", 0.08), chunk("c2", 0.11, "02_nci_core", "doc2")],
        "symptoms",
        SYMPTOM_QUERY
      );

      expect(result.status).toBe("insufficient");
      expect(result.shouldAbstain).toBe(true);
      expect(result.reasonCode).toBe("LOW_RELEVANCE_SYMPTOMATIC");
      expect(result.approvedChunks).toHaveLength(0);
    });

    it("abstains even when a SINGLE Tier-1 chunk is present", async () => {
      // {1,1} threshold relaxation previously made isVeryWeak false here.
      const result = await service.validateEvidence(
        [chunk("c1", 0.05)],
        "symptoms",
        SYMPTOM_QUERY
      );

      expect(result.shouldAbstain).toBe(true);
      expect(result.reasonCode).toBe("LOW_RELEVANCE_SYMPTOMATIC");
    });

    it("approves no chunks, so nothing is available to fabricate citations from", async () => {
      const result = await service.validateEvidence(
        [chunk("c1", 0.05), chunk("c2", 0.07)],
        "symptoms",
        SYMPTOM_QUERY
      );

      // The acceptance criterion in #53: the response abstains rather than
      // citing something irrelevant to look grounded.
      expect(result.approvedChunks).toEqual([]);
    });
  });

  describe("weak-but-relevant is still usable", () => {
    it("one relevant authoritative passage still supports a bounded answer", async () => {
      // Weak because there is only ONE passage — not because relevance is poor.
      const result = await service.validateEvidence(
        [chunk("c1", 0.62)],
        "symptoms",
        SYMPTOM_QUERY
      );

      expect(result.shouldAbstain).toBe(false);
      expect(result.reasonCode).not.toBe("LOW_RELEVANCE_SYMPTOMATIC");
    });

    it("relevance at the floor is not blocked", async () => {
      const result = await service.validateEvidence(
        [chunk("c1", 0.3), chunk("c2", 0.3)],
        "symptoms",
        SYMPTOM_QUERY
      );

      expect(result.reasonCode).not.toBe("LOW_RELEVANCE_SYMPTOMATIC");
    });
  });

  describe("only the symptomatic path changes", () => {
    it.each(["general", "prevention", "screening", "treatment", "sideEffects"] as const)(
      "%s keeps the existing Safe + Useful behaviour with weak Tier-1 evidence",
      async (queryType) => {
        const result = await service.validateEvidence(
          [chunk("c1", 0.05)],
          queryType,
          "tell me about cancer"
        );

        expect(result.reasonCode).not.toBe("LOW_RELEVANCE_SYMPTOMATIC");
      }
    );
  });
});
