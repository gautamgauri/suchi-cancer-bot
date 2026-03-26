---
allowed-tools: Bash, Read
argument-hint: "[direct|gated|promote|preflight-only]"
---

# Deploy Suchi Cancer Bot to Cloud Run

You are deploying the Suchi Cancer Bot. The user's argument is: $ARGUMENTS

Parse the mode from the argument. Default to `direct` if no argument is given.

## Modes

- **`direct`** (default): Run all preflight checks, then deploy via `cloudbuild.yaml`.
- **`gated`**: Run all preflight checks, then deploy via `cloudbuild.gated.yaml`.
- **`promote`**: Promote an existing candidate revision (no preflight, no rebuild).
- **`preflight-only`**: Run only the automated preflight checks. Do NOT deploy.

---

## Phase 1: Automated Preflight (hard gate)

Run ALL 8 checks below **sequentially** for `direct`, `gated`, and `preflight-only` modes. Track results in a table. If ANY check fails (not WARN), **stop immediately** — do NOT proceed to Phase 2 or deploy.

### Check 1: TypeScript Build

```bash
cd /home/gauta/suchi_repo/apps/api && npm run build
```

- PASS: exit code 0
- FAIL: any compilation error — show the error output

### Check 2: Prisma Schema Validation

```bash
cd /home/gauta/suchi_repo/apps/api && npx prisma validate
```

- PASS: exit code 0
- FAIL: schema validation error — show the error output

### Check 3: Hardcoded Secrets Scan

Grep the API source tree for potential hardcoded secrets:

```bash
grep -rn --include='*.ts' --include='*.js' -E '(sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{30,}|Bearer [a-zA-Z0-9_-]{20,})' /home/gauta/suchi_repo/apps/api/src/
```

- PASS: no matches
- WARN: matches found — list every match and flag for user judgment. `"Bearer "` as a header prefix template is OK. Report as WARN, not hard FAIL.

### Check 4: Doubled Route Prefixes

```bash
grep -rn --include='*.ts' '/v1/v1/' /home/gauta/suchi_repo/apps/api/src/
```

- PASS: no matches
- FAIL: any match — show file and line

### Check 5: Embedding Dimension Consistency (768)

1. Read `apps/api/prisma/schema.prisma` and confirm all `vector()` columns use `vector(768)`.
2. Grep for any hardcoded embedding dimensions in source code that differ from 768.

- PASS: all values are 768 and consistent
- FAIL: any mismatch or non-768 dimension found

### Check 6: Safety Module Integrity

Verify the safety module is properly registered and not bypassed:

1. Read `apps/api/src/app.module.ts` — confirm `SafetyModule` is in imports.
2. Grep for patterns that might bypass safety:
   ```bash
   grep -rn --include='*.ts' -E '(skipSafety|bypassSafety|safety.*false|disableSafety)' /home/gauta/suchi_repo/apps/api/src/
   ```

- PASS: SafetyModule registered and no bypass patterns found
- WARN: bypass patterns found — flag for user judgment
- FAIL: SafetyModule not registered in app.module.ts

### Check 7: CloudBuild Substitution Variables

Parse `cloudbuild.yaml` and verify that every `${_VARIABLE}` referenced in `steps` has a corresponding entry in the `substitutions:` block.

1. Read `cloudbuild.yaml`
2. Extract all `${_...}` references from the steps
3. Extract all keys from the `substitutions:` block
4. Report any variables used in steps but not defined in substitutions

- PASS: all referenced variables are defined
- FAIL: any undefined substitution variable — list them

Note: `${PROJECT_ID}` and `$BUILD_ID` are Cloud Build built-ins and don't need to be in substitutions.

### Check 8: Env Var Coverage

Cross-reference required env vars between `env.validation.ts` and `cloudbuild.yaml`.

1. Read `apps/api/src/config/env.validation.ts` — extract all env var names from the schema that do NOT have `.optional()` (i.e., required vars).
2. Read `cloudbuild.yaml` — extract all env var names from `--set-env-vars` and `--set-secrets`.
3. Report any required vars from the schema that are missing from the Cloud Build config.

- PASS: all required env vars are covered
- FAIL: required vars missing from cloudbuild — list them

Note: `PORT` and `NODE_ENV` are set by Cloud Run automatically, so exclude them from this check.

### Check 9: Release Eval Gate (optional — only if `--with-eval-gate` flag is present in $ARGUMENTS)

This check runs the gold eval pack via the release gate module. **Skip this check entirely unless the user explicitly passed `--with-eval-gate`.**

If `--with-eval-gate` is present:

```bash
cd /home/gauta/suchi_repo/eval && npx ts-node cli.ts release-gate --api-url http://localhost:3001 --output reports/release-gate-report.json
```

- PASS: exit code 0 (verdict is DEPLOY)
- FAIL: exit code 1 (verdict is BLOCK — show the release gate report table)

Note: This check takes several minutes because it runs 70 eval cases. That is why it is opt-in.

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
| 5  | Embedding dimension (768)    | PASS / FAIL | ...              |
| 6  | Safety module integrity      | PASS / WARN / FAIL | ...     |
| 7  | CloudBuild substitutions     | PASS / FAIL | ...              |
| 8  | Env var coverage             | PASS / FAIL | ...              |
| 9  | Release eval gate            | PASS / FAIL / SKIP | (only if --with-eval-gate) |
```

**If mode is `preflight-only`, stop here and report results. Do NOT proceed to Phase 2.**

---

## Phase 2: Confirmation

Display this reminder for the user's reference, then ask for ONE confirmation:

**Pre-deploy reminders** (informational, not blocking):
- Safety: never bypass safety module, never return medical advice without KB backing
- KB: if KB documents were updated, verify manifest consistency
- Voice: if voice endpoints changed, test voice round-trip
- Model: if LLM model changed, run eval before deploying

Then ask: **"Preflight passed. Deploy now? (y/n)"**

If yes, proceed to Phase 3. If no, stop.

---

## Phase 3: Deploy

### Mode: `direct`

1. Run `gcloud builds submit --config=cloudbuild.yaml .` from `/home/gauta/suchi_repo/`
2. Stream build logs. If the build takes long, poll `gcloud builds list --limit=1` every 30 seconds until complete.
3. After build succeeds, **promote the latest revision to 100% traffic**:
   ```
   LATEST=$(gcloud run revisions list --service=suchi-api --region=us-central1 --limit=1 --format='value(name)')
   gcloud run services update-traffic suchi-api --region=us-central1 --to-revisions=$LATEST=100
   ```
4. Health-check: `curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health`
5. Report: build ID, duration, promoted revision name, health check result.

### Mode: `gated`

1. Run `gcloud builds submit --config=cloudbuild.gated.yaml .` from `/home/gauta/suchi_repo/`
2. Stream build logs. Poll until complete.
3. Health-check: `curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health`
4. Report: build ID, duration, health check result.

### Mode: `promote`

Skip preflight. Promote only.

1. List revisions:
   ```
   gcloud run revisions list --service=suchi-api --region=us-central1 --format="table(name,traffic_percent,tags)"
   ```
2. Identify the revision currently at 0% traffic. If none exists, report "No candidate revision found" and stop.
3. Show which revision will be promoted and ask for confirmation.
4. Shift traffic:
   ```
   gcloud run services update-traffic suchi-api --region=us-central1 --to-revisions=REVISION_NAME=100
   ```
5. Health-check: `curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health`
6. Report: promoted revision name, health check result.

---

## Constants

- **Project:** `gen-lang-client-0202543132`
- **Region:** `us-central1`
- **API Service:** `suchi-api`
- **Web Service:** `suchi-web`
- **Production URL:** `https://suchi-api-lxiveognla-uc.a.run.app/v1`
- **Repo root:** `/home/gauta/suchi_repo/`
- **CloudBuild config:** `cloudbuild.yaml`
- **API source:** `apps/api/src/`
- **Prisma schema:** `apps/api/prisma/schema.prisma`
- **Env validation:** `apps/api/src/config/env.validation.ts`

## Output Format

```
## Deploy Result

| Field            | Value          |
|------------------|----------------|
| Mode             | ...            |
| Build ID         | ...            |
| Duration         | ...            |
| Preflight        | 8/8 PASS       |
| Health Check     | ok / failed    |
| Status           | SUCCESS / FAIL |
```
