/**
 * Parity tests for RetrievalConfig.
 *
 * Verifies that:
 * 1. BASELINE_RETRIEVAL_CONFIG values match the hardcoded constants
 *    in the production codebase.
 * 2. Config utility functions work correctly.
 * 3. Config-driven confidence and reranker gating produce identical
 *    results to the hardcoded implementations.
 */
import {
  BASELINE_RETRIEVAL_CONFIG,
  RetrievalConfig,
  mergeRetrievalConfig,
  diffRetrievalConfig,
  configHash,
  buildTierBoostMap,
  KNOB_METADATA,
} from "./retrieval-config";
import { computeRetrievalConfidenceWithConfig, shouldRerankWithConfig } from "./config-adapters";
import { computeRetrievalConfidence } from "../proposal/utils/retrieval-confidence";

describe("RetrievalConfig", () => {
  // -----------------------------------------------------------------------
  // Step 1: Baseline matches production hardcoded values
  // -----------------------------------------------------------------------

  describe("BASELINE_RETRIEVAL_CONFIG parity", () => {
    it("should have RRF_K = 60 (proposal.service.ts:494)", () => {
      expect(BASELINE_RETRIEVAL_CONFIG.rrfK).toBe(60);
    });

    it("should have MULTI_QUERY_BOOST = 0.15 (proposal.service.ts:495)", () => {
      expect(BASELINE_RETRIEVAL_CONFIG.multiQueryBoost).toBe(0.15);
    });

    it("should have fusedScoreWeightSimilarity = 0.6 (proposal.service.ts:549)", () => {
      expect(BASELINE_RETRIEVAL_CONFIG.fusedScoreWeightSimilarity).toBe(0.6);
    });

    it("should have tier boost A=1.30, B=1.10, C=1.00, X=0.90 (proposal.service.ts:509)", () => {
      expect(BASELINE_RETRIEVAL_CONFIG.tierBoostA).toBe(1.30);
      expect(BASELINE_RETRIEVAL_CONFIG.tierBoostB).toBe(1.10);
      expect(BASELINE_RETRIEVAL_CONFIG.tierBoostC).toBe(1.00);
      expect(BASELINE_RETRIEVAL_CONFIG.tierBoostX).toBe(0.90);
    });

    it("should have confidence thresholds matching retrieval-confidence.ts:16-21", () => {
      expect(BASELINE_RETRIEVAL_CONFIG.confidenceMinAvgScore).toBe(0.35);
      expect(BASELINE_RETRIEVAL_CONFIG.confidenceHighAvgScore).toBe(0.50);
      expect(BASELINE_RETRIEVAL_CONFIG.confidenceMinChunks).toBe(3);
      expect(BASELINE_RETRIEVAL_CONFIG.confidenceMinDocs).toBe(2);
    });

    it("should have reranker thresholds matching reranker.service.ts:186-191", () => {
      expect(BASELINE_RETRIEVAL_CONFIG.rerankerGapThreshold1vs3).toBe(0.04);
      expect(BASELINE_RETRIEVAL_CONFIG.rerankerGapThreshold1vs6).toBe(0.07);
      expect(BASELINE_RETRIEVAL_CONFIG.rerankerWeakTopThreshold).toBe(0.50);
    });

    it("should have query expansion limits matching query-expander.service.ts", () => {
      expect(BASELINE_RETRIEVAL_CONFIG.maxSynonymsPerTerm).toBe(2);
      expect(BASELINE_RETRIEVAL_CONFIG.maxExpandedCandidates).toBe(3);
      expect(BASELINE_RETRIEVAL_CONFIG.queryCharLimit).toBe(500);
    });

    it("should have chunk limits matching proposal.service.ts", () => {
      expect(BASELINE_RETRIEVAL_CONFIG.finalChunkLimit).toBe(12);
      expect(BASELINE_RETRIEVAL_CONFIG.maxChunksPerDoc).toBe(4);
      expect(BASELINE_RETRIEVAL_CONFIG.overselectCap).toBe(20);
      expect(BASELINE_RETRIEVAL_CONFIG.minScoreThreshold).toBe(0.25);
      expect(BASELINE_RETRIEVAL_CONFIG.retryMinScoreThreshold).toBe(0.20);
      expect(BASELINE_RETRIEVAL_CONFIG.maxQueriesPerSection).toBe(8);
      expect(BASELINE_RETRIEVAL_CONFIG.retrievalLimitPerQuery).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // Step 2: Config utility functions
  // -----------------------------------------------------------------------

  describe("mergeRetrievalConfig", () => {
    it("should override only specified keys", () => {
      const merged = mergeRetrievalConfig(BASELINE_RETRIEVAL_CONFIG, { rrfK: 45 });
      expect(merged.rrfK).toBe(45);
      expect(merged.multiQueryBoost).toBe(0.15);
      expect(merged.tierBoostA).toBe(1.30);
    });

    it("should return a new object (not mutate baseline)", () => {
      const merged = mergeRetrievalConfig(BASELINE_RETRIEVAL_CONFIG, { rrfK: 45 });
      expect(BASELINE_RETRIEVAL_CONFIG.rrfK).toBe(60);
      expect(merged).not.toBe(BASELINE_RETRIEVAL_CONFIG);
    });
  });

  describe("diffRetrievalConfig", () => {
    it("should return empty diff for identical configs", () => {
      const diff = diffRetrievalConfig(BASELINE_RETRIEVAL_CONFIG, { ...BASELINE_RETRIEVAL_CONFIG });
      expect(Object.keys(diff)).toHaveLength(0);
    });

    it("should return only changed keys", () => {
      const variant = { ...BASELINE_RETRIEVAL_CONFIG, rrfK: 45, tierBoostA: 1.50 };
      const diff = diffRetrievalConfig(BASELINE_RETRIEVAL_CONFIG, variant);
      expect(diff).toEqual({ rrfK: 45, tierBoostA: 1.50 });
    });
  });

  describe("configHash", () => {
    it("should produce deterministic hash", () => {
      const h1 = configHash(BASELINE_RETRIEVAL_CONFIG);
      const h2 = configHash({ ...BASELINE_RETRIEVAL_CONFIG });
      expect(h1).toBe(h2);
    });

    it("should produce different hash for different configs", () => {
      const h1 = configHash(BASELINE_RETRIEVAL_CONFIG);
      const h2 = configHash({ ...BASELINE_RETRIEVAL_CONFIG, rrfK: 45 });
      expect(h1).not.toBe(h2);
    });

    it("should be 16 chars hex", () => {
      const h = configHash(BASELINE_RETRIEVAL_CONFIG);
      expect(h).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("buildTierBoostMap", () => {
    it("should match production TIER_BOOST_MAP", () => {
      const map = buildTierBoostMap(BASELINE_RETRIEVAL_CONFIG);
      expect(map).toEqual({ A: 1.30, B: 1.10, C: 1.00, X: 0.90 });
    });
  });

  // -----------------------------------------------------------------------
  // Step 3: Config-driven confidence parity
  // -----------------------------------------------------------------------

  describe("computeRetrievalConfidenceWithConfig parity", () => {
    const testCases = [
      {
        name: "high confidence (score 0.6, 5 chunks, 3 docs)",
        chunks: [
          { score: 0.60, docId: "d1" },
          { score: 0.55, docId: "d2" },
          { score: 0.52, docId: "d3" },
          { score: 0.50, docId: "d1" },
          { score: 0.48, docId: "d2" },
        ],
      },
      {
        name: "medium confidence (score 0.40, 3 chunks, 2 docs)",
        chunks: [
          { score: 0.45, docId: "d1" },
          { score: 0.40, docId: "d2" },
          { score: 0.35, docId: "d1" },
        ],
      },
      {
        name: "low confidence (score 0.20, 2 chunks, 1 doc)",
        chunks: [
          { score: 0.22, docId: "d1" },
          { score: 0.18, docId: "d1" },
        ],
      },
      {
        name: "empty chunks",
        chunks: [],
      },
      {
        name: "single chunk high score",
        chunks: [{ score: 0.90, docId: "d1" }],
      },
    ];

    for (const tc of testCases) {
      it(`should match original for: ${tc.name}`, () => {
        const original = computeRetrievalConfidence(tc.chunks, "budget");
        const configDriven = computeRetrievalConfidenceWithConfig(
          tc.chunks,
          "budget",
          BASELINE_RETRIEVAL_CONFIG,
        );
        expect(configDriven.level).toBe(original.level);
        expect(configDriven.avgScore).toBeCloseTo(original.avgScore, 6);
        expect(configDriven.chunkCount).toBe(original.chunkCount);
        expect(configDriven.uniqueDocCount).toBe(original.uniqueDocCount);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Step 4: Config-driven reranker gating parity
  // -----------------------------------------------------------------------

  describe("shouldRerankWithConfig parity", () => {
    it("should always rerank budget sections", () => {
      const result = shouldRerankWithConfig("budget", [{ score: 0.9 }], BASELINE_RETRIEVAL_CONFIG);
      expect(result.shouldRerank).toBe(true);
    });

    it("should skip team sections", () => {
      const result = shouldRerankWithConfig("team", [{ score: 0.9 }], BASELINE_RETRIEVAL_CONFIG);
      expect(result.shouldRerank).toBe(false);
    });

    it("should trigger on score ambiguity (tight gap3)", () => {
      const chunks = [
        { score: 0.50 },
        { score: 0.49 },
        { score: 0.48 }, // gap3 = 0.02 < 0.04
      ];
      const result = shouldRerankWithConfig("activities", chunks, BASELINE_RETRIEVAL_CONFIG);
      expect(result.shouldRerank).toBe(true);
    });

    it("should trigger on weak top result", () => {
      const chunks = [{ score: 0.40 }]; // < 0.50
      const result = shouldRerankWithConfig("activities", chunks, BASELINE_RETRIEVAL_CONFIG);
      expect(result.shouldRerank).toBe(true);
    });

    it("should not trigger on clear separation", () => {
      const chunks = [
        { score: 0.80 },
        { score: 0.60 },
        { score: 0.40 }, // gap3 = 0.40 > 0.04, h1=0.80 > 0.50
      ];
      const result = shouldRerankWithConfig("activities", chunks, BASELINE_RETRIEVAL_CONFIG);
      expect(result.shouldRerank).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Knob metadata completeness
  // -----------------------------------------------------------------------

  describe("KNOB_METADATA", () => {
    it("should have metadata for every RetrievalConfig key", () => {
      const configKeys = Object.keys(BASELINE_RETRIEVAL_CONFIG);
      const metadataKeys = Object.keys(KNOB_METADATA);
      expect(metadataKeys.sort()).toEqual(configKeys.sort());
    });

    it("should classify cost knobs without sweepRange", () => {
      const costKnobs = Object.entries(KNOB_METADATA)
        .filter(([, m]) => m.class === "cost");
      for (const [key, meta] of costKnobs) {
        expect(meta.sweepRange).toBeUndefined();
      }
    });
  });
});
