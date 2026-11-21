# Suchi operations runbook

This is the single operational document for Suchi. If another document disagrees with it, treat this one as correct and fix the other.

Agents may run the read-only commands here. A deploy, a traffic change, a migration or a secret change needs the maintainer's approval each time (`AGENTS.md` section 1).

Items marked **TO CONFIRM** could not be verified from the repository. Check them against production before relying on them, then remove the marker.

Production facts in this document were read on 21 November 2026. The repository is public, so this file holds names and identifiers only. It must never hold a secret value, a billing account ID, a phone number or user text.

## 1. Fixed facts

| Item | Value |
|---|---|
| GCP project | `gen-lang-client-0202543132` |
| Region | `us-central1` |
| API service | `suchi-api` on Cloud Run. 512 Mi, 1 CPU always allocated, 0 to 2 instances, 300 second timeout (`cloudbuild.yaml`). |
| API probe | TCP startup probe on port 8080. The live service has no HTTP probe. |
| Web service | `suchi-web` on Cloud Run, 256 Mi |
| API URL | `https://suchi-api-lxiveognla-uc.a.run.app/v1` |
| Web chat | `https://chat.suchitracancercare.org` |
| Site | `https://suchitracancercare.org`, built from `apps/landing` and served by GitHub Pages |
| Database | Cloud SQL instance `suchi-db`, PostgreSQL with pgvector, tier `db-g1-small`, backups enabled. It has a public IP limited to authorised networks. People connect through the Cloud SQL proxy. |
| Database connections | 5 per API instance (`apps/api/src/modules/prisma/prisma.service.ts`), so 10 at most from the API. TO CONFIRM the connection limit of the current tier. |
| Buckets | `suchi-tts-audio`, `suchi-navigator-state`, `suchi-public-assets` |
| Scheduler identity | `suchi-scheduler@gen-lang-client-0202543132.iam.gserviceaccount.com` |
| LLM | Gemini only. `LLM_PROVIDER=gemini` with `GEMINI_API_KEY` mounted, so calls go to the Google AI API. |
| Embeddings | `EMBEDDING_MODEL=gemini-embedding-001`, 768 dimensions |
| Tracing | Langfuse at `https://us.cloud.langfuse.com` |

Comments in `cloudbuild.yaml` and `eval-tier1.yml` still describe the database as `db-f1-micro` with 25 connections. Those comments were written before the tier changed.

State of production on 21 November 2026.

| Item | Value |
|---|---|
| Serving revision | `suchi-api-00429-zzn`, 100% of traffic |
| Deployed | 12 October 2026, from `main` at `e1172ef` |
| Other tags | `candidate` and `flashlite`, each on another revision with no traffic |

Update this table after every deploy.

## 2. Is production healthy?

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://suchi-api-lxiveognla-uc.a.run.app/v1/health
curl -s https://suchi-api-lxiveognla-uc.a.run.app/v1/health
curl -s https://suchi-api-lxiveognla-uc.a.run.app/v1/health/retrieval
gh run list --workflow eval-tier1.yml --limit 5
```

`/v1/health` reports its state in the response body.

| Body `status` | Meaning | HTTP code |
|---|---|---|
| `ok` | Database reachable and hospital directory loaded | 200 |
| `degraded` | Database reachable, hospital directory missing from the image | 200 |
| `error` | Application running, database unreachable | 503 from the revision that carries PR #247. 200 on earlier revisions, including `suchi-api-00429-zzn`. |

Always read the body. A probe that reads only the status code is reliable only after the PR #247 change is deployed.

PR #247 also adds two things. This runbook describes them as they will be once that pull request is merged and deployed.

- `GET /v1/health/live` answers 200 whenever the process serves HTTP. It touches no dependency. It tells you the container is up and nothing more.
- `.github/workflows/uptime.yml` requests `/v1/health` and the web chat every 15 minutes. Each run tries each surface three times, 20 seconds apart, and fails if either one stays down. A red run in `gh run list --workflow uptime.yml` means a surface was unreachable for that run.
  - The outage email goes out only after two failed runs in a row. The first email therefore arrives 15 to 30 minutes after the fault begins, or later if GitHub starts the run late.
  - A single failed run sends no email. Failures that alternate with passing runs send no email either, because each passing run resets the count. Read the run history when you suspect a flapping surface.
  - The email is sent once per outage. If a send fails, the next failed run tries again. A long outage gets a reminder about every seven and a half hours.
  - If the run history cannot be read, the first failed run sends the email.
  - One recovery email follows the first passing run, and only if an outage email was delivered.

A 503 whose body is the Google page "The service you requested is not available yet" comes from Google's front end. The application did not answer. Go to section 3.

`/v1/health/retrieval` returns 503 by design when full-text search is unavailable. Chat still answers from vector search with weaker ranking. This is a degradation and can wait for working hours.

Other signals.

- Langfuse holds a trace for each LLM request while `LANGFUSE_ENABLED=true`, which `cloudbuild.yaml` sets.
- Each instance logs its build ID, latest migration and a database fingerprint at start (`apps/api/src/main.ts`). Use these lines to confirm which build and schema a revision runs.

## 3. Outage response

Work down the steps. Stop at the first one that explains the fault.

**Step 1. Record what users see.** Note the time, the URL, the HTTP code and the response body. Check the web chat and send one WhatsApp message.

**Step 2. Check billing.** Do this first whenever the 503 comes from Google's front end.

```bash
gcloud billing projects describe gen-lang-client-0202543132
gcloud billing accounts describe <ACCOUNT_ID> --format='value(open)'
```

The first command prints `billingEnabled` for the project and the name of its billing account. The second prints `True` for an open account. If billing is disabled or the account is closed, nothing else in this runbook will help until the maintainer settles the account. See the incident record at the end of this section for the signs.

**Step 3. Find the serving revision and whether it starts.**

```bash
gcloud run services describe suchi-api --region us-central1 \
  --project gen-lang-client-0202543132 \
  --format 'yaml(status.traffic,status.latestReadyRevisionName,status.latestCreatedRevisionName,status.conditions)'
gcloud run revisions list --service suchi-api --region us-central1 --project gen-lang-client-0202543132 --limit 5
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=suchi-api AND severity>=ERROR' \
  --project gen-lang-client-0202543132 --limit 30 --freshness 1h
```

Cloud Run can report the service as Ready while every request fails. It did so throughout the outage of 21 November 2026. A Ready condition proves little.

**Step 4. Match the evidence to a known failure.**

| Evidence | Likely cause | Action |
|---|---|---|
| 503 from Google's front end with the body "The service you requested is not available yet". Logs say "The request failed because billing is disabled for this project". | The billing account is closed or billing is disabled | Step 2. The maintainer reopens and pays the account. No redeploy is needed. |
| Latest created revision differs from latest ready revision, or a recent build failed at the deploy step | A secret named in `--set-secrets` does not exist or cannot be read. Cloud Run resolves every reference at deploy time. | Run `gcloud secrets describe <NAME> --project gen-lang-client-0202543132` for each name in `cloudbuild.yaml`. Names are case-sensitive. Create or fix the secret, then redeploy. |
| Container exits at start with a validation error | A required variable is missing (`DATABASE_URL`, `ADMIN_BASIC_USER`, `ADMIN_BASIC_PASS`), or neither `GEMINI_API_KEY` nor `GOOGLE_CLOUD_PROJECT` is set | Roll back (section 5). Fix `cloudbuild.yaml`. |
| Features missing after a deploy, such as emails, social posts or WhatsApp replies | A deploy ran from a stale env or secret list. Deploy flags replace the whole configuration. | Roll back to the previous revision, which carries its own configuration. |
| Health body says `error`, or logs show `remaining connection slots are reserved` or pool timeouts | Database out of connections or short of memory | Step 5 |
| `/v1/health` times out, chat returns 504, database CPU is high | A long statement or a table rewrite holds a lock on `KbChunk` | Step 5 |
| Health body says `degraded` | Hospital directory missing from the image | Redeploy with `cloudbuild.yaml`. Its first step stages the file and fails the build if it is absent. |
| WhatsApp replies slow or missing while web chat works | CPU throttling was switched back on, or the turn timed out | Confirm the revision has `--no-cpu-throttling`. Read the logs for the turn. |
| Logs show "Error generating embedding" | The embedding call to Gemini is failing. Chat still answers from keyword search alone, with vector scores of zero. | Check billing (step 2) and the `EMBEDDING_API_KEY` and `GEMINI_API_KEY` secrets. |
| Everything healthy and the nightly eval is red | See section 8 | |

**Step 5. Database.**

```bash
gcloud sql instances describe suchi-db --project gen-lang-client-0202543132 \
  --format 'value(state,settings.tier)'
```

Open a proxy session (section 6) and run two queries in `psql`.

```sql
SELECT pid, now() - query_start AS running, state, left(query, 80)
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start;

SELECT count(*) FROM pg_stat_activity;
```

A cancelled DDL statement rolls back cleanly. Use `SELECT pg_terminate_backend(<pid>);` on the blocking statement. If connections are exhausted and nothing is blocking, the API instances need to restart. TO CONFIRM the restart command the maintainer prefers.

Check that nothing else is loading the database. The tier 1 eval sends about 70 chat requests to production. On 12 October 2026 one eval run was the only traffic on production when the database went into swap. Cancel a running eval with `gh run cancel <id>`.

**Step 6. Roll back if a deploy preceded the fault.** See section 5.

**Step 7. Afterwards.** Add a dated entry to `docs/RELIABILITY_BACKLOG.md` with the cause, the duration and the fix. Add the failure to the table in step 4 if it is new.

### Incident record, 21 November 2026

- Production was unavailable from 07:25 UTC to about 14:34 UTC.
- The cause was the Google Cloud billing account. It had been closed for an unpaid balance.
- Cloud Run reported the service as Ready throughout.
- Requests failed with a 503 from Google's front end. The body read "The service you requested is not available yet". The log line read "The request failed because billing is disabled for this project".
- No alert was raised. The uptime workflow described in section 2 did not exist yet.
- The maintainer reopened and paid the account. No redeploy was needed.

Recovery took minutes and was uneven.

- The default service URLs returned 503 in spells for at least 25 minutes after the account was reopened. Tagged revision URLs answered during that time.
- Gemini embedding calls returned 403 with "Your billing account has an outstanding balance" for a few minutes. Chat answered from keyword search alone in that period, with vector scores of zero.

After any billing recovery, do three things.

1. Send a real chat turn through the web chat and read the answer. A green health check is too weak a test.
2. Search the logs for failed embedding calls.
3. Repeat both after 30 minutes.

```bash
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=suchi-api AND textPayload:"Error generating embedding"' \
  --project gen-lang-client-0202543132 --limit 20 --freshness 1h
```

## 4. Deploy

Cloud Build is the only deployer of `suchi-api`. The GitHub workflow `deploy-api.yml` verifies and does not deploy. The web service has two deployers. `deploy-web.yml` deploys `suchi-web` on every push to `main` that touches `apps/web/`, and `cloudbuild.yaml` deploys it again with each API build.

`--set-env-vars` and `--set-secrets` replace the whole Cloud Run configuration. Never run `gcloud run deploy` by hand with those flags, and never deploy `suchi-api` from any script other than `cloudbuild.yaml`. A stale list removes every variable it omits.

1. Be on `main`, up to date, with a clean tree. `git status --short` must print nothing. `gcloud builds submit` uploads the working directory as it stands, so uncommitted changes would reach production.
2. Confirm CI is green on the commit. The checks are named `API unit tests` and `Build + config parity`.
3. If the change adds an env var or a secret, confirm it is in `apps/api/src/config/env.validation.ts`, `cloudbuild.yaml` and `cloudbuild.gated.yaml`. For a new secret run `gcloud secrets describe <NAME> --project gen-lang-client-0202543132` and compare the name letter by letter.
4. If the change includes a migration, apply it first (section 6).
5. Run the preflight with `/deploy preflight-only`, or let `/deploy` run it.
6. Build and deploy.

```bash
gcloud builds submit --config=cloudbuild.yaml . --project gen-lang-client-0202543132
```

7. Promote. Traffic is assigned to a named revision, so a new revision receives no traffic until it is promoted.

Take the revision name from the output of your own build. The `deploy-api` step prints a line of the form `Service [suchi-api] revision [<REVISION>] has been deployed`. Do not promote whichever revision is newest in a list. Another build, or a revision that failed to start, may be newer. Check that the revision runs your build's image, then promote it.

```bash
gcloud run revisions describe <REVISION> --region us-central1 --project gen-lang-client-0202543132 \
  --format 'value(spec.containers[0].image)'   # must end in :<BUILD_ID> of your build
gcloud run services update-traffic suchi-api --region us-central1 --project gen-lang-client-0202543132 \
  --to-revisions <REVISION>=100
```

8. Verify. `/v1/health` must return `"status":"ok"`. Send one web chat message and one WhatsApp message. Read the startup log lines for the build ID and the latest migration.
9. Update the production state table in section 1.

The gated pipeline (`cloudbuild.gated.yaml`) adds a migration job, a candidate revision at 0% traffic and a health gate. It is not in use. Its migration name is hard-coded and must be updated whenever a migration is added. Before any use, compare its service flags with `cloudbuild.yaml` and read `docs/cloudbuild-gated-issues.md`.

## 5. Roll back

Cloud Run keeps earlier revisions. A rollback is a traffic change and needs no rebuild.

```bash
gcloud run revisions list --service=suchi-api --region=us-central1 --project gen-lang-client-0202543132
gcloud run services update-traffic suchi-api --region=us-central1 --project gen-lang-client-0202543132 --to-revisions=<GOOD_REVISION>=100
curl -s https://suchi-api-lxiveognla-uc.a.run.app/v1/health
```

A revision carries its own env and secret references, so a rollback also restores the earlier configuration. This is the remedy when a deploy ran from a stale env or secret list.

Migrations do not roll back. There are no down-migrations here, and undoing a schema change needs a new forward migration. Before moving traffic to an older image, read the migration that shipped with the newer one in `apps/api/prisma/migrations/`. An additive migration is safe to leave in place.

The same commands work for `suchi-web`, with one extra step afterwards. `update-traffic --to-revisions` pins the service to that revision. `deploy-web.yml` deploys with no traffic flag, so while the pin holds, each later automatic web deploy creates a revision at 0% traffic. Its verify step still passes, because it reads the service URL, which the old revision answers. Once the fix is merged to `main`, release the pin so that the newest revision takes traffic again.

```bash
gcloud run services update-traffic suchi-web --region us-central1 --project gen-lang-client-0202543132 --to-latest
```

For the landing site, revert the commit and let `deploy-landing.yml` run again.

## 6. Database access and migrations

`npx prisma migrate dev` fails against production with error P3014, because the application user cannot create a shadow database. Do not use it.

### Connecting

Use the Cloud SQL proxy against `gen-lang-client-0202543132:us-central1:suchi-db`. The connection string is in Secret Manager under `database-url`.

```bash
# Terminal 1
cloud-sql-proxy gen-lang-client-0202543132:us-central1:suchi-db --port 5433
# Terminal 2. The stored URL uses the Cloud SQL socket, so the host must be rewritten for local use.
export DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5433/<database>'
```

TO CONFIRM against a real run. The proxy port 5433 matches the default in `scripts/sql/kb_fts_safe_rollout.py`. The exact local URL form has not been checked.

### Applying a migration by hand

This is the working route. The commands below are TO CONFIRM against a real run before first use.

```bash
cd apps/api
# 1. Write the migration SQL by hand into prisma/migrations/<timestamp>_<name>/migration.sql and commit it.
# 2. Produce or check the SQL against the difference between the live database and the schema.
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
# 3. Review the SQL, then apply the migration file through the proxy.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/<timestamp>_<name>/migration.sql
# 4. Record it as applied.
npx prisma migrate resolve --applied <timestamp>_<name>
# 5. Check.
npx prisma migrate status
```

Two cautions.

- `prisma migrate diff` will propose `DROP INDEX` for `kb_chunk_content_tsv_idx`, because Prisma cannot express an expression index. Never apply that line. Removing the index is how full-text search stopped working in June 2026 (`apps/api/prisma/schema.prisma`, issue #92).
- TO CONFIRM that `_prisma_migrations` in production lists all eleven tracked migrations. `docs/CAPABILITY_LEDGER.md` recorded a diverged history in September 2026.

The repository also holds `scripts/migrate-prod.sh`, which executes the Cloud Run job `suchi-db-migrate`. That job belongs to the gated pipeline. TO CONFIRM that it exists and is current before using it.

### Schema changes on `KbChunk`

`KbChunk` holds about 74,000 rows. Each has roughly 1.4 KB of text and a 768 dimension `embedding` vector, and the table has a pgvector HNSW index. Any statement that rewrites the table is a production outage. The rewrite runs under an ACCESS EXCLUSIVE lock and rebuilds every index.

On 12 September 2026 an `ALTER TABLE "KbChunk" ADD COLUMN ... GENERATED ALWAYS ... STORED` ran for over 15 minutes. Twenty retrieval queries queued behind it, the connection pool filled, `/v1/health` stopped answering and chat turns timed out until the statement was terminated.

Statements that rewrite the table are these.

- Adding a column with a volatile or non-null default
- Adding a STORED generated column
- Changing a column type
- `VACUUM FULL` and `CLUSTER`

The safe pattern, which migration `20260908000000_restore_kb_chunk_fts` follows, is this.

1. Start with `SET lock_timeout = '5s';`. A change that cannot get its lock then aborts and does not queue behind a long transaction.
2. Add the column plain and nullable with no default. This changes the catalogue only.
3. Install any maintenance trigger before backfilling, so rows written during the backfill are covered.
4. Backfill in small committed batches of 1,000 to 2,000 rows with a short pause between them. Watch database CPU, connections and lock waiters.
5. Build the index after the backfill with `CREATE INDEX CONCURRENTLY`, outside any transaction. A Prisma migration cannot contain that statement.
6. Verify that no row has a null in the new column, that `pg_index.indisvalid` is true and that a live query works. Only then run `prisma migrate resolve --applied <migration>`.

Full-text search follows the rule by having no column at all. The lexical arm is a GIN expression index, `kb_chunk_content_tsv_idx`, over `to_tsvector('simple', content)`, and the query uses the identical expression. Nothing is written to any row. A missing index makes lexical search slower and never wrong. Two column designs were tried on 12 September 2026 and abandoned. The STORED generated column caused the outage above. A trigger-maintained column cost 190 ms per backfilled row, because every updated row re-enters the HNSW index.

Migration `20260908000000_restore_kb_chunk_fts` enforces this. On a table with more than 5,000 rows it raises an error unless the expression index already exists and is valid. `prisma migrate deploy` therefore cannot record the migration as applied ahead of the index. The script below builds the index concurrently, verifies it, resolves the migration and re-runs the migration file to prove it is now a no-op.

```bash
# Terminal 1: the proxy on port 5433, as above.
# Terminal 2, repository root. A low-traffic window is preferred. The build scans the table and takes no blocking lock.
export DATABASE_URL="$(gcloud secrets versions access latest --secret=database-url --project gen-lang-client-0202543132)"
python3 scripts/sql/kb_fts_safe_rollout.py            # dry run that prints state and plan
python3 scripts/sql/kb_fts_safe_rollout.py --execute  # drop legacy objects, build the index, verify, resolve
curl -s https://suchi-api-lxiveognla-uc.a.run.app/v1/health/retrieval   # fullTextSearch.status should be ok
```

If something already holds a lock on `KbChunk` for minutes, find it with the first query in section 3 step 5 and end it with `pg_terminate_backend(pid)`.

## 7. Secrets

All runtime secrets live in Secret Manager in the project above. `cloudbuild.yaml` is the authoritative list. Every name in its `--set-secrets` flag must exist or the deploy fails. This table gives names only.

| Secret name | Env var | Notes |
|---|---|---|
| `database-url` | `DATABASE_URL` | |
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | The live LLM credential |
| `embedding-api-key` | `EMBEDDING_API_KEY` | |
| `deepseek-api-key` | `DEEPSEEK_API_KEY` | Legacy. The API does not use it while `LLM_PROVIDER=gemini`. It is still mounted, so deleting the secret would break the next deploy. |
| `admin-basic-user` | `ADMIN_BASIC_USER` | |
| `admin-basic-pass` | `ADMIN_BASIC_PASS` | |
| `SMTP_PASS` | `SMTP_PASS` | Password for the SMTP account. The navigator Cloud Run jobs mount it as well. |
| `langfuse-public-key` | `LANGFUSE_PUBLIC_KEY` | |
| `langfuse-secret-key` | `LANGFUSE_SECRET_KEY` | |
| `NAVIGATOR_APPROVAL_SECRET` | same | Signs approval links. The navigator jobs mount it as well. |
| `CONTENT_APPROVAL_SECRET` | same | Signs approval links |
| `DISTRIBUTION_APPROVAL_SECRET` | same | Signs the one-click approve and reject links |
| `META_PAGE_ACCESS_TOKEN` | same | Facebook and Instagram. TO CONFIRM token expiry. |
| `META_PAGE_ID` | same | |
| `META_IG_USER_ID` | same | |
| `META_WABA_PHONE_NUMBER_ID` | same | WhatsApp |
| `META_WABA_TOKEN` | same | WhatsApp. TO CONFIRM token expiry. |
| `META_APP_SECRET` | same | Verifies the WhatsApp webhook signature |
| `WHATSAPP_VERIFY_TOKEN` | same | |
| `LINKEDIN_ACCESS_TOKEN` | same | Expires every 60 days |
| `LINKEDIN_AUTHOR_URN` | same | |

Seven names are lower case with hyphens and fourteen are upper case. Secret Manager names are case-sensitive, so check each new name with `gcloud secrets describe <NAME> --project gen-lang-client-0202543132` before deploying.

The navigator jobs also mount `ANTHROPIC_API_KEY` (`cloudbuild.navigator-research.yaml`).

GitHub Actions holds its own secrets. They are `GCP_SA_KEY_JSON`, `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USERNAME` and `SMTP_PASSWORD`, plus the optional `EVAL_LLM_PROVIDER`, `GOOGLE_CLOUD_PROJECT`, `DEEPSEEK_API_KEY` and `OPENAI_API_KEY`.

To rotate a secret, add a new version.

```bash
printf %s "$NEW_VALUE" | gcloud secrets versions add <NAME> --data-file=- --project gen-lang-client-0202543132
```

Use `printf %s`. A trailing newline in a token produces a 401 that is hard to diagnose. Secrets are mounted at `latest`. TO CONFIRM whether running instances pick up a new version without a new revision.

**LinkedIn, every 60 days.** Set a reminder at 55 days. A browser sign-in by a page administrator is needed each time.

```bash
npm run linkedin:auth -- exchange --code <code> --to-secret-manager LINKEDIN_ACCESS_TOKEN
```

The secret names are `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_AUTHOR_URN`, in upper case, as in `cloudbuild.yaml`. A lapsed token fails LinkedIn posts with a 401 and affects nothing else. The full procedure is in `docs/LINKEDIN_ORG_POSTING.md`.

TO CONFIRM. `docs/RELIABILITY_BACKLOG.md` records a rotation of the SMTP password as pending.

## 8. Evaluation

The nightly tier 1 eval runs at 02:00 UTC from `.github/workflows/eval-tier1.yml`. It runs 21 cases against production and sends about 70 real chat requests. The judge is Gemini on Vertex AI unless a repository secret overrides the provider. The workflow has no pull request trigger.

```bash
gh run list --workflow eval-tier1.yml --limit 10
gh run view <run-id>
gh run download <run-id> -n tier1-eval-report-<run-number>
```

Read the annotation on a red run before anything else.

| Annotation | Meaning | Action |
|---|---|---|
| Evaluation failed | The API answered and one or more cases failed | Open `tier1-report.json` and read the failed case IDs. Compare with the previous night. |
| API unavailable | The health check failed before the run, so no case was sent. This state arrives with PR #247. | Section 2, then section 3 |
| Eval infrastructure error | No report was produced | Section 2. Before PR #247 this is also what an outage looks like. |
| Judge unavailable | The judge could not score more than 10% of cases | Usually transient. Run it once more. Check that the service account still has `roles/aiplatform.user`. |
| Notification degraded (warning) | The email failed. The run result is unaffected. | Check the SMTP secrets in GitHub. |

Several red nights in a row with an availability or infrastructure annotation mean production is down.

A manual run against production loads the database. Run it outside Indian daytime hours and never while another run is active.

```bash
cd eval && npm ci
EVAL_API_BASE_URL=https://suchi-api-lxiveognla-uc.a.run.app/v1 EVAL_LLM_PROVIDER=vertex_ai \
  GOOGLE_CLOUD_PROJECT=gen-lang-client-0202543132 npm run eval:tier1
```

Without `EVAL_LLM_PROVIDER` the judge defaults to `openai` (`eval/config/loader.ts`). Set the provider on every local run.

Checks that need no network are `npm test`, `npm run test:ci` and `npm run cases:check` in `eval/`.

`docs/RELIABILITY_BACKLOG.md` and `docs/CAPABILITY_LEDGER.md` hold the history of the eval's reliability. Read them before quoting a pass rate from an older run.

## 9. Knowledge base

`kb/manifest.json` is tracked. Almost every article file under `kb/en/` is gitignored and absent from a fresh clone. TO CONFIRM where the master copy of those files is kept and how it is backed up.

```bash
cd apps/api
npm run kb:dry       # validate the manifest and files, write nothing
npm run kb:ingest    # resume ingestion and embed new chunks
```

A wipe needs both `--wipeChunks` and `--confirmWipe`. Do not wipe production. Ingestion writes to `KbChunk`, so run it in a low-traffic window.

Retrieval serves only documents with `status = 'active'`. The review gate for machine-transcribed material is described in `kb/README.md`.

`cloudbuild.kb-ingest.yaml` and `Dockerfile.kb-ingest` build an image for a KB ingestion job. TO CONFIRM that it works. Its command passes `--wipeChunks` without `--confirmWipe`, which the ingest script rejects, and `.gcloudignore` excludes `kb/` from the build upload.

## 10. Scheduled jobs

Cloud Scheduler calls admin endpoints with an OIDC token for the scheduler identity (`apps/api/src/common/guards/scheduler-oidc.guard.ts`). These are the jobs in `us-central1` on 21 November 2026. Times are in UTC.

| Job | Schedule | Target |
|---|---|---|
| `suchi-keep-alive` | Every 5 minutes | `GET /v1/health` |
| `suchi-daily-report` | 11:30 daily | TO CONFIRM. Presumed `POST /v1/admin/daily-report`. |
| `suchi-article-research-daily` | 02:00 daily | TO CONFIRM. Presumed `POST /v1/admin/article-research`. |
| `suchi-hospital-research-daily` | 01:30 daily | TO CONFIRM. Presumed `POST /v1/admin/hospital-research`. |
| `suchi-navigator-sender-daily` | 04:30 daily | Runs a Cloud Run job (`cloudbuild.navigator-research.yaml`) |
| `suchi-review-digest-weekly` | Mondays 03:30 | TO CONFIRM. Presumed `POST /v1/admin/review-queue/send-digest`. |
| `suchi-learning-note-monthly` | First Monday 03:30 | TO CONFIRM. Presumed `POST /v1/admin/learning-note/generate`. |
| `autoresearch-nightly` | Paused | Cloud Build trigger for `cloudbuild-autoresearch.yaml` |

TO CONFIRM that every schedule other than the daily report is set in UTC.

Refresh the table with this command.

```bash
gcloud scheduler jobs list --location us-central1 --project gen-lang-client-0202543132
```

**Open item. No retention job exists.** No Cloud Scheduler job calls `POST /v1/admin/housekeeping/run-retention`. The retention periods in `docs/PRIVACY_RETENTION.md` are implemented in code and are not being applied on a schedule. The maintainer must create the job.

Two other scheduler-guarded endpoints have no job named for them. They are `POST /v1/admin/housekeeping/run-expiry` and `POST /v1/admin/content/notify-publish`. TO CONFIRM whether another job calls them.

The autoresearch nightly loop only ever proposed changes on `autoresearch/*` branches for human review. It has been paused since 20 July 2026 and never gated a deploy. Issue #60 holds the audit record and the conditions for restarting it. Do not restart it without meeting them.

## 11. Local setup, tests and CI

Node 20. PostgreSQL with the pgvector extension for anything that touches data (`apps/api/prisma/migrations/add_pgvector_extension.sql`). Unit tests need no database and no network, because Prisma and the LLM are mocked.

```bash
cd apps/api && npm ci && npx prisma generate && npm run dev     # http://localhost:3001/v1
cd apps/api && npx jest                                         # full unit suite
cd apps/api && npx jest --testPathPatterns=safety               # one area (jest 30 flag)
cd apps/api && npm run build                                    # must be clean before a deploy
cd apps/web && npm ci && npm run dev                            # http://localhost:3000
cd apps/web && npx vitest run                                   # Vitest, single run. `npm test` starts watch mode.
cd eval && npm ci && npm test                                   # eval framework unit tests
cd eval && npx ts-node cli.ts --help                            # lists the eval subcommands
```

The minimum `.env` for the API is `DATABASE_URL`, `ADMIN_BASIC_USER` and `ADMIN_BASIC_PASS`, plus either `GEMINI_API_KEY` or `GOOGLE_CLOUD_PROJECT`. `apps/api/src/config/env.validation.ts` is the authoritative list and `docs/ENVIRONMENT_VARIABLES.md` describes the variables.

Workflows in `.github/workflows/`.

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy-api.yml` ("API build verification") | Every pull request, every push to `main`, manual. No path filter. | Job `API unit tests` runs the API Jest suite. Job `Build + config parity` runs the secret-literal check, the deploy config parity check, the image asset check and the LinkedIn helper self-test, then builds the API image without pushing it. It deploys nothing. |
| `deploy-web.yml` | Push to `main` touching `apps/web/**`, manual | Builds and deploys `suchi-web` |
| `deploy-landing.yml` | Push to `main` touching `apps/landing/**`, manual | Builds the Astro site and publishes it to GitHub Pages |
| `e2e-tests.yml` ("Web Tests") | Pull request or push touching `apps/web/**`, manual | Vitest unit tests and Playwright |
| `eval-tier1.yml` | Nightly at 02:00 UTC, manual | Section 8 |
| `uptime.yml` ("Uptime probe") | Every 15 minutes, manual. Arrives with PR #247. | Section 2 |

The same checks run locally.

```bash
python3 scripts/check_deploy_config_parity.py
python3 scripts/check_no_secret_literals.py
```
