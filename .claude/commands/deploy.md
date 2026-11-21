---
allowed-tools: Bash, Read
argument-hint: "[direct|gated|promote <REVISION>|preflight-only]"
---

# Deploy Suchi Cancer Bot to Cloud Run

You are deploying the Suchi Cancer Bot. The user's argument is: $ARGUMENTS

Parse the mode from the argument. Default to `direct` if no argument is given.

## Modes

- **`direct`** (default): Run all preflight checks, then deploy via `cloudbuild.yaml`.
- **`gated`**: Run all preflight checks, then deploy via `cloudbuild.gated.yaml`. This pipeline is not in use. Before running it, compare its service flags with `cloudbuild.yaml` and read `docs/cloudbuild-gated-issues.md`.
- **`promote <REVISION>`**: Promote the named revision (no preflight, no rebuild). A revision name is required.
- **`preflight-only`**: Run only the automated preflight checks. Do NOT deploy.

---

## Phase 1: Automated Preflight (hard gate)

Run Checks 0 to 9 below **sequentially** for `direct`, `gated`, and `preflight-only` modes. Check 10 is optional. Track results in a table. If ANY check fails (not WARN), **stop immediately** and do NOT proceed to Phase 2 or deploy.

Run every command from the repository root. The commands below find it with `git rev-parse --show-toplevel`. The procedure this command automates is in `docs/OPERATIONS.md` section 4.

### Check 0: Clean working tree

`gcloud builds submit` uploads the working directory as it stands. Uncommitted or untracked files would reach production without review.

```bash
cd "$(git rev-parse --show-toplevel)" && git status --short
git rev-parse --abbrev-ref HEAD
git fetch origin main && git rev-parse HEAD origin/main
```

- PASS: `git status --short` prints nothing
- FAIL (`direct` and `gated`): any output from `git status --short`. Show it and stop. Do not stash, reset or clean on the user's behalf.
- WARN (`preflight-only`): any output from `git status --short`
- WARN: the branch is not `main`, or `HEAD` differs from `origin/main`. Report both commits and let the user decide.

### Check 1: TypeScript Build

```bash
cd "$(git rev-parse --show-toplevel)/apps/api" && npm run build
```

- PASS: exit code 0
- FAIL: any compilation error — show the error output

### Check 2: Prisma Schema Validation

```bash
cd "$(git rev-parse --show-toplevel)/apps/api" && npx prisma validate
```

- PASS: exit code 0
- FAIL: schema validation error — show the error output

### Check 3: Hardcoded Secrets Scan

Grep the API source tree for potential hardcoded secrets:

```bash
grep -rn --include='*.ts' --include='*.js' -E '(sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{30,}|Bearer [a-zA-Z0-9_-]{20,})' "$(git rev-parse --show-toplevel)/apps/api/src/"
```

- PASS: no matches
- WARN: matches found — list every match and flag for user judgment. `"Bearer "` as a header prefix template is OK. Report as WARN, not hard FAIL.

### Check 4: Doubled Route Prefixes

```bash
grep -rn --include='*.ts' '/v1/v1/' "$(git rev-parse --show-toplevel)/apps/api/src/"
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
   grep -rn --include='*.ts' -E '(skipSafety|bypassSafety|safety.*false|disableSafety)' "$(git rev-parse --show-toplevel)/apps/api/src/"
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

### Check 9: Unreviewed Clinical Prompt Gate (hard)

Some changes ship a *mechanism* whose patient-facing *wording* is still held for SCCF
medical review (AGENTS.md §1.3). Deploying the mechanism without the reviewed wording
puts un-reviewed guidance in front of patients. This check refuses that combination.

**Hospital distance (#148 mechanism / #149 + #159 wording):**

```bash
cd "$(git rev-parse --show-toplevel)" && \
  grep -c '(straight-line)' apps/api/src/modules/chat/chat.service.ts; \
  grep -c 'STRAIGHT-LINE distance, already rounded' apps/api/src/modules/chat/chat.service.ts
```

- **PASS**: first count is `0` (mechanism not on main yet), or both counts are non-zero
  (mechanism and its reviewed instruction landed together).
- **FAIL**: first count is non-zero and second is `0`. The build renders
  `~N km away (straight-line)` to the generator with **no instruction telling it the
  figure is straight-line, to repeat it as written, and never to convert it into a
  travel time or a road distance**. Nothing then stops the model turning ~50 km into
  "about an hour's drive" for a patient in rural North Bihar where it is three.

  The reviewed wording landed in **PR #200**, which SCCF approved and which merged on
  10 October 2026. Both counts are non-zero on `main` since then, so this check passes.
  A FAIL today means the reviewed instruction has been removed or reworded.

  Do NOT work around a FAIL by deleting the distance text. Restore the instruction from
  PR #200, or take any change to its wording back through SCCF review.

This check is self-resolving: it arms itself when the mechanism lands and disarms when
the reviewed wording lands. It needs no network and no `gh`.

### Check 10: Release Eval Gate (optional — only if `--with-eval-gate` flag is present in $ARGUMENTS)

This check runs the gold eval pack via the release gate module. **Skip this check entirely unless the user explicitly passed `--with-eval-gate`.**

If `--with-eval-gate` is present:

```bash
cd "$(git rev-parse --show-toplevel)/eval" && npx ts-node cli.ts release-gate --api-url http://localhost:3001 --output reports/release-gate-report.json
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
| 0  | Clean working tree           | PASS / WARN / FAIL | ...       |
| 1  | TypeScript build             | PASS / FAIL | ...              |
| 2  | Prisma schema validation     | PASS / FAIL | ...              |
| 3  | Hardcoded secrets scan       | PASS / WARN | ...              |
| 4  | Doubled route prefixes       | PASS / FAIL | ...              |
| 5  | Embedding dimension (768)    | PASS / FAIL | ...              |
| 6  | Safety module integrity      | PASS / WARN / FAIL | ...     |
| 7  | CloudBuild substitutions     | PASS / FAIL | ...              |
| 8  | Env var coverage             | PASS / FAIL | ...              |
| 9  | Clinical prompt gate         | PASS / FAIL | ...              |
| 10 | Release eval gate            | PASS / FAIL / SKIP | (only if --with-eval-gate) |
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

This mode follows `docs/OPERATIONS.md` section 4, steps 6 to 8. Every `gcloud run` call names the project and the region. The Cloud Build calls name the project only, as the runbook does. Cloud Build runs these builds in its global location, and `--region us-central1` would send `gcloud builds` to a different location.

1. Run `git status --short` again. If it prints anything, stop. The tree must still be clean at the moment of upload.
   Then build and deploy from the repository root.
   ```bash
   gcloud builds submit --config=cloudbuild.yaml . --project gen-lang-client-0202543132
   ```
2. Stream build logs. Record the build ID that `gcloud builds submit` prints. If you lose the stream, poll that build every 30 seconds until it completes.
   ```bash
   gcloud builds describe <BUILD_ID> --project gen-lang-client-0202543132 --format 'value(status)'
   ```
3. After the build succeeds, take the revision name from the output of this build. The `deploy-api` step prints a line of the form `Service [suchi-api] revision [<REVISION>] has been deployed`. Do not promote whichever revision is newest in a list. Another build, or a revision that failed to start, may be newer.
   If the line is not in the streamed output, read it from the build log.
   ```bash
   gcloud builds log <BUILD_ID> --project gen-lang-client-0202543132 | grep 'Service \[suchi-api\] revision'
   ```
4. Check that the revision runs this build's image. The image must end in `:<BUILD_ID>`. If it does not, stop and report.
   ```bash
   gcloud run revisions describe <REVISION> --region us-central1 --project gen-lang-client-0202543132 \
     --format 'value(spec.containers[0].image)'
   ```
5. Promote that revision to 100% traffic.
   ```bash
   gcloud run services update-traffic suchi-api --region us-central1 --project gen-lang-client-0202543132 \
     --to-revisions <REVISION>=100
   ```
6. Health-check: `curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health`. The body must contain `"status":"ok"`.
7. Report: build ID, duration, promoted revision name, image tag check result, health check result.

### Mode: `gated`

1. Run `git status --short` again. If it prints anything, stop.
   Then build and deploy from the repository root.
   ```bash
   gcloud builds submit --config=cloudbuild.gated.yaml . --project gen-lang-client-0202543132
   ```
2. Stream build logs. Poll with `gcloud builds describe <BUILD_ID> --project gen-lang-client-0202543132 --format 'value(status)'` until complete.
3. Health-check: `curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health`
4. Report: build ID, duration, health check result.

### Mode: `promote`

Skip preflight. Promote only.

This mode needs an explicit revision name in `$ARGUMENTS`, for example `/deploy promote suchi-api-00430-abc`. If no revision name is given, list the revisions, report "Name the revision to promote" and stop. Do not pick a revision for the user. More than one revision can sit at 0% traffic, and tagged revisions often do.

1. List revisions for reference.
   ```bash
   gcloud run revisions list --service suchi-api --region us-central1 --project gen-lang-client-0202543132 \
     --format "table(name,traffic_percent,tags)"
   ```
2. Confirm that the named revision exists, and show its image.
   ```bash
   gcloud run revisions describe <REVISION> --region us-central1 --project gen-lang-client-0202543132 \
     --format 'value(spec.containers[0].image)'
   ```
3. Show the revision name and its image tag, and ask for confirmation. The user checks that the tag is the build ID they mean to ship.
4. Shift traffic.
   ```bash
   gcloud run services update-traffic suchi-api --region us-central1 --project gen-lang-client-0202543132 \
     --to-revisions <REVISION>=100
   ```
5. Health-check: `curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health`
6. Report: promoted revision name, image tag, health check result.

---

## Constants

- **Project:** `gen-lang-client-0202543132`
- **Region:** `us-central1`
- **API Service:** `suchi-api`
- **Web Service:** `suchi-web`
- **Production URL:** `https://suchi-api-lxiveognla-uc.a.run.app/v1`
- **Repo root:** the output of `git rev-parse --show-toplevel`
- **Runbook:** `docs/OPERATIONS.md`
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
| Preflight        | N/N PASS (count the checks that ran) |
| Health Check     | ok / failed    |
| Status           | SUCCESS / FAIL |
```
