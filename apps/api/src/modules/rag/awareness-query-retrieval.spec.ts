import { Logger } from "@nestjs/common";
import { RagService } from "./rag.service";
import { CrossLingualService } from "./cross-lingual.service";
import { QueryExpanderService } from "./query-expander.service";
import { buildKbFtsQuery } from "./kb-fts-query";
import { PgliteDatabase, PgliteProcess } from "./__test-utils__/pglite-client";

/**
 * Issue #182 — the flagship awareness question must reach the general
 * "Cancer Basics" document, not lines-of-therapy chunks.
 *
 * Runs the real RagService.retrieveWithMetadata against a real Postgres (PGlite,
 * out of process; never the production database) holding three SYNTHETIC chunks:
 * a general introduction, and two treatment chunks that talk about
 * "first-line"/"second line" therapy. The vector arm is stubbed to return nothing
 * so the test isolates the part of retrieval that is pure logic — the query text
 * — and records what would have been embedded.
 *
 * The probe below is synthetic (AGENTS.md §1.5), shaped like the harness probe in
 * the issue: address the bot by name, ask about cancer, ask for one line.
 */
const PROBE_HINGLISH = "suchi, cancer ke bare me ek line me batao";
const PROBE_ENGLISH = "tell me about cancer in one line";

const BASICS_ID = "chunk-basics";
const CHUNKS: Array<{ id: string; docId: string; title: string; content: string }> = [
  {
    id: BASICS_ID,
    docId: "doc-basics",
    title: "Cancer Basics: An Introduction",
    content:
      "Cancer is a disease in which some of the body's cells grow without control and can spread to other parts " +
      "of the body. Cancer can start almost anywhere. When the normal process of cell growth breaks down, abnormal " +
      "cells can form a lump called a tumor. Not every tumor is cancer.",
  },
  {
    id: "chunk-first-line-crc",
    docId: "doc-crc-drug",
    title: "Drug treatment for metastatic colorectal cancer",
    content:
      "A targeted drug may be given with chemotherapy as first-line treatment for metastatic colorectal cancer. " +
      "The second-line regimen depends on which first-line regimen was used.",
  },
  {
    id: "chunk-second-line-breast",
    docId: "doc-breast-drug",
    title: "Treatment of advanced breast cancer",
    content:
      "For hormone receptor positive advanced breast cancer, hormone therapy is often the first line of treatment. " +
      "Second line options are chosen after the disease progresses.",
  },
];

const SCHEMA = `
  CREATE TABLE "KbDocument" (
    id text PRIMARY KEY, title text, url text, "sourceType" text, source text, citation text,
    "lastReviewed" timestamp, "isTrustedSource" boolean, status text
  );
  CREATE TABLE "KbChunk" (id text PRIMARY KEY, "docId" text REFERENCES "KbDocument"(id), content text);
`;

describe("Awareness query retrieval (issue #182)", () => {
  jest.setTimeout(120_000);

  let proc: PgliteProcess;
  let db: PgliteDatabase;

  beforeAll(async () => {
    proc = PgliteProcess.start();
    db = await proc.createDatabase();
    await db.exec(SCHEMA);
    for (const chunk of CHUNKS) {
      // Same source type for every document so trust boosts cannot decide the order.
      await db.query(
        `INSERT INTO "KbDocument" (id, title, "sourceType", source, "isTrustedSource", status)
         VALUES ($1, $2, '02_nci_core', 'SYNTHETIC', true, 'active') ON CONFLICT DO NOTHING`,
        [chunk.docId, chunk.title]
      );
      await db.query(`INSERT INTO "KbChunk" (id, "docId", content) VALUES ($1, $2, $3)`, [
        chunk.id,
        chunk.docId,
        chunk.content,
      ]);
    }
  });

  afterAll(async () => {
    await proc?.stop();
  });

  let embedded: string[];
  let rag: RagService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    embedded = [];
    const prisma = { ...db.asPrisma(), $queryRaw: async () => [] }; // vector arm: no rows
    const embeddings = {
      generateEmbedding: async (text: string) => {
        embedded.push(text);
        return [0, 0, 0];
      },
    };
    const ftsHealth = { shouldQuery: () => true, recordQuerySuccess: () => undefined, getHealth: () => ({ status: "ok" }) };
    rag = new RagService(
      prisma as any,
      embeddings as any,
      { expandQuery: (q: string) => [q] } as any,
      new QueryExpanderService(),
      { isEnabled: () => false } as any,
      ftsHealth as any
    );
  });

  afterEach(() => jest.restoreAllMocks());

  /** What ChatService hands to retrieval for a message: the cross-lingual translation when there is one. */
  function chatRetrievalQuery(message: string): string {
    const { parallelQueries } = new CrossLingualService().generateParallelQueries(message);
    return parallelQueries.length > 1 ? parallelQueries[1] : message;
  }

  it.each([
    ["Hinglish flagship probe", PROBE_HINGLISH],
    ["English paraphrase", PROBE_ENGLISH],
  ])("REGRESSION (%s): retrieves the general introduction, ranked first", async (_label, message) => {
    const chunks = await rag.retrieveWithMetadata(chatRetrievalQuery(message), 6, null, "general");
    const ids = chunks.map((c) => c.chunkId);
    expect(ids).toContain(BASICS_ID);
    expect(ids[0]).toBe(BASICS_ID);
  });

  it("REGRESSION: neither the bot's name nor the answer-length directive is searched for", async () => {
    await rag.retrieveWithMetadata(chatRetrievalQuery(PROBE_HINGLISH), 6, null, "general");
    expect(embedded.length).toBeGreaterThan(0);
    for (const text of embedded) {
      expect(text).not.toMatch(/\bsuchi\b/i);
      expect(text).not.toMatch(/\bline\b/i);
      expect(text).not.toMatch(/\bek\b/i);
      expect(text).toMatch(/\bcancer\b/i);
    }
  });

  it("'ek' (one / a) is a Hinglish function word for the lexical arm, like 'one' already is in English", () => {
    const built = buildKbFtsQuery("mujhe ek gaanth hai");
    expect(built?.terms).toEqual(["gaanth"]);
    expect(built?.droppedTerms).toContain("ek");
  });

  it("CONTROL: a real lines-of-therapy question still finds the lines-of-therapy chunks", async () => {
    const chunks = await rag.retrieveWithMetadata("first-line treatment for metastatic colorectal cancer", 6, null, "treatment");
    expect(chunks[0]?.chunkId).toBe("chunk-first-line-crc");
  });
});
