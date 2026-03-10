---
allowed-tools: Bash, Read
argument-hint: "[direct|gated|promote]"
---

# Deploy Suchi Cancer Bot to Cloud Run

You are deploying the Suchi Cancer Bot. The user's argument is: $ARGUMENTS

Parse the mode from the argument. Default to `direct` if no argument is given.

## Modes

### Mode: `direct`

Standard production deployment using `cloudbuild.yaml`.

This file uses paths like `suchi_phase1_pack/apps/api/Dockerfile`, so it must be submitted from the **repo root** (parent of `suchi_phase1_pack/`).

Steps:
1. Run `gcloud builds submit --config=suchi_phase1_pack/cloudbuild.yaml .` from `/home/gauta/suchi_repo/`
2. Stream build logs. If the build takes long, poll `gcloud builds list --limit=1` every 30 seconds until complete.
3. After build succeeds, health-check the production API:
   ```
   curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health
   ```
4. Report: build ID, duration, health check result.

### Mode: `gated`

Gated deployment using `cloudbuild.gated.yaml` — deploys a candidate revision at 0% traffic, runs tier1 eval, and promotes only if eval passes.

This file uses `dir: 'apps/api'`, so it must be submitted from **suchi_phase1_pack/**.

Steps:
1. Run `gcloud builds submit --config=cloudbuild.gated.yaml .` from `/home/gauta/suchi_repo/suchi_phase1_pack/`
2. Stream build logs. If the build takes long, poll `gcloud builds list --limit=1` every 30 seconds until complete.
3. After build succeeds, health-check the production API:
   ```
   curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health
   ```
4. Report: build ID, duration, eval gate result, health check result.

### Mode: `promote`

Promote an existing candidate revision from 0% to 100% traffic. No rebuild.

Steps:
1. List revisions with the `candidate` tag:
   ```
   gcloud run revisions list --service=suchi-api --region=us-central1 --format="table(name,traffic_percent,tags)"
   ```
2. Identify the revision currently at 0% traffic (or tagged `candidate`). If none exists, report "No candidate revision found" and stop.
3. Show the user which revision will be promoted and ask for confirmation before proceeding.
4. Shift traffic:
   ```
   gcloud run services update-traffic suchi-api --region=us-central1 --to-revisions=REVISION_NAME=100
   ```
5. Verify with health check:
   ```
   curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health
   ```
6. Report: promoted revision name, health check result.

## Constants

- **Project:** `gen-lang-client-0202543132`
- **Region:** `us-central1`
- **API Service:** `suchi-api`
- **Web Service:** `suchi-web`
- **Production URL:** `https://suchi-api-lxiveognla-uc.a.run.app/v1`
- **Repo root:** `/home/gauta/suchi_repo/`
- **Project dir:** `/home/gauta/suchi_repo/suchi_phase1_pack/`

## Output Format

```
## Deploy Result

| Field          | Value          |
|----------------|----------------|
| Mode           | ...            |
| Build ID       | ...            |
| Duration       | ...            |
| Health Check   | ok / failed    |
| Status         | SUCCESS / FAIL |
```
