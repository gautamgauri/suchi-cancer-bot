import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "@nestjs/common";
import { RagService } from "./rag.service";
import { KbFtsHealthService } from "./kb-fts-health.service";
import { PgliteDatabase, PgliteProcess } from "./__test-utils__/pglite-client";
import {
  KB_FTS_COLUMN,
  KB_FTS_CONFIG,
  KB_FTS_INDEX,
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
 * On the parent commit of the fix, everything below that touches the database fails:
 * `column c.content_tsv does not exist`.
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
    .filter((m) => m.sql.includes(KB_FTS_COLUMN) || m.sql.includes(KB_FTS_INDEX));
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
  options: { simulateFreshDbPush?: boolean } = {}
): Promise<PgliteDatabase> {
  const db = await proc.createDatabase();
  await db.exec(baselineDdlFromSchema());

  if (options.simulateFreshDbPush) {
    // A `db push`/`migrate diff` database is baselined at the datamodel, so it keeps
    // Prisma's plain `content_tsv tsvector` placeholder and only *new* migrations run.
    const restore = ftsMigrationsInOrder().find((m) => m.name === RESTORE_MIGRATION);
    if (!restore) throw new Error(`${RESTORE_MIGRATION} is missing from prisma/migrations`);
    await db.exec(restore.sql);
  } else {
    // Production's base schema predates FTS — `content_tsv` was created by migration
    // 20260120163141, not by the datamodel. Drop the datamodel's plain placeholder so
    // the migration history replays from the same starting point production had.
    await db.exec(`DROP INDEX IF EXISTS ${KB_FTS_INDEX};`);
    await db.exec(`ALTER TABLE "KbChunk" DROP COLUMN IF EXISTS ${KB_FTS_COLUMN};`);

    for (const migration of ftsMigrationsInOrder()) {
      await db.exec(migration.sql);
    }
  }

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
  // A retired document must never surface — the query filters on d.status = 'active'.
  await db.exec(`
    INSERT INTO "KbDocument" (id, "sourceType", source, title, version, url, status, "isTrustedSource", "createdAt", "updatedAt")
    VALUES ('doc-retired', '02_nci_core', 'NCI', 'Retired screening guidance', '1', NULL, 'archived', true, now(), now());
    INSERT INTO "KbChunk" (id, "docId", "chunkIndex", content, "createdAt")
    VALUES ('chunk-retired', 'doc-retired', 0, 'Cervical cancer screening HPV testing retired guidance', now());
  `);

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

  it("keeps content_tsv in the migration history (the #92 drop is not re-introduced)", () => {
    const migrations = ftsMigrationsInOrder();
    const last = migrations[migrations.length - 1];

    // The FTS lifecycle must end with a restore, not a drop. This is the guard that
    // would have failed CI on 2026-06-06.
    expect(migrations.map((m) => m.name)).toContain(RESTORE_MIGRATION);
    expect(last.sql).toMatch(/ADD COLUMN IF NOT EXISTS content_tsv/);
    expect(last.sql).toContain(`to_tsvector('${KB_FTS_CONFIG}', content)`);
  });

  it("leaves content_tsv present, STORED GENERATED and on the 'simple' config after replaying the real migrations", async () => {
    const rows = await db.query<KbFtsProbeRow>(KB_FTS_PROBE_SQL);
    expect(rows).toHaveLength(1);

    const probe = rows[0];
    expect(probe.tablePresent).toBe(true);
    expect(probe.columnPresent).toBe(true);
    // Existence alone is not enough: a plain column stays NULL forever and the
    // lexical arm returns zero rows without ever raising an error.
    expect(probe.columnGenerated).toBe(true);
    expect(probe.generationExpr).toContain(`'${KB_FTS_CONFIG}'`);
    expect(probe.indexPresent).toBe(true);
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

  it("RagService.fullTextSearchWithMetadata returns normalized evidence chunks against a real database", async () => {
    const ftsHealth = new KbFtsHealthService(db.asPrisma());
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

  it("repairs a schema built from schema.prisma, where Prisma renders content_tsv as a plain column", async () => {
    // `prisma migrate diff` / `db push` cannot express GENERATED, so a database created
    // straight from the datamodel gets a `content_tsv tsvector` that is always NULL.
    // The restore migration must rebuild it, not skip it via IF NOT EXISTS.
    const fresh = await buildDatabase(proc, { simulateFreshDbPush: true });
    try {
      const probe = (await fresh.query<KbFtsProbeRow>(KB_FTS_PROBE_SQL))[0];
      expect(probe.columnGenerated).toBe(true);
      expect(probe.generationExpr).toContain(`'${KB_FTS_CONFIG}'`);

      const rows = await fresh.query<{ id: string }>(KB_FTS_SEARCH_SQL, ["HPV testing", 12]);
      expect(rows.map((r) => r.id)).toContain("chunk-hpv");
    } finally {
      await fresh.close();
    }
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

  describe("when content_tsv goes missing again", () => {
    let broken: PgliteDatabase;
    let ftsHealth: KbFtsHealthService;
    let errorSpy: jest.SpyInstance;

    beforeAll(async () => {
      broken = await buildDatabase(proc);
      // Reproduce exactly what migration 20260606000000 did to production.
      await broken.exec(`DROP INDEX IF EXISTS ${KB_FTS_INDEX};`);
      await broken.exec(`ALTER TABLE "KbChunk" DROP COLUMN ${KB_FTS_COLUMN};`);
      ftsHealth = new KbFtsHealthService(broken.asPrisma());
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
      // Healthy database: the same statement does not raise at all.
      await expect(db.query(KB_FTS_SEARCH_SQL, ["HPV testing", 12])).resolves.toBeDefined();

      const schemaError = await broken
        .query(KB_FTS_SEARCH_SQL, ["HPV testing", 12])
        .then(() => null)
        .catch((e) => e);

      expect(schemaError).not.toBeNull();
      expect((schemaError as any).code).toBe("42703"); // undefined_column, straight from Postgres
      expect(isFtsSchemaError(schemaError)).toBe(true);
      // A transient failure must NOT be mistaken for a dead schema.
      expect(isFtsSchemaError(new Error("Timed out fetching a new connection from the pool"))).toBe(false);
    });

    it("reports 'unavailable' from the probe and logs it at error level", async () => {
      const health = await ftsHealth.probe();

      expect(health.status).toBe("unavailable");
      expect(health.detail).toContain(KB_FTS_COLUMN);
      expect(ftsHealth.isUnavailable()).toBe(true);

      const events = errorSpy.mock.calls.map((call) => call[0]?.event);
      expect(events).toContain("kb_fts_unavailable");
    });

    it("escalates a failing lexical query instead of swallowing it, while chat keeps serving", async () => {
      const health = new KbFtsHealthService(broken.asPrisma());
      const rag = ragServiceOn(broken, health);

      // Per-query resilience is preserved: the caller still gets an array, so the
      // vector arm can answer the turn.
      const chunks = await (rag as any).fullTextSearchWithMetadata("HPV testing", 6);
      expect(chunks).toEqual([]);

      // But the condition is counted and escalated, instead of one indistinguishable
      // log line per turn.
      expect(health.getHealth().schemaFailureCount).toBeGreaterThan(0);
      expect(health.getHealth().status).toBe("unavailable");
      expect(health.getHealth().lastError).toContain(KB_FTS_COLUMN);

      const events = errorSpy.mock.calls.map((call) => call[0]?.event);
      expect(events).toContain("kb_fts_unavailable");
    });
  });

  it("declares content_tsv in schema.prisma so a schema diff cannot drop it again", () => {
    const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
    const fromModel = schema.slice(schema.indexOf("model KbChunk {"));
    const modelBody = fromModel.slice(0, fromModel.indexOf("\n}"));

    expect(modelBody).toMatch(/content_tsv\s+Unsupported\("tsvector"\)\?/);
    expect(modelBody).toContain(`map: "${KB_FTS_INDEX}"`);
    expect(modelBody).toContain("DO NOT REMOVE");
  });
});
