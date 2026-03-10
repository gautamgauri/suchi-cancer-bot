# cloudbuild.gated.yaml — Known Issues

> **Status (Feb 2026)**: Issues 4 and 5 resolved by removing the eval gate entirely.
> Issues 6 resolved by switching check-schema-local to `prisma validate`.
> MIG updated to `sccf_document_index`. See git history for the old eval-based version.


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
# Simple deploy (no eval gate) — from suchi_repo/
cd /home/gauta/suchi_repo
gcloud builds submit . --config=cloudbuild.yaml --project=gen-lang-client-0202543132

# Gated deploy (with eval gate) — from suchi_repo/
cd /home/gauta/suchi_repo
gcloud builds submit . --config=cloudbuild.gated.yaml --project=gen-lang-client-0202543132
```

---

## Issue 2 — Stale MIG env var (repair path broken for new migrations)

**What**: The `update-migrate-job-image` step always sets:
```
MIG=20250101000000_add_greeting_context_to_session
```

**Why it matters**: `migrate-with-repair.sh` uses `MIG` in its fallback/repair path:
if `prisma migrate deploy` fails, it tries to mark that specific migration as resolved.
If the failing migration is actually a *new* one (e.g. `sccf_document_index`), the repair
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

---

## Issue 4 — openai-api-key secret must exist in Secret Manager

**What**: `eval-tier1` step has:
```yaml
secretEnv: ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']
```
And `availableSecrets` references `openai-api-key:latest`.

**Why it matters**: Cloud Build fails the step if any referenced secret version doesn't
exist — even if the env var is never read. If `openai-api-key` secret was never created in
Secret Manager (it's optional for Suchi which defaults to Gemini/DeepSeek), the entire
eval step fails immediately.

**Check**:
```bash
gcloud secrets versions access latest --secret=openai-api-key --project=gen-lang-client-0202543132
```

**Fix**: Either create a placeholder secret (`echo -n "placeholder" | gcloud secrets create openai-api-key --data-file=-`),
or remove `OPENAI_API_KEY` from `secretEnv` and `availableSecrets` in the gated yaml.

---

## Issue 5 — Build timeout too tight for the full pipeline

**What**: Overall build timeout is `1800s` (30 min). The `eval-tier1` step alone has a
`1200s` (20 min) timeout.

**Typical timing**:
- Build + push Docker images: ~8–12 min
- Migrate job: ~1–2 min
- Deploy candidate: ~1 min
- Healthcheck (up to 5 min per retry loop): ~1–3 min
- Eval tier1: up to 20 min
- Promote + build/deploy web: ~5 min

**Total worst case**: ~41 min > 30 min timeout → build killed before web is deployed.

**Fix**: Increase `timeout` to `2700s` (45 min) or parallelize web build with eval
(web build doesn't depend on eval result — it can run while eval is running).

---

## Issue 6 — check-schema-local formats but doesn't validate

**What**: The `check-schema-local` step runs `npx prisma format` and exits 0.

**Why it matters**: `prisma format` reformats the schema file — it does NOT fail on
semantic errors (e.g. referencing a non-existent model, invalid field types). The step
is labelled "schema validation" but only catches the most basic parse failures.

**Fix (optional)**: Replace with `npx prisma validate` which does actual semantic
validation without needing a DB connection.

---

## Running a migration without the gated pipeline

If you need to apply a new migration (e.g. `sccf_document_index`) without a full gated
deploy, use Cloud SQL proxy locally:

```bash
# Terminal 1 — start proxy
cloud-sql-proxy gen-lang-client-0202543132:us-central1:suchi-db \
  --credentials-file ~/.config/gcloud/legacy_credentials/suchi-scheduler@gen-lang-client-0202543132.iam.gserviceaccount.com/adc.json \
  --port 5432

# Terminal 2 — run migration
cd /home/gauta/suchi_repo/apps/api
DATABASE_URL="postgresql://postgres:<PASSWORD>@localhost:5432/suchi?schema=public" \
  npx prisma migrate dev --name sccf_document_index
```

Password is in GCP Secret Manager:
```bash
gcloud secrets versions access latest --secret=database-url --project=gen-lang-client-0202543132
```
(The full `DATABASE_URL` is stored as a secret — extract just the password from it.)
