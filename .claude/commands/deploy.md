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

Steps:
1. Run `gcloud builds submit --config=cloudbuild.yaml .` from `/home/gauta/suchi_repo/`
2. Stream build logs. If the build takes long, poll `gcloud builds list --limit=1` every 30 seconds until complete.
3. After build succeeds, **promote the latest revision to 100% traffic**:
   ```
   # Get the latest revision name
   LATEST=$(gcloud run revisions list --service=suchi-api --region=us-central1 --limit=1 --format='value(name)')
   # Route all traffic to it
   gcloud run services update-traffic suchi-api --region=us-central1 --to-revisions=$LATEST=100
   ```
4. Health-check the production API:
   ```
   curl -fsSL https://suchi-api-lxiveognla-uc.a.run.app/v1/health
   ```
5. Report: build ID, duration, promoted revision name, health check result.

### Mode: `gated`

Gated deployment using `cloudbuild.gated.yaml` — deploys a candidate revision at 0% traffic, runs health check, and promotes only if healthy.

Steps:
1. Run `gcloud builds submit --config=cloudbuild.gated.yaml .` from `/home/gauta/suchi_repo/`
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
