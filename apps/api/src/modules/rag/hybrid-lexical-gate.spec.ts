import { Logger } from "@nestjs/common";
import { RagService } from "./rag.service";
import { EvidenceChunk, EvidenceGateService, getGateScore } from "../evidence/evidence-gate.service";
import { KB_FTS_RANK_SATURATION, absoluteLexicalScore } from "./kb-fts.sql";

/**
 * The lexical arm's score reaches the evidence gate as an ABSOLUTE value.
 *
 * WHY: fullTextSearchWithMetadata normalised ts_rank_cd by the best rank in its
 * own result set, and hybridSearchWithMetadata passed that value on as `lexSim`.
 * The best lexical row was therefore always lexSim = 1.0 — also when it was an
 * off-topic chunk sharing two words with the question — and the gate
 * (max(vecSim, lexSim) > 0.7 = strong) graded the turn as strong evidence, so
 * query expansion and LOW_SCORE never ran.
 *
 * These tests drive the REAL hybrid merge (vector arm stubbed, lexical arm fed
 * raw SQL rows through the real mapping) into the REAL EvidenceGateService.
 * All chunk text is synthetic.
 */

type FtsRow = {
  id: string;
  docId: string;
  content: string;
  lexRank: number;
  title: string;
  url: string | null;
  sourceType: string | null;
  source: string | null;
  citation: string | null;
  lastReviewed: Date | null;
  isTrustedSource: boolean;
};

function doc(title: string, isTrustedSource = true) {
  return {
    title,
    sourceType: isTrustedSource ? "02_nci_core" : "unknown_blog",
    source: isTrustedSource ? "NCI" : "Blog",
    citation: null,
    lastReviewed: new Date(),
    isTrustedSource,
  };
}

function vectorChunk(id: string, vecSim: number, content: string, isTrustedSource = true): EvidenceChunk {
  return { chunkId: id, docId: `doc-${id}`, content, similarity: vecSim, document: doc(`Doc ${id}`, isTrustedSource) };
}

function ftsRow(id: string, lexRank: number, content: string, isTrustedSource = true): FtsRow {
  const d = doc(`Doc ${id}`, isTrustedSource);
  return { id, docId: `doc-${id}`, content, lexRank, url: null, ...d };
}

function ragWith(vector: EvidenceChunk[], fts: FtsRow[]): RagService {
  const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue(fts) } as any;
  const reranker = { isEnabled: () => false } as any;
  const ftsHealth = {
    shouldQuery: () => true,
    recordQuerySuccess: () => undefined,
    getHealth: () => ({ status: "ok" }),
  } as any;
  const rag = new RagService(prisma, {} as any, {} as any, {} as any, reranker, ftsHealth);
  jest.spyOn(rag as any, "vectorSearchWithMetadata").mockResolvedValue(vector);
  return rag;
}

async function hybrid(rag: RagService, query: string): Promise<EvidenceChunk[]> {
  return (rag as any).hybridSearchWithMetadata(query, 6, null, "INFORMATIONAL_GENERAL", "general");
}

/** The pre-fix lexSim: rank / best rank in this result set. */
function setRelative(rows: FtsRow[], row: FtsRow): number {
  return row.lexRank / Math.max(...rows.map((r) => r.lexRank), 0.01);
}

const QUERY = "painless lump near the armpit that appeared last month what should happen next";
const ON_TOPIC = "A new lump in the breast or armpit should be checked by a doctor within days.";
const OFF_TOPIC = "Swollen lymph nodes from an infection usually go down within a few weeks.";

describe("hybrid retrieval → evidence gate: lexical score is absolute", () => {
  const gate = new EvidenceGateService({} as any);

  beforeAll(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  it("absoluteLexicalScore is a fixed scale, independent of the other rows", () => {
    expect(absoluteLexicalScore(0)).toBe(0);
    expect(absoluteLexicalScore(undefined)).toBe(0);
    expect(absoluteLexicalScore(NaN)).toBe(0);
    expect(absoluteLexicalScore(-1)).toBe(0);
    expect(absoluteLexicalScore(KB_FTS_RANK_SATURATION / 2)).toBeCloseTo(0.5, 10);
    expect(absoluteLexicalScore(KB_FTS_RANK_SATURATION)).toBe(1);
    expect(absoluteLexicalScore(5)).toBe(1);
  });

  it("(a) a single off-topic lexical hit with low vecSim is no longer strong evidence", async () => {
    // Weak vector match; the only lexical row is an incidental two-word co-occurrence.
    const fts = [ftsRow("off", 0.04, OFF_TOPIC)];
    const rag = ragWith([vectorChunk("vec", 0.45, "General information about check-ups.")], fts);

    const chunks = await hybrid(rag, QUERY);
    const off = chunks.find((c) => c.chunkId === "off")!;

    // Pre-fix this chunk carried lexSim 1.0 (the best — only — lexical row).
    expect(setRelative(fts, fts[0])).toBe(1);
    expect(off.lexSim).toBeCloseTo(0.1, 10);
    expect(off.lexRank).toBe(0.04);
    // Ordering still uses the set-relative value: the hybrid score is unchanged.
    expect(off.similarity).toBeCloseTo(0.45 * 1, 10); // long query: wLex = 0.45, vecSim 0

    expect(gate.hasStrongMatches(chunks)).toBe(false);
    const result = await gate.validateEvidence(chunks, "general", QUERY);
    expect(result.quality).not.toBe("strong");
    expect(result.confidence).not.toBe("high");
    expect(result.quality).toBe("weak"); // → chat.service retries with retrieveWithExpansion
  });

  it("(a') FTS-only turn (vector arm failed) with only incidental lexical hits is not strong", async () => {
    const fts = [ftsRow("off1", 0.03, OFF_TOPIC), ftsRow("off2", 0.01, OFF_TOPIC)];
    const rag = ragWith([], fts);
    const chunks = await hybrid(rag, QUERY);

    expect(chunks.map((c) => getGateScore(c))).toEqual([
      expect.closeTo(0.075, 10),
      expect.closeTo(0.025, 10),
    ]);
    const result = await gate.validateEvidence(chunks, "general", QUERY);
    expect(result.quality).not.toBe("strong");
  });

  it("(b) a high-vecSim chunk is strong exactly as before", async () => {
    const rag = ragWith(
      [vectorChunk("vec", 0.78, ON_TOPIC)],
      [ftsRow("off", 0.02, OFF_TOPIC)],
    );
    const chunks = await hybrid(rag, QUERY);
    // Ordering is unchanged, so the incidental lexical row still ranks FIRST
    // (0.45 × set-relative 1.0 > 0.55 × 0.78). The gate must look past it.
    expect(chunks.map((c) => c.chunkId)).toEqual(["off", "vec"]);
    expect(getGateScore(chunks[0])).toBeCloseTo(0.05, 10);
    expect(gate.hasStrongMatches(chunks)).toBe(true);
    const result = await gate.validateEvidence(chunks, "general", QUERY);
    expect(result.quality).toBe("strong");
    expect(result.confidence).toBe("high");
  });

  it("(c) a genuinely strong lexical match with moderate vecSim is still strong", async () => {
    // Many query terms co-occurring tightly: raw ts_rank_cd 0.45 (PGlite measured
    // 0.26–0.51 for on-topic synthetic chunks).
    const rag = ragWith(
      [vectorChunk("both", 0.55, ON_TOPIC)],
      [ftsRow("both", 0.45, ON_TOPIC)],
    );
    const chunks = await hybrid(rag, QUERY);
    expect(chunks[0].chunkId).toBe("both");
    expect(chunks[0].vecSim).toBe(0.55);
    expect(chunks[0].lexSim).toBe(1);
    expect(gate.hasStrongMatches(chunks)).toBe(true);
    const result = await gate.validateEvidence(chunks, "general", QUERY);
    expect(result.quality).toBe("strong");
  });

  it("(d) an empty lexical arm behaves as before — the gate follows vecSim", async () => {
    const strong = await hybrid(ragWith([vectorChunk("vec", 0.73, ON_TOPIC)], []), QUERY);
    expect(strong[0].lexSim).toBe(0);
    expect(strong[0].lexRank).toBe(0);
    expect((await gate.validateEvidence(strong, "general", QUERY)).quality).toBe("strong");

    const weak = await hybrid(ragWith([vectorChunk("vec", 0.45, ON_TOPIC)], []), QUERY);
    expect(gate.hasStrongMatches(weak)).toBe(false);
    expect((await gate.validateEvidence(weak, "general", QUERY)).quality).toBe("weak");
  });

  it("does not change hybrid ORDERING: finalScore still blends the set-relative lexical value", async () => {
    const fts = [ftsRow("lexTop", 0.08, OFF_TOPIC), ftsRow("lexLow", 0.02, OFF_TOPIC)];
    const rag = ragWith([vectorChunk("vec", 0.5, ON_TOPIC)], fts);
    const chunks = await hybrid(rag, QUERY);
    const byId = Object.fromEntries(chunks.map((c) => [c.chunkId, c]));
    expect(byId.lexTop.similarity).toBeCloseTo(0.45 * 1.0, 10);
    expect(byId.lexLow.similarity).toBeCloseTo(0.45 * 0.25, 10);
    expect(byId.vec.similarity).toBeCloseTo(0.55 * 0.5, 10);
    expect(chunks.map((c) => c.chunkId)).toEqual(["lexTop", "vec", "lexLow"]);
  });

  it("KNOWN, UNCHANGED HERE: three trusted top chunks are 'strong' whatever their scores", async () => {
    // hasStrongMatches' second rule (top 3 all isTrustedSource) does not look at
    // relevance. The KB is ~99% trusted-source documents and the vector arm always
    // returns ≥ 20 rows, so on a normal turn this rule — not lexSim — decides
    // "strong". Pinned so a change to it is a deliberate, reviewed decision.
    const rag = ragWith(
      [vectorChunk("v1", 0.3, OFF_TOPIC), vectorChunk("v2", 0.29, OFF_TOPIC), vectorChunk("v3", 0.28, OFF_TOPIC)],
      [],
    );
    const chunks = await hybrid(rag, QUERY);
    expect(Math.max(...chunks.map((c) => getGateScore(c)))).toBeLessThan(0.7);
    expect(gate.hasStrongMatches(chunks)).toBe(true);
  });
});
