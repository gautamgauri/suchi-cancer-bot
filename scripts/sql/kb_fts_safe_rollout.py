#!/usr/bin/env python3
"""
Production rollout of the KbChunk full-text-search column (issue #92 / PR #98)
WITHOUT a table rewrite.

WHY THIS SCRIPT EXISTS
  On 2026-09-12 the first version of migration 20260908000000_restore_kb_chunk_fts
  re-added `content_tsv` as a STORED generated column. Postgres implements that as
  a full rewrite of "KbChunk" under an ACCESS EXCLUSIVE lock, and the rewrite
  rebuilds every index on the table — including the pgvector HNSW index. On
  suchi-db that ran for 15+ minutes; every retrieval query queued behind the
  lock, the connection pool filled, /v1/health stopped answering and chat turns
  timed out. The statement was terminated. Nothing was changed.

WHAT THIS SCRIPT DOES INSTEAD (each step is short or interruptible)
  1. Bootstraps the schema itself (the same DDL migration.sql carries): a PLAIN
     nullable tsvector column (catalog-only, milliseconds) and the BEFORE INSERT
     OR UPDATE OF content trigger. migration.sql is NOT run on a production-sized
     table — it deliberately RAISES there, so `prisma migrate deploy` can never
     record the migration as applied before the backfill and index exist.
  2. Backfills `content_tsv` in small committed batches, sleeping between
     batches. Never one long transaction. Ctrl-C between batches is safe.
  3. Builds the GIN index with CREATE INDEX CONCURRENTLY (outside any
     transaction; does not block reads or writes).
  4. Verifies: zero NULL rows, index present AND valid (pg_index.indisvalid),
     the shipped lexical query returns rows.
  5. Marks the migration applied in Prisma's history
     (`prisma migrate resolve --applied ...`) — only after 1–4 succeeded.

USAGE (from the repo root, with the Cloud SQL proxy running on 127.0.0.1:5433;
see docs/OPERATIONS_RUNBOOK.md §1 and §4a):

    export DATABASE_URL="$(gcloud secrets versions access latest --secret=database-url)"
    python3 scripts/sql/kb_fts_safe_rollout.py                 # dry run: prints state + plan
    python3 scripts/sql/kb_fts_safe_rollout.py --execute       # do it
    python3 scripts/sql/kb_fts_safe_rollout.py --execute --batch-size 1000 --sleep 0.5

  Run it in a low-traffic window (night IST). Watch DB CPU and connection count
  while the backfill runs; it prints progress per batch. The password is never
  printed. Re-running is safe: every step is idempotent and skips finished work.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import urllib.parse as urlparse
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
API_DIR = REPO / "apps" / "api"
MIGRATION = "20260908000000_restore_kb_chunk_fts"
MIGRATION_SQL = API_DIR / "prisma" / "migrations" / MIGRATION / "migration.sql"
TABLE = '"KbChunk"'
COLUMN = "content_tsv"
INDEX = "kb_chunk_content_tsv_idx"
TRIGGER = "kbchunk_content_tsv_trg"
CONFIG = "simple"
LOCK_TIMEOUT = "5s"

# Mirrors the column/trigger part of migration.sql. Keep the two in sync: the
# PGlite test replays migration.sql; production runs this.
BOOTSTRAP_SQL = f"""
SET lock_timeout = '{LOCK_TIMEOUT}';
CREATE OR REPLACE FUNCTION kbchunk_content_tsv_maintain() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.{COLUMN} := to_tsvector('{CONFIG}', NEW.content);
  RETURN NEW;
END
$fn$;
DO $$
DECLARE col_generated "char";
BEGIN
  SELECT a.attgenerated INTO col_generated FROM pg_attribute a
  WHERE a.attrelid = to_regclass('{TABLE}') AND a.attname = '{COLUMN}' AND NOT a.attisdropped;
  IF col_generated IS NULL THEN
    ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS {COLUMN} tsvector;
    col_generated := '';
  END IF;
  IF col_generated = 's' THEN
    DROP TRIGGER IF EXISTS {TRIGGER} ON {TABLE};
  ELSE
    DROP TRIGGER IF EXISTS {TRIGGER} ON {TABLE};
    CREATE TRIGGER {TRIGGER} BEFORE INSERT OR UPDATE OF content ON {TABLE}
      FOR EACH ROW EXECUTE FUNCTION kbchunk_content_tsv_maintain();
  END IF;
END$$;
"""


class Db:
    def __init__(self, url: str, host: str, port: int) -> None:
        p = urlparse.urlparse(url)
        self.user = urlparse.unquote(p.username or "")
        self.password = urlparse.unquote(p.password or "")
        self.dbname = p.path.lstrip("/")
        self.host, self.port = host, port

    def _base(self) -> list[str]:
        return ["psql", "-h", self.host, "-p", str(self.port), "-U", self.user, "-d", self.dbname, "-v", "ON_ERROR_STOP=1", "-X", "-q"]

    def _env(self) -> dict[str, str]:
        return {**os.environ, "PGPASSWORD": self.password}

    def scalar(self, sql: str) -> str:
        r = subprocess.run(self._base() + ["-At", "-c", sql], env=self._env(), capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        return r.stdout.strip()

    def exec(self, sql: str, timeout: int = 600) -> str:
        r = subprocess.run(self._base() + ["-c", sql], env=self._env(), capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        return (r.stdout + r.stderr).strip()

    def exec_file(self, path: Path, timeout: int = 600) -> str:
        r = subprocess.run(self._base() + ["-f", str(path)], env=self._env(), capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        return (r.stdout + r.stderr).strip()

    def prisma_url(self) -> str:
        return f"postgresql://{urlparse.quote(self.user)}:{urlparse.quote(self.password)}@{self.host}:{self.port}/{self.dbname}"


def state(db: Db) -> dict[str, str]:
    q = {
        "rows": f"SELECT count(*) FROM {TABLE};",
        "column": (
            "SELECT coalesce((SELECT CASE WHEN attgenerated = 's' THEN 'generated' ELSE 'plain' END FROM pg_attribute "
            f"WHERE attrelid = to_regclass('{TABLE}') AND attname = '{COLUMN}' AND NOT attisdropped), 'absent');"
        ),
        "trigger": (
            f"SELECT coalesce((SELECT CASE WHEN tgenabled <> 'D' THEN 'enabled' ELSE 'disabled' END FROM pg_trigger "
            f"WHERE tgrelid = to_regclass('{TABLE}') AND tgname = '{TRIGGER}'), 'absent');"
        ),
        "nulls": f"SELECT count(*) FROM {TABLE} WHERE {COLUMN} IS NULL;",
        "index": (
            "SELECT coalesce((SELECT CASE WHEN i.indisvalid AND i.indisready THEN 'valid' ELSE 'INVALID' END "
            f"FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '{INDEX}'), 'absent');"
        ),
        "prisma": f"SELECT coalesce((SELECT 'applied' FROM _prisma_migrations WHERE migration_name = '{MIGRATION}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1), 'not recorded');",
        "waiting_on_locks": "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database();",
    }
    out: dict[str, str] = {}
    for k, sql in q.items():
        try:
            out[k] = db.scalar(sql)
        except RuntimeError as e:
            out[k] = f"? ({e.splitlines()[0][:80]})"
    return out


def show(title: str, st: dict[str, str]) -> None:
    print(f"\n== {title} ==")
    for k, v in st.items():
        print(f"  {k:17} {v}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--execute", action="store_true", help="actually change the database (default: dry run)")
    ap.add_argument("--batch-size", type=int, default=1500, help="rows per committed backfill batch (default 1500)")
    ap.add_argument("--sleep", type=float, default=0.5, help="seconds to sleep between batches (default 0.5)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5433, help="Cloud SQL proxy port (default 5433)")
    ap.add_argument("--skip-resolve", action="store_true", help="do everything except `prisma migrate resolve`")
    args = ap.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set (export it from Secret Manager; never paste it into a file).", file=sys.stderr)
        return 2
    if not MIGRATION_SQL.exists():
        print(f"missing {MIGRATION_SQL}", file=sys.stderr)
        return 2

    db = Db(url, args.host, args.port)
    before = state(db)
    show("current state", before)

    if before["column"] == "generated":
        print("\ncontent_tsv is a legacy STORED generated column: Postgres maintains it, nothing to backfill.")
    if not args.execute:
        print("\nDRY RUN. Plan with --execute:")
        print(f"  1. bootstrap column + trigger (same DDL as migration.sql; lock_timeout {LOCK_TIMEOUT})")
        print(f"  2. backfill {before['nulls']} NULL rows in batches of {args.batch_size}, sleeping {args.sleep}s between batches")
        print(f"  3. CREATE INDEX CONCURRENTLY {INDEX} (if absent or INVALID)")
        print("  4. verify: 0 NULL rows, index valid, lexical query returns rows")
        print(f"  5. prisma migrate resolve --applied {MIGRATION}")
        return 0

    # 1. column + trigger. Same DDL as migration.sql, minus its backfill/index and
    #    minus its large-table guard: this script IS the large-table path.
    print("\n[1/5] bootstrapping column + trigger (catalog-only, lock_timeout " + LOCK_TIMEOUT + ") ...")
    db.exec(BOOTSTRAP_SQL, timeout=120)
    st = state(db)
    if st["column"] == "absent" or (st["column"] == "plain" and st["trigger"] != "enabled"):
        print(f"      unexpected state after migration.sql: {st}", file=sys.stderr)
        return 1
    print(f"      column={st['column']} trigger={st['trigger']}")

    # 2. batched backfill (skip for a generated column — Postgres already did it)
    if st["column"] == "plain":
        remaining = int(st["nulls"])
        print(f"\n[2/5] backfilling {remaining} rows, {args.batch_size} per batch ...")
        batch = 0
        t0 = time.time()
        while remaining > 0:
            batch += 1
            db.exec(
                f"SET lock_timeout = '{LOCK_TIMEOUT}'; "
                f"UPDATE {TABLE} SET {COLUMN} = to_tsvector('{CONFIG}', content) "
                f"WHERE id IN (SELECT id FROM {TABLE} WHERE {COLUMN} IS NULL LIMIT {args.batch_size});",
                timeout=300,
            )
            remaining = int(db.scalar(f"SELECT count(*) FROM {TABLE} WHERE {COLUMN} IS NULL;"))
            waiting = db.scalar("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database();")
            print(f"      batch {batch:3d}  remaining {remaining:6d}  lock-waiters {waiting}  {time.time()-t0:6.1f}s", flush=True)
            if int(waiting) > 0:
                print("      lock waiters present — pausing 5s before the next batch", flush=True)
                time.sleep(5)
            elif remaining > 0:
                time.sleep(args.sleep)
    else:
        print("\n[2/5] generated column — backfill not needed")

    # 3. concurrent index (never inside a transaction; psql -c autocommits)
    st = state(db)
    if st["index"] == "INVALID":
        print(f"\n[3/5] dropping INVALID {INDEX} left by an interrupted build ...")
        db.exec(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX};", timeout=600)
        st["index"] = "absent"
    if st["index"] == "absent":
        print(f"\n[3/5] CREATE INDEX CONCURRENTLY {INDEX} ... (does not block reads/writes; may take a few minutes)")
        t0 = time.time()
        db.exec(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {INDEX} ON {TABLE} USING GIN ({COLUMN});", timeout=3600)
        print(f"      built in {time.time()-t0:.1f}s")
    else:
        print(f"\n[3/5] index already {st['index']}")

    # 4. verify
    print("\n[4/5] verifying ...")
    st = state(db)
    hits = db.scalar(
        f"SELECT count(*) FROM {TABLE} c, websearch_to_tsquery('{CONFIG}', 'cancer treatment') q WHERE c.{COLUMN} @@ q;"
    )
    show("after", {**st, "lexical hits 'cancer treatment'": hits})
    problems = []
    if st["column"] == "plain" and int(st["nulls"]) != 0:
        problems.append(f"{st['nulls']} rows still NULL")
    if st["index"] != "valid":
        problems.append(f"index is {st['index']}")
    if int(hits) == 0:
        problems.append("lexical query returned 0 rows")
    if problems:
        print("\nNOT resolving the migration — problems: " + "; ".join(problems), file=sys.stderr)
        return 1

    # 5. prisma history
    if args.skip_resolve:
        print("\n[5/5] skipped (--skip-resolve)")
        return 0
    if st["prisma"] == "applied":
        print("\n[5/5] already recorded in _prisma_migrations")
        return 0
    print(f"\n[5/5] prisma migrate resolve --applied {MIGRATION} ...")
    r = subprocess.run(
        ["npx", "prisma", "migrate", "resolve", "--applied", MIGRATION],
        cwd=API_DIR,
        env={**os.environ, "DATABASE_URL": db.prisma_url()},
        capture_output=True,
        text=True,
        timeout=300,
    )
    print("      " + (r.stdout + r.stderr).strip().splitlines()[-1][:160])
    if r.returncode != 0:
        return 1
    # Proof that the file is now a no-op on this database (its large-table guard is
    # satisfied): a future `prisma migrate deploy` re-run cannot break anything.
    try:
        db.exec_file(MIGRATION_SQL, timeout=120)
        print("      migration.sql re-run: no-op OK")
    except RuntimeError as e:
        print("      WARNING: migration.sql re-run failed: " + str(e).splitlines()[0][:140], file=sys.stderr)
    print("\nDone. Check GET /v1/health/retrieval → fullTextSearch.status should be 'ok' (the boot probe re-runs on the next deploy or within the re-probe window).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
