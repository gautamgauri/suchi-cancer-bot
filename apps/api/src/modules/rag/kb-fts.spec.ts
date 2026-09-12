import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "@nestjs/common";
import { RagService } from "./rag.service";
import { KbFtsHealthService } from "./kb-fts-health.service";
import { PgliteDatabase, PgliteProcess } from "./__test-utils__/pglite-client";
import {
  KB_FTS_CONFIG,
  KB_FTS_INDEX,
  KB_FTS_INDEXDEF_MARKER,
  KB_FTS_LEGACY_COLUMN,
  KB_FTS_PROBE_SQL,
  KB_FTS_SEARCH_SQL,
  KbFtsProbeRow,
  isFtsSchemaError,
} from "./kb-fts.sql";

/**
 * Regression test for issue #92 — "full-text search is dead in production".
 *
 * WHY IT IS SHAPED LIKE THIS
 * Migration 20260606000000 dropped `KbChunk.content_tsv`; the lexical arm of hybrid
 * retrieval kept querying it and failed inside a catch that returned []. Nothing
 * noticed because nothing ever executed the SQL — the schema lived in raw migration
 * files, the query lived in a template literal, and no test put the two in the same
 * process. Issue #90 is the cautionary counter-example: green tests over hand-written
 * input while the shipped feature was dead.
 *
 * So this suite runs a REAL Postgres (PGlite — Postgres compiled to WASM; no server,
 * no network, and never the production database), builds the schema from the REAL
 * artifacts (`prisma/schema.prisma` via `prisma migrate diff`, then every
 * migration.sql that touches the FTS objects, replayed oldest-first), and executes the
 * REAL statement the service ships (`KB_FTS_SEARCH_SQL`) — including once through
 * `RagService.fullTextSearchWithMetadata` itself.
 *
 * DESIGN UNDER TEST (2026-09-12): the lexical arm is a GIN EXPRESSION index over
 * to_tsvector('simple', content) and a query using the identical expression. There is
 * no tsvector column. Two column designs were abandoned the same day (table rewrite
 * outage; 190 ms/row trigger backfill) — see the migration header.
 */

const API_ROOT = path.resolve(__dirname, "../../..");
const SCHEMA_PATH = path.join(API_ROOT, "prisma", "schema.prisma");
const MIGRATIONS_DIR = path.join(API_ROOT, "prisma", "migrations");
const RESTORE_MIGRATION = "20260908000000_restore_kb_chunk_fts";

/** KB-shaped rows. Public screening information only — no patient data. */
const DOC_ID = "doc-cervical-screening";
const CHUNKS: Array<{ id: string; content: string }> = [
  {
    id: "chunk-hpv",
    content:
      "Cervical cancer screening in India uses HPV DNA testing and visual inspection with acetic acid (VIA). " +
      "Screening is recommended for women aged 30 to 65.",
  },
  {
    id: "chunk-followup",
    content:
      "After an abnormal screening result, a colposcopy is arranged at the district hospital for follow-up.",
  },
  {
    id: "chunk-hindi",
    content: "सर्वाइकल कैंसर की जांच के लिए HPV test किया जाता है। यह जांच 30 saal ke baad karani chahiye.",
  },
];

/** Every migration that touches the FTS objects, oldest first, as shipped. */
function ftsMigrationsInOrder(): Array<{ name: string; sql: string }> {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((entry) => fs.statSync(path.join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8") }))
    .filter((m) => m.sql.includes(KB_FTS_LEGACY_COLUMN) || m.sql.includes(KB_FTS_INDEX));
}

function restoreSql(): string {
  const restore = ftsMigrationsInOrder().find((m) => m.name === RESTORE_MIGRATION);
  if (!restore) throw new Error(`${RESTORE_MIGRATION} is missing from prisma/migrations`);
  return restore.sql;
}

/**
 * Baseline DDL for the current datamodel, generated offline by Prisma itself.
 * `--from-empty` never opens a connection; DATABASE_URL only has to parse.
 */
let cachedBaseline: string | null = null;
function baselineDdlFromSchema(): string {
  if (cachedBaseline) return cachedBaseline;

  const ddl = execFileSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", SCHEMA_PATH, "--script"],
    {
      cwd: API_ROOT,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused" },
      maxBuffer: 32 * 1024 * 1024,
    }
  );

  // The only substitution: pgvector is not built into PGlite and is irrelevant here.
  // Nothing in this suite reads or writes `embedding`.
  cachedBaseline = ddl.replace(/vector\(768\)/g, "text");
  return cachedBaseline;
}

async function buildDatabase(
  proc: PgliteProcess,
  options: { replayMigrations?: boolean; seed?: boolean } = {}
): Promise<PgliteDatabase> {
  const { replayMigrations = true, seed = true } = options;
  const db = await proc.createDatabase();
  await db.exec(baselineDdlFromSchema());

  if (replayMigrations) {
    // Production's history: 20260120 (generated column, 'english') → 20260218 ('simple')
    // → 20260606 (dropped) → 20260908 (expression index). Replayed from the same
    // starting point production had: the datamodel carries no FTS objects.
    for (const migration of ftsMigrationsInOrder()) {
      await db.exec(migration.sql);
    }
  }

  if (seed) {
    await db.exec(`
      INSERT INTO "KbDocument" (id, "sourceType", source, title, version, url, status, "isTrustedSource", "createdAt", "updatedAt")
      VALUES ('${DOC_ID}', '02_nci_core', 'NCI', 'Cervical cancer screening', '1', 'https://example.org/screening',
              'active', true, now(), now());
    `);
    for (const [index, chunk] of CHUNKS.entries()) {
      await db.query(
        `INSERT INTO "KbChunk" (id, "docId", "chunkIndex", content, "createdAt") VALUES ($1, $2, $3, $4, now())`,
        [chunk.id, DOC_ID, index, chunk.content]
      );
    }
    // An archived document must never come back from retrieval.
    await db.exec(`
      INSERT INTO "KbDocument" (id, "sourceType", source, title, version, url, status, "isTrustedSource", "createdAt", "updatedAt")
      VALUES ('doc-retired', '02_nci_core', 'NCI', 'Retired page', '1', NULL, 'archived', true, now(), now());
      INSERT INTO "KbChunk" (id, "docId", "chunkIndex", content, "createdAt")
      VALUES ('chunk-retired', 'doc-retired', 0, 'HPV testing guidance that has since been withdrawn.', now());
    `);
  }
  return db;
}

function ragServiceOn(db: PgliteDatabase, ftsHealth: KbFtsHealthService): RagService {
  return new RagService(
    db.asPrisma(),
    {} as any, // embeddings — the lexical arm does not embed
    {} as any, // synonyms
    {} as any, // queryExpander
    {} as any, // reranker
    ftsHealth
  );
}

async function probe(db: PgliteDatabase): Promise<KbFtsProbeRow> {
  const rows = await db.query<KbFtsProbeRow>(KB_FTS_PROBE_SQL);
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("KB full-text search (issue #92)", () => {
  jest.setTimeout(240_000);

  let proc: PgliteProcess;
  let db: PgliteDatabase;

  beforeAll(async () => {
    proc = PgliteProcess.start();
    db = await buildDatabase(proc);
  });

  afterAll(async () => {
    await proc?.stop();
  });

  it("the FTS migration history ends with the expression index, not a drop (the #92 drop is not re-introduced)", () => {
    const migrations = ftsMigrationsInOrder();
    const last = migrations[migrations.length - 1];
    expect(last.name).toBe(RESTORE_MIGRATION);
    expect(last.sql).toMatch(/CREATE INDEX kb_chunk_content_tsv_idx ON "KbChunk" USING GIN \(to_tsvector\('simple', content\)\)/);
    // The abandoned designs must not come back: no generated column, no trigger creation.
    expect(last.sql).not.toMatch(/GENERATED ALWAYS/);
    expect(last.sql).not.toMatch(/CREATE TRIGGER/);
  });

  it("leaves a VALID GIN expression index over to_tsvector('simple', content) and no legacy column after replaying the real migrations", async () => {
    const p = await probe(db);
    expect(p.tablePresent).toBe(true);
    expect(p.indexDef).toContain(KB_FTS_INDEXDEF_MARKER);
    expect(p.indexDef).toMatch(/USING gin/i);
    expect(p.indexValid).toBe(true);
    expect(p.legacyColumnPresent).toBe(false);
  });

  it("returns ranked rows for the shipped lexical query", async () => {
    const rows = await db.query<{ id: string; docId: string; lexRank: number }>(KB_FTS_SEARCH_SQL, [
      "HPV testing for cervical cancer screening",
      12,
    ]);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].id).toBe("chunk-hpv");
    expect(rows[0].lexRank).toBeGreaterThan(0);
    expect(rows[0].docId).toBe(DOC_ID);
    // Archived documents stay out of retrieval.
    expect(rows.map((r) => r.id)).not.toContain("chunk-retired");
  });

  it("matches Hindi/Hinglish content — the reason the config is 'simple' and not 'english'", async () => {
    const devanagari = await db.query<{ id: string }>(KB_FTS_SEARCH_SQL, ["सर्वाइकल कैंसर की जांच", 12]);
    expect(devanagari.map((r) => r.id)).toContain("chunk-hindi");

    const hinglish = await db.query<{ id: string }>(KB_FTS_SEARCH_SQL, ["HPV test", 12]);
    expect(hinglish.map((r) => r.id)).toContain("chunk-hindi");
  });

  it("the planner uses the expression index for the shipped predicate", async () => {
    // Tiny table: force the choice so the test checks *usability*, not cost estimates.
    await db.exec("SET enable_seqscan = off;");
    try {
      const plan = await db.query<{ "QUERY PLAN": string }>(
        `EXPLAIN SELECT c.id FROM "KbChunk" c, websearch_to_tsquery('${KB_FTS_CONFIG}', 'HPV testing') q WHERE to_tsvector('${KB_FTS_CONFIG}', c.content) @@ q`
      );
      expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain(KB_FTS_INDEX);
    } finally {
      await db.exec("RESET enable_seqscan;");
    }
  });

  it("newly inserted rows are searchable immediately (no column to keep current)", async () => {
    await db.exec(`INSERT INTO "KbChunk" (id, "docId", "chunkIndex", content, "createdAt")
                   VALUES ('chunk-new', '${DOC_ID}', 99, 'Mammography screening every two years', now());`);
    expect((await db.query<{ id: string }>(KB_FTS_SEARCH_SQL, ["mammography", 12])).map((r) => r.id)).toContain("chunk-new");
    await db.exec(`DELETE FROM "KbChunk" WHERE id = 'chunk-new';`);
  });

  it("RagService.fullTextSearchWithMetadata returns normalized evidence chunks against a real database", async () => {
    const ftsHealth = new KbFtsHealthService(db.asPrisma());
    await ftsHealth.probe(); // as onModuleInit does at boot — the gate needs an `ok` verdict
    const rag = ragServiceOn(db, ftsHealth);

    const chunks = await (rag as any).fullTextSearchWithMetadata("HPV testing cervical cancer screening", 6);

    // The assertion that was false in production for three months.
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkId).toBe("chunk-hpv");
    expect(chunks[0].document.title).toBe("Cervical cancer screening");
    expect(chunks[0].document.isTrustedSource).toBe(true);
    // similarity is lexRank normalized against the top hit
    expect(chunks[0].similarity).toBeCloseTo(1, 5);
    for (const chunk of chunks) {
      expect(chunk.similarity).toBeGreaterThan(0);
      expect(chunk.similarity).toBeLessThanOrEqual(1);
    }
    expect(ftsHealth.getHealth().schemaFailureCount).toBe(0);
  });

  it("reports 'ok' from the boot probe on a correctly migrated database", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    try {
      const ftsHealth = new KbFtsHealthService(db.asPrisma());
      const health = await ftsHealth.probe();

      expect(health.status).toBe("ok");
      expect(ftsHealth.isUnavailable()).toBe(false);
      expect(health.checkedAt).not.toBeNull();
    } finally {
      jest.restoreAllMocks();
    }
  });

  it("the migration removes leftovers of the abandoned column designs and builds the expression index", async () => {
    const legacy = await buildDatabase(proc, { replayMigrations: false });
    try {
      // What the trigger-maintained design left behind.
      await legacy.exec(`
        ALTER TABLE "KbChunk" ADD COLUMN ${KB_FTS_LEGACY_COLUMN} tsvector;
        CREATE OR REPLACE FUNCTION kbchunk_content_tsv_maintain() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN NEW.${KB_FTS_LEGACY_COLUMN} := to_tsvector('${KB_FTS_CONFIG}', NEW.content); RETURN NEW; END $fn$;
        CREATE TRIGGER kbchunk_content_tsv_trg BEFORE INSERT OR UPDATE OF content ON "KbChunk"
          FOR EACH ROW EXECUTE FUNCTION kbchunk_content_tsv_maintain();
        CREATE INDEX ${KB_FTS_INDEX} ON "KbChunk" USING GIN (${KB_FTS_LEGACY_COLUMN});
      `);
      expect((await probe(legacy)).legacyColumnPresent).toBe(true);

      await legacy.exec(restoreSql());

      const p = await probe(legacy);
      expect(p.legacyColumnPresent).toBe(false);
      expect(p.indexDef).toContain(KB_FTS_INDEXDEF_MARKER);
      expect(p.indexValid).toBe(true);
      const fn = await legacy.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'kbchunk_content_tsv_maintain'`);
      expect(fn[0].n).toBe(0);
      expect((await legacy.query<{ id: string }>(KB_FTS_SEARCH_SQL, ["HPV testing", 12])).map((r) => r.id)).toContain("chunk-hpv");
    } finally {
      await legacy.close();
    }
  });

  describe("when the expression index is missing (e.g. a schema diff dropped it again)", () => {
    // The June-2026 failure shape — but with an expression query the arm is now
    // *degraded*, not dead: rows still come back via a sequential scan.
    let noIndex: PgliteDatabase;

    beforeAll(async () => {
      noIndex = await buildDatabase(proc, { replayMigrations: false });
    });

    afterAll(async () => {
      await noIndex?.close();
    });

    it("the shipped query still returns correct rows", async () => {
      const rows = await noIndex.query<{ id: string }>(KB_FTS_SEARCH_SQL, ["HPV testing", 12]);
      expect(rows.map((r) => r.id)).toContain("chunk-hpv");
    });

    it("probes as 'degraded' with a remediation pointing at the migration/script", async () => {
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      try {
        const health = new KbFtsHealthService(noIndex.asPrisma());
        const result = await health.probe();
        expect(result.status).toBe("degraded");
        expect(result.detail).toMatch(/missing/);
        expect(health.isUnavailable()).toBe(false);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it("REGRESSION: while degraded, RagService does NOT run the lexical SQL — it answers vector-only", async () => {
      // Review on the expression-index PR: a missing index must not turn every
      // hybrid turn into a full-table to_tsvector() scan on a small instance.
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      try {
        const prisma = noIndex.asPrisma();
        const health = new KbFtsHealthService(prisma);
        await health.probe();
        expect(health.getHealth().status).toBe("degraded");

        const rawSpy = jest.spyOn(prisma, "$queryRawUnsafe");
        const rag = ragServiceOn(noIndex, health);
        const chunks = await (rag as any).fullTextSearchWithMetadata("HPV testing", 6);

        expect(chunks).toEqual([]);
        const lexicalCalls = rawSpy.mock.calls.filter((c) => String(c[0]).includes("websearch_to_tsquery"));
        expect(lexicalCalls).toHaveLength(0);
        // The gate schedules a re-probe (probe SQL) instead — verdict stays degraded here.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(health.getHealth().status).toBe("degraded");
      } finally {
        jest.restoreAllMocks();
      }
    });

    it("resumes the lexical arm by itself once the index exists and the re-probe sees it", async () => {
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      try {
        const health = new KbFtsHealthService(noIndex.asPrisma());
        await health.probe();
        expect(health.shouldQuery()).toBe(false);

        await noIndex.exec(`CREATE INDEX ${KB_FTS_INDEX} ON "KbChunk" USING GIN (to_tsvector('${KB_FTS_CONFIG}', content));`);
        // Throttle window is 30 s in production; call the probe directly here.
        await health.probe();
        expect(health.shouldQuery()).toBe(true);

        const rag = ragServiceOn(noIndex, health);
        const chunks = await (rag as any).fullTextSearchWithMetadata("HPV testing", 6);
        expect(chunks.map((c: any) => c.chunkId)).toContain("chunk-hpv");
      } finally {
        await noIndex.exec(`DROP INDEX IF EXISTS ${KB_FTS_INDEX};`);
        jest.restoreAllMocks();
      }
    });
  });

  it("does clear a stale 'unavailable' verdict on a healthy schema: the gate skips once, re-probes, then the arm runs", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const health = new KbFtsHealthService(db.asPrisma());
      (health as any).set("unavailable", "forced stale verdict for test");
      expect(health.isUnavailable()).toBe(true);

      const rag = ragServiceOn(db, health);
      // First call is skipped (vector-only) but schedules the re-probe.
      expect(await (rag as any).fullTextSearchWithMetadata("HPV testing", 6)).toEqual([]);

      const deadline = Date.now() + 3000;
      while (health.getHealth().status !== "ok" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(health.getHealth().status).toBe("ok");
      // …and the next call runs the lexical arm.
      const chunks = await (rag as any).fullTextSearchWithMetadata("HPV testing", 6);
      expect(chunks.map((c: any) => c.chunkId)).toContain("chunk-hpv");
    } finally {
      jest.restoreAllMocks();
    }
  });

  it("reports 'degraded' (not ok) when the index is left INVALID by an interrupted concurrent build", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const invalid = await buildDatabase(proc);
    try {
      await invalid.exec(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = '${KB_FTS_INDEX}'::regclass;`);
      const p = await probe(invalid);
      expect(p.indexDef).not.toBeNull();
      expect(p.indexValid).toBe(false);

      const health = await new KbFtsHealthService(invalid.asPrisma()).probe();
      expect(health.status).toBe("degraded");
      expect(health.detail).toMatch(/INVALID/);
    } finally {
      jest.restoreAllMocks();
      await invalid.close();
    }
  });

  describe("when the table itself is gone", () => {
    let broken: PgliteDatabase;
    let errorSpy: jest.SpyInstance;

    beforeAll(async () => {
      broken = await buildDatabase(proc, { seed: false });
      await broken.exec(`DROP TABLE "KbChunk" CASCADE;`);
    });

    beforeEach(() => {
      errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      await broken?.close();
    });

    it("classifies the real Postgres error as a schema failure, not an unlucky query", async () => {
      await expect(db.query(KB_FTS_SEARCH_SQL, ["HPV testing", 12])).resolves.toBeDefined();

      const schemaError = await broken
        .query(KB_FTS_SEARCH_SQL, ["HPV testing", 12])
        .then(() => null)
        .catch((e) => e);

      expect(schemaError).not.toBeNull();
      expect((schemaError as any).code).toBe("42P01"); // undefined_table, straight from Postgres
      expect(isFtsSchemaError(schemaError)).toBe(true);
      // A transient failure must NOT be mistaken for a dead schema.
      expect(isFtsSchemaError(new Error("Timed out fetching a new connection from the pool"))).toBe(false);
    });

    it("reports 'unavailable' from the probe and logs it at error level", async () => {
      const health = await new KbFtsHealthService(broken.asPrisma()).probe();
      expect(health.status).toBe("unavailable");
      const events = errorSpy.mock.calls.map((call) => call[0]?.event);
      expect(events).toContain("kb_fts_unavailable");
    });

    it("escalates a failing lexical query instead of swallowing it, while chat keeps serving", async () => {
      const health = new KbFtsHealthService(broken.asPrisma());
      // The table vanished AFTER a healthy boot probe: the gate lets the query run once.
      (health as any).set("ok", "stale ok from boot");
      const rag = ragServiceOn(broken, health);

      const chunks = await (rag as any).fullTextSearchWithMetadata("HPV testing", 6);
      expect(chunks).toEqual([]);

      expect(health.getHealth().schemaFailureCount).toBeGreaterThan(0);
      expect(health.getHealth().status).toBe("unavailable");

      const events = errorSpy.mock.calls.map((call) => call[0]?.event);
      expect(events).toContain("kb_fts_unavailable");
    });
  });

  describe("on a production-sized table the migration refuses instead of scanning under a lock", () => {
    // The safeguard from the 2026-09-12 review: migration.sql either completes
    // (small table) or raises with nothing committed — so `prisma migrate deploy`
    // can never record it as applied ahead of the concurrent index build.
    let big: PgliteDatabase;

    beforeAll(async () => {
      big = await buildDatabase(proc, { replayMigrations: false, seed: false });
      await big.exec(`
        INSERT INTO "KbDocument" (id, "sourceType", source, title, version, url, status, "isTrustedSource", "createdAt", "updatedAt")
        VALUES ('${DOC_ID}', '02_nci_core', 'NCI', 'Bulk', '1', NULL, 'active', true, now(), now());
        INSERT INTO "KbChunk" (id, "docId", "chunkIndex", content, "createdAt")
        SELECT 'bulk-' || g, '${DOC_ID}', g, 'filler chunk ' || g, now() FROM generate_series(1, 5001) g;
      `);
    });

    afterAll(async () => {
      await big?.close();
    });

    it("raises with the 'refusing' message and leaves no index behind", async () => {
      const err = await big.exec(restoreSql()).then(() => null).catch((e) => e);
      expect(err).not.toBeNull();
      expect(String((err as Error).message)).toMatch(/refusing to build the FTS index inside a migration/);
      expect((await probe(big)).indexDef).toBeNull();
    });

    it("is a harmless no-op once the rollout script has built a valid expression index", async () => {
      // What scripts/sql/kb_fts_safe_rollout.py does, minus CONCURRENTLY (PGlite).
      await big.exec(`CREATE INDEX ${KB_FTS_INDEX} ON "KbChunk" USING GIN (to_tsvector('${KB_FTS_CONFIG}', content));`);
      await expect(big.exec(restoreSql())).resolves.toBeDefined();
      const p = await probe(big);
      expect(p.indexValid).toBe(true);
      expect(p.indexDef).toContain(KB_FTS_INDEXDEF_MARKER);
    });
  });

  it("schema.prisma carries no tsvector column and keeps the guard note about the expression index", () => {
    const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
    const fromModel = schema.slice(schema.indexOf("model KbChunk {"));
    const modelBody = fromModel.slice(0, fromModel.indexOf("\n}"));

    // No stored tsvector: a schema diff must not try to (re)create or drop a column.
    expect(modelBody).not.toMatch(/content_tsv\s+Unsupported/);
    // The note that stops the next "clean-up" from repeating June 2026.
    expect(modelBody).toContain("DO NOT REMOVE");
    expect(modelBody).toContain(KB_FTS_INDEX);
  });
});
