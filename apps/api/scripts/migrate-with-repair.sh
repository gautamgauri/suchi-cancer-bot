#!/bin/sh
set -e

# Use MIG env var if set, otherwise default to the newest migration name.
# Keep this in sync with the MIG value in cloudbuild.gated.yaml whenever a
# migration is added (docs/cloudbuild-gated-issues.md, Issue 2).
MIG="${MIG:-20260913000000_kb_chunk_unique_position}"

echo "=== (1) Attempt prisma migrate deploy ==="
if ! npx prisma migrate deploy; then
  echo "migrate deploy failed (will attempt idempotent repair + resolve)."
fi

echo "=== (2) Check required columns ==="
# Temporarily disable set -e to capture exit code without terminating script
set +e
status=1
attempt=1
max_attempts=3
delay=2

while [ $attempt -le $max_attempts ]; do
  node - << "NODE"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const required = ["userContext","cancerType","greetingCompleted","emotionalState"];

async function missingCols() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Session'
    `;
    const have = new Set(rows.map(r => r.column_name));
    return required.filter(c => !have.has(c));
  } finally {
    await prisma.$disconnect();
  }
}

(async () => {
  const missing = await missingCols();
  console.log("Missing columns:", missing.length ? missing.join(", ") : "(none)");
  process.exit(missing.length ? 2 : 0);
})().catch(e => { console.error(e); process.exit(1); });
NODE
  status=$?
  if [ $status -eq 0 ] || [ $status -eq 2 ]; then
    break
  fi
  if [ $attempt -lt $max_attempts ]; then
    echo "Attempt $attempt failed (exit $status), retrying in ${delay}s..."
    sleep $delay
    attempt=$((attempt + 1))
  else
    echo "All $max_attempts attempts failed (last exit: $status)"
    break
  fi
done
set -e

if [ "$status" -eq 2 ]; then
  echo "=== (3) Apply idempotent SQL to add missing columns ==="
  attempt=1
  while [ $attempt -le 3 ]; do
    if node - << "NODE"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stmts = [
  'ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "userContext" TEXT',
  'ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "cancerType" TEXT',
  'ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "greetingCompleted" BOOLEAN NOT NULL DEFAULT false',
  'ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "emotionalState" TEXT',
];
(async () => {
  try {
    for (const s of stmts) {
      await prisma.$executeRawUnsafe(s);
    }
    console.log("Idempotent ALTERs applied.");
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e); process.exit(1); });
NODE
    then
      break
    fi
    if [ $attempt -lt 3 ]; then
      echo "Attempt $attempt failed, retrying in 2s..."
      sleep 2
      attempt=$((attempt + 1))
    else
      echo "Failed to apply idempotent SQL after 3 attempts"
      exit 1
    fi
  done

  echo "=== (4) Ensure migration is marked applied (only if not already) ==="
  set +e
  rstatus=1
  attempt=1
  while [ $attempt -le 3 ]; do
    node - << NODE
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const MIG = "${MIG}";
(async () => {
  try {
    const rows = await prisma.\$queryRawUnsafe(
      'SELECT COUNT(*)::int AS c FROM "_prisma_migrations" WHERE migration_name = \$1',
      MIG
    );
    const count = rows?.[0]?.c ?? 0;
    console.log("Migration record count:", count);
    process.exit(count > 0 ? 0 : 2);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e); process.exit(1); });
NODE
    rstatus=$?
    if [ $rstatus -eq 0 ] || [ $rstatus -eq 2 ]; then
      break
    fi
    if [ $attempt -lt 3 ]; then
      echo "Attempt $attempt failed (exit $rstatus), retrying in 2s..."
      sleep 2
      attempt=$((attempt + 1))
    else
      break
    fi
  done
  set -e
  if [ "$rstatus" -eq 2 ]; then
    echo "Marking migration as applied..."
    npx prisma migrate resolve --applied "$MIG"
  fi

  echo "=== (5) Re-check required columns ==="
  attempt=1
  final_status=1
  while [ $attempt -le 3 ]; do
    if node - << "NODE"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const required = ["userContext","cancerType","greetingCompleted","emotionalState"];
(async () => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Session'
    `;
    const have = new Set(rows.map(r => r.column_name));
    const missing = required.filter(c => !have.has(c));
    if (missing.length) {
      console.error("Still missing columns after repair:", missing.join(", "));
      process.exit(1);
    }
    console.log("All required columns present.");
    process.exit(0);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e); process.exit(1); });
NODE
    then
      final_status=0
      break
    fi
    final_status=$?
    if [ $attempt -lt 3 ]; then
      echo "Attempt $attempt failed (exit $final_status), retrying in 2s..."
      sleep 2
      attempt=$((attempt + 1))
    else
      echo "❌ Final column check failed after 3 attempts!"
      exit 1
    fi
  done
fi

echo "=== (6) Verify KbChunk unique position index (issue #86) ==="
# Issue 3 in docs/cloudbuild-gated-issues.md: steps (2)-(5) only ever checked the
# greeting-context columns, so a migration that silently failed to apply could
# still exit 0. This is the structural check for the newest migration.
#
# It also closes the hazard the repair path itself creates: step (4) marks $MIG
# applied when the *column* repair ran, which for a migration that creates an
# index would record a lie. Asserting the index exists makes that loud instead.
# `KbChunk_docId_chunkIndex_key` is what makes a duplicate ingest a 23505
# instead of a silent 34% duplicate index (73,802 -> 48,737 rows, cleaned
# 2026-09-06). If the migration RAISEd because duplicates are back, the deploy
# must fail here rather than serve a degraded KB.
# Temporarily disable set -e (as step (2) does) so a transient Cloud SQL error
# from `node` does not terminate the job before $? is captured and before the
# retries below ever run.
set +e
attempt=1
kb_idx_status=1
kb_max_attempts=3
kb_delay=2

while [ $attempt -le $kb_max_attempts ]; do
  node - << "NODE"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(bool_and(i.indisvalid AND i.indisready AND i.indisunique), false) AS ok
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'KbChunk_docId_chunkIndex_key'`
    );
    const ok = rows?.[0]?.ok === true;
    if (!ok) {
      console.error(
        "KbChunk_docId_chunkIndex_key is MISSING or invalid. Migration " +
        "20260913000000_kb_chunk_unique_position did not apply. If it raised, the table " +
        "holds duplicate (docId, chunkIndex) rows again: see scripts/sql/kb_duplicate_cleanup.sql (issue #86)."
      );
      process.exit(2);
    }
    console.log("KbChunk unique position index present and valid.");
    process.exit(0);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e); process.exit(1); });
NODE
  kb_idx_status=$?
  # 0 = index present and valid, 2 = index genuinely missing/invalid. Both are
  # verdicts, not connectivity failures, so neither is retried. Anything else
  # (1 = driver/connection error) gets another attempt.
  if [ $kb_idx_status -eq 0 ] || [ $kb_idx_status -eq 2 ]; then
    break
  fi
  if [ $attempt -lt $kb_max_attempts ]; then
    echo "Attempt $attempt failed (exit $kb_idx_status), retrying in ${kb_delay}s..."
    sleep $kb_delay
    attempt=$((attempt + 1))
  else
    echo "All $kb_max_attempts attempts failed (last exit: $kb_idx_status)"
    break
  fi
done
set -e

if [ "$kb_idx_status" -ne 0 ]; then
  echo "❌ KbChunk unique position index check failed!"
  exit 1
fi

echo "Migration job completed successfully."
