# cloudbuild.gated.yaml — Known Issues

> **Status (Sep 2026)**: Old issues related to the evaluation gate (openai-api-key secret and build timeout) were resolved by removing the eval gate entirely.
> Issue 4 (check-schema-local validation) was resolved by switching to `prisma validate`.
> MIG updated to `20260913000000_kb_chunk_unique_position` (issue #86), in both
> `cloudbuild.gated.yaml` and the fallback default inside `migrate-with-repair.sh`.
> Issue 3 is now partly addressed: the script has a step (6) that asserts the
> `KbChunk_docId_chunkIndex_key` index exists, so a migration that did not apply
> — or that was wrongly marked applied by the repair path — fails the job.


## Summary

The gated pipeline (`cloudbuild.gated.yaml`) was built around a specific past migration
(`add_greeting_context_to_session`) and has several hardcoded assumptions that will silently
do the wrong thing as new migrations are added. Issues are documented here so we don't
rediscover them each deploy.

---

## Issue 1 — Wrong submission directory (operational footgun)

**What**: Both `cloudbuild.yaml` (simple) and `cloudbuild.gated.yaml` are submitted from `suchi_repo/` (repo root).

**Why**: The gated file uses `dir: 'apps/api'` in the `check-schema-local` step. That path
is relative to the Cloud Build workspace root, which is the directory you run
`gcloud builds submit` from. Both files use paths like `apps/api/Dockerfile` relative to repo root.

**Submit commands**:
```bash
# Simple deploy — from suchi_repo/
cd /home/gauta/suchi_repo
gcloud builds submit . --config=cloudbuild.yaml --project=gen-lang-client-0202543132

# Gated deploy — from suchi_repo/
cd /home/gauta/suchi_repo
gcloud builds submit . --config=cloudbuild.gated.yaml --project=gen-lang-client-0202543132
```

---

## Issue 2 — Stale MIG env var (repair path broken for new migrations)

**What**: The `update-migrate-job-image` step always sets:
```
MIG=20260913000000_kb_chunk_unique_position
```

**Why it matters**: `migrate-with-repair.sh` uses `MIG` in its fallback/repair path:
if `prisma migrate deploy` fails, it tries to mark that specific migration as resolved.
If the failing migration is actually a *new* one, the repair
step will mark the wrong migration as applied and the new one will stay broken.

**When it's harmless**: If `prisma migrate deploy` succeeds normally (the happy path),
`MIG` is never consulted. New migrations are applied correctly.

**Fix when adding a new migration**: Update the `--set-env-vars` line in
`update-migrate-job-image` to point `MIG` at the newest migration name. Or better yet,
remove the `MIG` env var from the job update and instead always use `prisma migrate deploy`
as the sole migration mechanism (removing the repair script entirely for future deploys).

---

## Issue 3 — Column check hardcoded for old migration

**What**: `migrate-with-repair.sh` checks for columns `userContext`, `cancerType`,
`greetingCompleted`, `emotionalState` — all from the greeting-context migration.

**Why it matters**: New migrations that create new tables (e.g. `SccfDocument`) are not
verified. If a new migration silently fails but `prisma migrate deploy` exits 0, the script
will report success even though the new table doesn't exist.

**Fix**: After a new migration is added, update the column/table check in the script to
include a representative column/table from the new migration.

**Partly done (Sep 2026, issue #86)**: `migrate-with-repair.sh` gained a step (6)
that runs unconditionally — not only on the repair branch — and asserts that
`KbChunk_docId_chunkIndex_key` (the `@@unique([docId, chunkIndex])` guard from
`20260913000000_kb_chunk_unique_position`) exists and is valid. This also covers
the repair path's own hazard: step (4) marks `$MIG` applied whenever the *column*
repair ran, which for an index-creating migration would record something untrue.
Extend the same pattern for the next migration rather than adding another
greeting-era column.

---

## Issue 4 (Resolved) — check-schema-local formats but doesn't validate

**What**: The `check-schema-local` step originally ran `npx prisma format` which reformatted the schema file but did NOT fail on semantic errors (e.g. referencing a non-existent model, invalid field types).

**Resolution**: This step was updated in `cloudbuild.gated.yaml` to run `npx prisma@5.22.0 validate` which performs semantic validation.

---

## Running a migration without the gated pipeline

If you need to apply a new migration without a full gated deploy, follow the manual production database migration procedure described in `docs/OPERATIONS_RUNBOOK.md` ("Production DB access (migrations, debugging)"). Do not run `prisma migrate dev` directly against the production database, as it will fail due to lack of shadow-database permissions.
