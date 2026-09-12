#!/usr/bin/env python3
"""
Production rollout of KbChunk full-text search (issue #92) as an EXPRESSION index
— no column, no backfill, no per-row writes.

WHY THIS SCRIPT EXISTS
  2026-09-12, two abandoned designs on suchi-db:
   * a STORED generated tsvector column rewrote the whole table under an ACCESS
     EXCLUSIVE lock (and rebuilt the pgvector HNSW index): 15-minute retrieval
     outage, terminated;
   * a plain column + trigger + batched backfill was non-blocking but each row
     update re-entered all four indexes incl. HNSW: 190 ms/row, ~2.5 h. Stopped.
  The expression index needs ONE concurrent build and touches no rows.

WHAT THIS SCRIPT DOES (each step short, interruptible or idempotent)
  1. Drops leftovers of the abandoned designs (trigger, function, plain column) —
     catalog-only, with a short lock_timeout.
  2. CREATE INDEX CONCURRENTLY kb_chunk_content_tsv_idx
       ON "KbChunk" USING GIN (to_tsvector('simple', content));
     (outside any transaction; does not block reads or writes; drops an INVALID
     leftover from an interrupted build first).
  3. Verifies: pg_index.indisvalid AND indisready; the index definition is over
     to_tsvector('simple'::regconfig, content); a real lexical search returns
     rows; EXPLAIN shows the planner using kb_chunk_content_tsv_idx.
  4. Marks migration 20260908000000_restore_kb_chunk_fts applied
     (`prisma migrate resolve`) — only after 1–3 succeeded — and re-runs
     migration.sql once to prove it is now a no-op on this database.

USAGE (repo root; Cloud SQL proxy on 127.0.0.1:5433 — docs/OPERATIONS_RUNBOOK.md §1, §4a):

    export DATABASE_URL="$(gcloud secrets versions access latest --secret=database-url)"
    python3 scripts/sql/kb_fts_safe_rollout.py             # dry run: state + plan
    python3 scripts/sql/kb_fts_safe_rollout.py --execute   # do it

  Low-traffic window preferred: the concurrent build scans the table (CPU/IO)
  but takes no blocking lock. The password is never printed. Re-running is safe.
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
INDEX = "kb_chunk_content_tsv_idx"
CONFIG = "simple"
EXPRESSION = f"to_tsvector('{CONFIG}', content)"
INDEXDEF_MARKER = f"to_tsvector('{CONFIG}'::regconfig, content)"
LEGACY_TRIGGER = "kbchunk_content_tsv_trg"
LEGACY_FUNCTION = "kbchunk_content_tsv_maintain"
LEGACY_COLUMN = "content_tsv"
LOCK_TIMEOUT = "5s"


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

    def scalar(self, sql: str, timeout: int = 120) -> str:
        r = subprocess.run(self._base() + ["-At", "-c", sql], env=self._env(), capture_output=True, text=True, timeout=timeout)
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
        "legacy_column": f"SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('{TABLE}') AND attname = '{LEGACY_COLUMN}' AND NOT attisdropped) THEN 'present' ELSE 'absent' END;",
        "legacy_trigger": f"SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('{TABLE}') AND tgname = '{LEGACY_TRIGGER}') THEN 'present' ELSE 'absent' END;",
        "index": (
            "SELECT coalesce((SELECT CASE WHEN i.indisvalid AND i.indisready THEN 'valid' ELSE 'INVALID' END "
            f"FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '{INDEX}'), 'absent');"
        ),
        # The marker contains single quotes ('simple'::regconfig): double them inside the SQL literal.
        "index_expr_ok": f"SELECT coalesce((SELECT (indexdef LIKE '%{INDEXDEF_MARKER.replace(chr(39), chr(39) * 2)}%')::text FROM pg_indexes WHERE indexname = '{INDEX}'), 'n/a');",
        "prisma": f"SELECT coalesce((SELECT 'applied' FROM _prisma_migrations WHERE migration_name = '{MIGRATION}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1), 'not recorded');",
        "lock_waiters": "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database();",
    }
    out: dict[str, str] = {}
    for k, sql in q.items():
        try:
            out[k] = db.scalar(sql)
        except RuntimeError as e:
            first = str(e).splitlines()[0] if str(e) else "error"
            out[k] = f"? ({first[:80]})"
    return out


def show(title: str, st: dict[str, str]) -> None:
    print(f"\n== {title} ==")
    for k, v in st.items():
        print(f"  {k:15} {v}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--execute", action="store_true", help="actually change the database (default: dry run)")
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

    if not args.execute:
        print("\nDRY RUN. Plan with --execute:")
        print(f"  1. drop legacy trigger/function/column if present (lock_timeout {LOCK_TIMEOUT}; catalog-only)")
        print(f"  2. CREATE INDEX CONCURRENTLY {INDEX} ON {TABLE} USING GIN ({EXPRESSION})  (if absent or INVALID)")
        print("  3. verify: index valid + over the expected expression; live search hits; EXPLAIN uses the index")
        print(f"  4. prisma migrate resolve --applied {MIGRATION}; re-run migration.sql as a no-op proof")
        return 0

    # 1. legacy leftovers
    print("\n[1/4] dropping legacy objects if present (catalog-only) ...")
    db.exec(
        f"SET lock_timeout = '{LOCK_TIMEOUT}'; "
        f"DROP TRIGGER IF EXISTS {LEGACY_TRIGGER} ON {TABLE}; "
        f"DROP FUNCTION IF EXISTS {LEGACY_FUNCTION}(); "
        + (f"DROP INDEX IF EXISTS {INDEX}; ALTER TABLE {TABLE} DROP COLUMN IF EXISTS {LEGACY_COLUMN};" if before["legacy_column"] == "present" else ""),
        timeout=120,
    )
    st = state(db)
    print(f"      legacy_column={st['legacy_column']} legacy_trigger={st['legacy_trigger']}")

    # 2. concurrent expression index
    if st["index"] == "INVALID" or (st["index"] == "valid" and st["index_expr_ok"] != "true"):
        print(f"\n[2/4] dropping {INDEX} ({st['index']}, expr_ok={st['index_expr_ok']}) before rebuilding ...")
        db.exec(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX};", timeout=600)
        st["index"] = "absent"
    if st["index"] == "absent":
        print(f"\n[2/4] CREATE INDEX CONCURRENTLY {INDEX} ... (no blocking lock; scans the table once or twice)")
        t0 = time.time()
        db.exec(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {INDEX} ON {TABLE} USING GIN ({EXPRESSION});", timeout=3600)
        print(f"      built in {time.time()-t0:.1f}s")
    else:
        print(f"\n[2/4] index already {st['index']} over the expected expression")

    # 3. verify
    print("\n[3/4] verifying ...")
    st = state(db)
    hits = db.scalar(f"SELECT count(*) FROM {TABLE} c WHERE {EXPRESSION.replace('content', 'c.content')} @@ websearch_to_tsquery('{CONFIG}', 'cancer treatment');")
    plan = db.scalar(
        f"EXPLAIN (COSTS OFF) SELECT c.id FROM {TABLE} c, websearch_to_tsquery('{CONFIG}', 'cancer treatment') q "
        f"WHERE {EXPRESSION.replace('content', 'c.content')} @@ q LIMIT 12;"
    )
    uses_index = INDEX in plan
    show("after", {**st, "lexical hits 'cancer treatment'": hits, "planner uses index": str(uses_index)})
    problems = []
    if st["index"] != "valid":
        problems.append(f"index is {st['index']}")
    if st["index_expr_ok"] != "true":
        problems.append("index is not over the expected expression")
    if int(hits) == 0:
        problems.append("lexical query returned 0 rows")
    if not uses_index:
        problems.append(f"planner did not use {INDEX} — plan: {plan[:200]}")
    if problems:
        print("\nNOT resolving the migration — problems: " + "; ".join(problems), file=sys.stderr)
        return 1

    # 4. prisma history + no-op proof
    if args.skip_resolve:
        print("\n[4/4] skipped (--skip-resolve)")
        return 0
    if st["prisma"] != "applied":
        print(f"\n[4/4] prisma migrate resolve --applied {MIGRATION} ...")
        r = subprocess.run(
            ["npx", "prisma", "migrate", "resolve", "--applied", MIGRATION],
            cwd=API_DIR, env={**os.environ, "DATABASE_URL": db.prisma_url()},
            capture_output=True, text=True, timeout=300,
        )
        print("      " + (r.stdout + r.stderr).strip().splitlines()[-1][:160])
        if r.returncode != 0:
            return 1
    else:
        print("\n[4/4] already recorded in _prisma_migrations")
    try:
        db.exec_file(MIGRATION_SQL, timeout=120)
        print("      migration.sql re-run: no-op OK")
    except RuntimeError as e:
        print("      WARNING: migration.sql re-run failed: " + str(e).splitlines()[0][:140], file=sys.stderr)
        return 1
    print("\nDone. GET /v1/health/retrieval → fullTextSearch.status should read 'ok' on a revision that ships the expression-index probe.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
