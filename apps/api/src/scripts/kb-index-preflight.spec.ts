import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { PgliteDatabase, PgliteProcess } from "../modules/rag/__test-utils__/pglite-client";
import {
  ID_SAMPLE_LIMIT,
  KB_INDEX_INTEGRITY_SQL,
  KbIndexIntegrityRow,
  assessKbIndexIntegrity,
} from "./kb-index-preflight";

/**
 * Issue #86 — prevention layer.
 *
 * The duplicate cleanup itself already ran on production (2026-09-06: 73,802 ->
 * 48,737 rows, 0 non-deterministic ids, 0 duplicate positions). What is under
 * test here is what stops it happening again:
 *
 *   1. `assessKbIndexIntegrity` — the pure verdict ingest-kb.ts refuses on.
 *   2. migration 20260913000000_kb_chunk_unique_position — replayed against a
 *      REAL Postgres (PGlite, in-process WASM; never the production database),
 *      because a migration that has never been executed is only a claim. This
 *      follows kb-fts.spec.ts, written after #92 shipped a dead SQL string that
 *      no test ever ran.
 */

const API_ROOT = path.resolve(__dirname, "../..");
const SCHEMA_PATH = path.join(API_ROOT, "prisma", "schema.prisma");
const MIGRATION_NAME = "20260913000000_kb_chunk_unique_position";
const MIGRATION_SQL = path.join(API_ROOT, "prisma", "migrations", MIGRATION_NAME, "migration.sql");
const UNIQUE_INDEX = "KbChunk_docId_chunkIndex_key";

function row(
  total: number,
  nonDeterministic: number,
  duplicates: number,
  samples: string[] = []
): KbIndexIntegrityRow {
  return {
    total_rows: total,
    non_deterministic_id_rows: nonDeterministic,
    duplicate_position_rows: duplicates,
    non_deterministic_id_samples: samples,
  };
}

describe("assessKbIndexIntegrity (ingest-kb preflight, issue #86)", () => {
  it("passes the clean production shape (48,737 rows, both counters zero)", () => {
    const verdict = assessKbIndexIntegrity(row(48737, 0, 0));
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBe("");
    expect(verdict.totalRows).toBe(48737);
  });

  it("passes an empty table so a first ingest into a fresh database is not blocked", () => {
    expect(assessKbIndexIntegrity(row(0, 0, 0)).ok).toBe(true);
    expect(assessKbIndexIntegrity(undefined).ok).toBe(true);
    expect(assessKbIndexIntegrity(null).ok).toBe(true);
  });

  it("refuses the January 2026 damage and names both the issue and the cleanup script", () => {
    const verdict = assessKbIndexIntegrity(row(73802, 25065, 25065));
    expect(verdict.ok).toBe(false);
    expect(verdict.nonDeterministicIdRows).toBe(25065);
    expect(verdict.duplicatePositionRows).toBe(25065);
    expect(verdict.reason).toContain("25065");
    expect(verdict.reason).toContain("#86");
    expect(verdict.reason).toContain("scripts/sql/kb_duplicate_cleanup.sql");
    expect(verdict.reason).toContain("docId::chunk::N");
  });

  it("refuses a single legacy-id row even when it sits alone at its position", () => {
    // The precursor state the unique index cannot see: one uuid-id row, no
    // duplicate yet. It is still unreachable by the upsert, so ingesting on top
    // of it is how the duplicate gets created.
    const verdict = assessKbIndexIntegrity(row(48738, 1, 0));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/1 of 48738/);
  });

  it("refuses duplicate positions even when every id is deterministic", () => {
    const verdict = assessKbIndexIntegrity(row(48739, 0, 2));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("beyond the first at their (docId, chunkIndex)");
  });

  it("names up to five offending ids, and says how many more there are", () => {
    const verdict = assessKbIndexIntegrity(
      row(73802, 25065, 25065, [
        "0f1d0c5e-2a4b-4c1e-9a77-2b0f3a5d6e7c",
        "9c2a1b34-5d6e-4f70-8123-456789abcdef",
        "a9f4b2c1-0d3e-4f56-9876-543210fedcba",
        "b1c2d3e4-f506-4718-9a2b-3c4d5e6f7081",
        "c2d3e4f5-0617-4829-ab3c-4d5e6f708192",
      ])
    );
    expect(verdict.nonDeterministicIdSamples).toHaveLength(ID_SAMPLE_LIMIT);
    expect(verdict.reason).toContain("0f1d0c5e-2a4b-4c1e-9a77-2b0f3a5d6e7c");
    expect(verdict.reason).toContain("c2d3e4f5-0617-4829-ab3c-4d5e6f708192");
    expect(verdict.reason).toContain("+25060 more");
  });

  it("does not claim there are more when every offender is named", () => {
    const verdict = assessKbIndexIntegrity(row(48739, 2, 0, ["legacy::chunk::x", "doc-other::chunk::3"]));
    expect(verdict.reason).toContain("legacy::chunk::x, doc-other::chunk::3)");
    expect(verdict.reason).not.toContain("more)");
  });

  it("refuses an id whose `docId` names a different document", () => {
    // `doc-other::chunk::3` sitting on doc-screening/3 contains `::chunk::`, so
    // the old substring predicate called it deterministic. ingest-kb.ts upserts
    // `doc-screening::chunk::3` and inserts a SECOND row at position 3 — which
    // is now a bare 23505 from the unique index, with no explanation attached.
    const verdict = assessKbIndexIntegrity(row(48738, 1, 0, ["doc-other::chunk::3"]));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("doc-other::chunk::3");
    expect(verdict.reason).toContain("not exactly the");
  });

  it("refuses a legacy id with a non-numeric suffix", () => {
    const verdict = assessKbIndexIntegrity(row(48738, 1, 0, ["legacy::chunk::x"]));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("legacy::chunk::x");
  });

  it("still refuses when the database returned no samples", () => {
    // A caller running the counters-only form of the query must not be turned
    // into a pass by the absence of the sample column.
    const verdict = assessKbIndexIntegrity({
      total_rows: 10,
      non_deterministic_id_rows: 1,
      duplicate_position_rows: 0,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.nonDeterministicIdSamples).toEqual([]);
    expect(verdict.reason).not.toContain("e.g.");
  });

  it("coerces the bigint Postgres returns for un-cast aggregates", () => {
    const verdict = assessKbIndexIntegrity({
      total_rows: BigInt(10),
      non_deterministic_id_rows: BigInt(3),
      duplicate_position_rows: BigInt(0),
    });
    expect(typeof verdict.totalRows).toBe("number");
    expect(verdict.totalRows).toBe(10);
    expect(verdict.nonDeterministicIdRows).toBe(3);
    expect(verdict.ok).toBe(false);
  });
});

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
  // pgvector is not built into PGlite and nothing here reads `embedding`.
  cachedBaseline = ddl.replace(/vector\(768\)/g, "text");
  return cachedBaseline;
}

describe(`migration ${MIGRATION_NAME} (issue #86)`, () => {
  jest.setTimeout(240_000);

  let proc: PgliteProcess;
  let db: PgliteDatabase;

  beforeAll(async () => {
    proc = PgliteProcess.start();
    db = await proc.createDatabase();
    await db.exec(baselineDdlFromSchema());
    await db.exec(`
      INSERT INTO "KbDocument" (id, "sourceType", source, title, version, url, status, "isTrustedSource", "createdAt", "updatedAt")
      VALUES ('doc-screening', '02_nci_core', 'NCI', 'Cervical cancer screening', '1', NULL, 'active', true, now(), now());
    `);
  });

  afterAll(async () => {
    await db?.close().catch(() => undefined);
    await proc.stop();
  });

  const migrationSql = () => fs.readFileSync(MIGRATION_SQL, "utf8");

  /**
   * Reset to the pre-migration database: cleaned rows, no unique index — which
   * is production today. The schema already carries `@@unique([docId, chunkIndex])`,
   * so the baseline DDL creates the index; dropping it is what makes the
   * migration's own CREATE the thing under test.
   *
   * One PGlite instance is reused across these cases and reset here. A fresh
   * database per test means a fresh in-memory Postgres per test, which is
   * enough resident memory to get the whole run OOM-killed.
   */
  async function resetToPreMigration(): Promise<PgliteDatabase> {
    await db.exec(`DROP INDEX IF EXISTS "${UNIQUE_INDEX}";`);
    await db.exec(`DELETE FROM "KbChunk";`);
    return db;
  }

  async function insertChunk(db: PgliteDatabase, id: string, chunkIndex: number): Promise<void> {
    await db.query(
      `INSERT INTO "KbChunk" (id, "docId", "chunkIndex", content, "createdAt") VALUES ($1, 'doc-screening', $2, $3, now())`,
      [id, chunkIndex, "Screening finds cervical cancer early, when treatment works best."]
    );
  }

  async function uniqueIndexIsValid(db: PgliteDatabase): Promise<boolean> {
    const rows = await db.query<{ ok: boolean }>(
      `SELECT COALESCE(bool_and(i.indisvalid AND i.indisready AND i.indisunique), false) AS ok
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = $1`,
      [UNIQUE_INDEX]
    );
    return rows[0]?.ok === true;
  }

  it("creates the unique index on a cleaned table", async () => {
    const db = await resetToPreMigration();
    await insertChunk(db, "doc-screening::chunk::0", 0);
    await insertChunk(db, "doc-screening::chunk::1", 1);
    expect(await uniqueIndexIsValid(db)).toBe(false);

    await db.exec(migrationSql());

    expect(await uniqueIndexIsValid(db)).toBe(true);
  });

  it("then rejects a second row at an occupied position — the recurrence becomes a 23505", async () => {
    const db = await resetToPreMigration();
    await insertChunk(db, "doc-screening::chunk::0", 0);
    await db.exec(migrationSql());

    // Exactly what the January 2026 run did: a uuid-id row alongside the
    // deterministic one, same doc, same chunkIndex.
    await expect(
      insertChunk(db, "0f1d0c5e-2a4b-4c1e-9a77-2b0f3a5d6e7c", 0)
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses with an actionable message when duplicate positions still exist", async () => {
    const db = await resetToPreMigration();
    await insertChunk(db, "doc-screening::chunk::0", 0);
    await insertChunk(db, "9c2a1b34-5d6e-4f70-8123-456789abcdef", 0);

    let error: Error | null = null;
    await db.exec(migrationSql()).catch((e) => {
      error = e;
    });

    expect(error).not.toBeNull();
    const message = String((error as unknown as Error).message);
    expect(message).toMatch(/refusing to create the unique index/);
    expect(message).toContain("kb_duplicate_cleanup.sql");
    // Nothing committed: no half-built index left behind.
    expect(await uniqueIndexIsValid(db)).toBe(false);
  });

  it("is idempotent — a re-run after a manual psql apply is a no-op", async () => {
    const db = await resetToPreMigration();
    await insertChunk(db, "doc-screening::chunk::0", 0);
    await db.exec(migrationSql());
    await db.exec(migrationSql());
    expect(await uniqueIndexIsValid(db)).toBe(true);
  });

  it("the integrity SQL the preflight ships runs against the real schema", async () => {
    const db = await resetToPreMigration();
    await insertChunk(db, "doc-screening::chunk::0", 0);
    await insertChunk(db, "a9f4b2c1-0d3e-4f56-9876-543210fedcba", 1);

    const rows = await db.query<KbIndexIntegrityRow>(KB_INDEX_INTEGRITY_SQL);
    const verdict = assessKbIndexIntegrity(rows[0]);

    expect(verdict.totalRows).toBe(2);
    expect(verdict.nonDeterministicIdRows).toBe(1);
    expect(verdict.duplicatePositionRows).toBe(0);
    expect(verdict.nonDeterministicIdSamples).toEqual(["a9f4b2c1-0d3e-4f56-9876-543210fedcba"]);
    expect(verdict.ok).toBe(false);
  });

  it("the integrity SQL catches ids the old `%::chunk::%` test called healthy", async () => {
    // All three rows sit alone at their position, so the unique index is happy
    // and all three contain `::chunk::`. None is reachable by ingest-kb.ts's
    // upsert, which is the whole point of the preflight.
    const db = await resetToPreMigration();
    await insertChunk(db, "doc-screening::chunk::0", 0);
    await insertChunk(db, "legacy::chunk::x", 1); // non-numeric suffix
    await insertChunk(db, "doc-other::chunk::2", 2); // id names a different doc
    await insertChunk(db, "doc-screening::chunk::7", 3); // suffix drifted from chunkIndex

    const rows = await db.query<KbIndexIntegrityRow>(KB_INDEX_INTEGRITY_SQL);
    const verdict = assessKbIndexIntegrity(rows[0]);

    expect(verdict.totalRows).toBe(4);
    expect(verdict.duplicatePositionRows).toBe(0);
    expect(verdict.nonDeterministicIdRows).toBe(3);
    expect(verdict.nonDeterministicIdSamples.sort()).toEqual([
      "doc-other::chunk::2",
      "doc-screening::chunk::7",
      "legacy::chunk::x",
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("legacy::chunk::x");
  });

  it("the integrity SQL caps the sample list at five ids", async () => {
    const db = await resetToPreMigration();
    for (let i = 0; i < 8; i++) {
      await insertChunk(db, `legacy-${i}::chunk::x`, i);
    }

    const rows = await db.query<KbIndexIntegrityRow>(KB_INDEX_INTEGRITY_SQL);
    const verdict = assessKbIndexIntegrity(rows[0]);

    expect(verdict.nonDeterministicIdRows).toBe(8);
    expect(verdict.nonDeterministicIdSamples).toHaveLength(ID_SAMPLE_LIMIT);
    expect(verdict.reason).toContain("+3 more");
  });

  it("the schema declares the constraint the migration creates", () => {
    const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
    expect(schema).toMatch(/@@unique\(\[docId, chunkIndex\]\)/);
    // KbChunk_docId_idx is now largely redundant but is deliberately kept —
    // dropping it belongs in its own change.
    expect(schema).toMatch(/@@index\(\[docId\]\)/);
  });
});
