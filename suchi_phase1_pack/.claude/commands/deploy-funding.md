---
allowed-tools: Bash, Read
argument-hint: "[deploy|preflight-only]"
---

# Deploy Funding Bot to Cloud Run

You are deploying the Diksha Funding Bot. The user's argument is: $ARGUMENTS

Parse the mode from the argument. Default to `deploy` if no argument is given.

## Modes

- **`deploy`** (default): Run all preflight checks, then manual acknowledgment, then `gcloud builds submit`.
- **`preflight-only`**: Run only the automated preflight checks. Do NOT submit a build.

---

## Phase 1: Automated Preflight (hard gate)

Run ALL 8 checks below **sequentially**. Track results in a table. If ANY check fails, **stop immediately** — do NOT proceed to Phase 2 or deploy. Report all results collected so far plus the failure.

### Check 1: TypeScript Build (§6.1)

```bash
cd /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api && npm run build
```

- PASS: exit code 0
- FAIL: any compilation error → show the error output

### Check 2: Prisma Schema Validation (§2.1)

```bash
cd /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api && npx prisma validate
```

- PASS: exit code 0
- FAIL: schema validation error → show the error output

Note: We intentionally skip `prisma migrate status` because it requires a live DB connection (Cloud SQL proxy). Migrations run inside Cloud Build's `funding-migrate` job.

### Check 3: Hardcoded Secrets Scan (§1.6)

Grep the funding-api source tree for potential hardcoded secrets:

```bash
grep -rn --include='*.ts' --include='*.js' -E '(sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{30,}|Bearer [a-zA-Z0-9_-]{20,})' /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api/src/
```

- PASS: no matches
- WARN (show matches): If there are matches, **list every match** and flag them for the user's judgment. Files like `reranker.service.ts` may contain `"Bearer "` as a header prefix template (not a real secret). Report as WARN, not hard FAIL — let the user decide whether to proceed.

### Check 4: Doubled Route Prefixes (§7.1)

Grep for doubled `/v1/v1/` patterns in the source:

```bash
grep -rn --include='*.ts' '/v1/v1/' /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api/src/
```

- PASS: no matches
- FAIL: any match → show file and line

### Check 5: Hardcoded Example Names in Prompts (§4.2)

Grep for known example org/project names that shouldn't appear in prompts:

```bash
grep -rn --include='*.ts' -i -E '(gully.?goal|reliance.?foundation|rf-esa)' /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api/src/
```

- PASS: no matches in prompt/template files (matches in test files, migration files, or data fixtures are OK)
- WARN: matches in `*.service.ts`, `*.controller.ts`, or prompt template files → flag for user judgment

### Check 6: Embedding Dimension Consistency (§3.1)

Verify that the pgvector schema column width and the embedding provider's `outputDimensionality` are both 768.

1. Read `apps/funding-api/prisma/schema.prisma` and confirm all `vector()` columns use `vector(768)`.
2. Read `apps/funding-api/src/modules/evidence_ingest/embedding-provider.ts` and confirm:
   - `GoogleEmbeddingProvider.dimensions = 768`
   - `outputDimensionality: 768` in embed/batchEmbed calls

- PASS: all values are 768 and consistent
- FAIL: any mismatch or non-768 dimension found

### Check 7: CloudBuild Substitution Variables (§9.3)

Parse `cloudbuild.funding.yaml` and verify that every `${_VARIABLE}` referenced in `steps` has a corresponding entry in the `substitutions:` block.

1. Read `cloudbuild.funding.yaml`
2. Extract all `${_...}` references from the steps
3. Extract all keys from the `substitutions:` block
4. Report any variables used in steps but not defined in substitutions

- PASS: all referenced variables are defined
- FAIL: any undefined substitution variable → list them

Note: `${PROJECT_ID}` and `$BUILD_ID` are Cloud Build built-ins and don't need to be in substitutions.

### Check 8: Env Var Coverage (§1.1)

Cross-reference required env vars between `env.validation.ts` and `cloudbuild.funding.yaml`.

1. Read `apps/funding-api/src/config/env.validation.ts` — extract all env var names from the `envSchema` that do NOT have `.optional()` (i.e., required vars).
2. Read `cloudbuild.funding.yaml` — extract all env var names from `--set-env-vars` and `--set-secrets`.
3. Report any required vars from the schema that are missing from the Cloud Build config.

- PASS: all required env vars are covered
- FAIL: required vars missing from cloudbuild → list them

Note: `PORT` and `NODE_ENV` are set by Cloud Run automatically, so exclude them from this check.

### Preflight Results Table

After running all checks, display results:

```
## Preflight Results

| #  | Check                        | Result      | Details          |
|----|------------------------------|-------------|------------------|
| 1  | TypeScript build             | PASS / FAIL | ...              |
| 2  | Prisma schema validation     | PASS / FAIL | ...              |
| 3  | Hardcoded secrets scan       | PASS / WARN | ...              |
| 4  | Doubled route prefixes       | PASS / FAIL | ...              |
| 5  | Hardcoded example names      | PASS / WARN | ...              |
| 6  | Embedding dimension (768)    | PASS / FAIL | ...              |
| 7  | CloudBuild substitutions     | PASS / FAIL | ...              |
| 8  | Env var coverage             | PASS / FAIL | ...              |
```

**If mode is `preflight-only`, stop here and report results. Do NOT proceed to Phase 2.**

---

## Phase 2: Manual Checklist (informational, single confirmation)

Display this checklist for the user's reference, then proceed to deploy with a single "Deploy now?" confirmation. Do NOT ask about each item individually.

**Pre-deploy reminders** (for your awareness — not blocking):
- Budget template: line items, unit costs, min grant floor, org ask ceiling
- Security: SSRF protection, HMAC, DTO validation, `FUNDING_BLOCK_EXTERNAL_DELIVERY=true`
- Gold retrieval recall >= 0.6 (if embeddings changed)
- End-to-end test proposal budget within +/-15% (if pipeline changed)
- Model change eval (only if LLM model changed)

Then ask the user ONE question: **"Preflight passed. Deploy now? (y/n)"**

If yes, proceed to Phase 3. If no, stop.

---

## Phase 3: Deploy

### Step 1: Submit Cloud Build

The `cloudbuild.funding.yaml` uses paths like `suchi_phase1_pack/apps/funding-api/Dockerfile`, so it must be submitted from the **repo root** (parent of `suchi_phase1_pack/`).

```bash
cd /home/gauta/suchi_repo && gcloud builds submit --config=suchi_phase1_pack/cloudbuild.funding.yaml .
```

Stream build logs. If the build takes long, poll `gcloud builds list --limit=1 --format='table(id,status,duration)'` every 60 seconds until complete.

### Step 2: Health Check

After the build succeeds, verify the deployed services are healthy:

```bash
# Liveness
curl -fsSL https://funding-api-lxiveognla-uc.a.run.app/live

# Readiness
curl -fsSL https://funding-api-lxiveognla-uc.a.run.app/ready

# Application health
curl -fsSL https://funding-api-lxiveognla-uc.a.run.app/v1/health
```

Report each endpoint's status.

### Step 3: Result Table

```
## Deploy Result

| Field            | Value          |
|------------------|----------------|
| Mode             | deploy         |
| Build ID         | ...            |
| Duration         | ...            |
| Preflight        | 8/8 PASS       |
| Health /live     | ok / failed    |
| Health /ready    | ok / failed    |
| Health /v1/health| ok / failed    |
| Status           | SUCCESS / FAIL |
```

---

## Constants

- **Project:** `gen-lang-client-0202543132`
- **Region:** `us-central1`
- **API Service:** `funding-api`
- **Web Service:** `funding-web`
- **Production API URL:** `https://funding-api-lxiveognla-uc.a.run.app`
- **Repo root:** `/home/gauta/suchi_repo/`
- **Project dir:** `/home/gauta/suchi_repo/suchi_phase1_pack/`
- **CloudBuild config:** `suchi_phase1_pack/cloudbuild.funding.yaml`
- **Funding API source:** `apps/funding-api/src/`
- **Prisma schema:** `apps/funding-api/prisma/schema.prisma`
- **Env validation:** `apps/funding-api/src/config/env.validation.ts`
- **Embedding provider:** `apps/funding-api/src/modules/evidence_ingest/embedding-provider.ts`
- **Preflight doc:** `docs/DEPLOY_PREFLIGHT.md`
