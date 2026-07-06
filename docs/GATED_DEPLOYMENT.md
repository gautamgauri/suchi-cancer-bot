# Gated Deployment with Cloud Build

## Overview

This deployment pattern provides "staging safety" without creating a separate environment. It works by:

1. Deploying a **candidate revision** with 0% traffic
2. Running a health check against the candidate's actual endpoint (`/v1/health`)
3. Only shifting traffic to the candidate if the health check passes
4. If the health check fails, the build stops and live traffic remains on the previous revision

> [!NOTE]
> The automated evaluation gate (`eval:tier1`) has been removed from the remote Cloud Build pipeline to save build time. You must run the eval suite locally or via appropriate slash commands before merging your PR to `main`.

## How It Works

### Step-by-Step Flow

```
1. Build Docker image
   ↓
2. Push to Artifact Registry
   ↓
3. Deploy candidate revision (0% traffic, tagged 'candidate')
   ↓
4. Wait for candidate to be healthy (using /v1/health)
   ↓
5. If health check passes → Shift 100% traffic to candidate
   If health check fails → Build stops, traffic stays on previous revision
   ↓
6. Deploy web (after API is promoted)
```

### Key Benefits

- ✅ **No separate staging environment** - uses the same Cloud Run service
- ✅ **Zero risk to live users** - traffic only shifts after health check passes
- ✅ **Automatic rollback** - if health check fails, previous revision stays live

## Usage

### Option 1: Use Gated Build (Recommended)

**File:** `cloudbuild.gated.yaml`

```bash
gcloud builds submit --config=cloudbuild.gated.yaml
```

This runs the gated deployment pipeline.

### Option 2: Use Original Build (No Gate)

**File:** `cloudbuild.yaml`

```bash
gcloud builds submit --config=cloudbuild.yaml
```

This deploys directly without candidate tagging (use for emergency fixes).

## Configuration

### Required Secrets

Ensure these secrets exist in Google Cloud Secret Manager:

- `database-url` - PostgreSQL connection string
- `gemini-api-key` - Gemini API key
- `embedding-api-key` - Embedding API key (if separate)
- `admin-basic-user` - Basic auth username
- `admin-basic-pass` - Basic auth password

### Substitution Variables

The gated build uses the following substitution variables:

- `_REGION`: `us-central1`
- `_API_SERVICE_NAME`: `suchi-api`
- `_WEB_SERVICE_NAME`: `suchi-web`
- `_ARTIFACT_REGISTRY`: `suchi-images`
- `_CLOUDSQL_CONNECTION_NAME`: `gen-lang-client-0202543132:us-central1:suchi-db`
- `_API_URL`: `https://suchi-api-lxiveognla-uc.a.run.app/v1`

## Local Evaluation (Mandatory Before Merge)

Since the remote build no longer runs automated evaluation tests, you must run the local evaluation suite to ensure no regression:

```bash
cd eval
npm run eval:tier1
```

Or run the quick version:

```bash
npm run eval:quick
```

## Troubleshooting

### Candidate Revision Never Becomes Healthy

**Symptoms:**
- Health check step times out
- Build fails at `healthcheck-candidate`

**Possible Causes:**
- Cloud Run service taking longer than expected to start
- Health endpoint not accessible
- Network/routing issues

**Solutions:**
- Verify health check retries (currently 60 attempts, 5s apart = 5 minutes)
- Verify health endpoint is `/v1/health` (not `/health`)
- Check Cloud Run service logs

### Traffic Doesn't Shift

**Symptoms:**
- Health check passes but traffic stays on previous revision

**Possible Causes:**
- `promote-candidate` step failed silently
- Cloud Run traffic update failed

**Solutions:**
- Check Cloud Build logs for `promote-candidate` step
- Manually shift traffic: `gcloud run services update-traffic suchi-api --to-latest --region us-central1`

## Failure Playbook

### 1. 401/403 on Health Check

**Symptoms:**
- Build fails at `healthcheck-candidate` step
- Logs show: `curl: (22) The requested URL returned error: 401` or `403`
- Health check never succeeds

**Root Cause:**
- Service requires authentication but ID token generation failed
- Service account doesn't have permission to generate tokens
- Service was changed to require authentication

**Diagnostic Commands:**
```bash
# Test health endpoint manually
SERVICE_URL=$(gcloud run services describe suchi-api --region=us-central1 --format='value(status.url)')
curl -v "${SERVICE_URL}/v1/health"
```

**Fix:**
1. **If service is public (--allow-unauthenticated):**
   - Verify service config: `gcloud run services describe suchi-api --region=us-central1`
   - Check if service was accidentally made private
2. **If service requires auth:**
   - Ensure Cloud Build service account has `roles/run.invoker`

### 2. Health Check Timeout

**Symptoms:**
- Build fails at `healthcheck-candidate` step
- Logs show: `❌ Candidate revision never became healthy after 5 minutes`
- All 60 attempts failed

**Diagnostic Commands:**
```bash
# Check revision status
LATEST_REVISION=$(gcloud run revisions list --service=suchi-api --region=us-central1 --limit=1 --format='value(name)')
gcloud run revisions describe "$LATEST_REVISION" --region=us-central1

# Check revision logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=suchi-api" --limit=50
```

**Fix:**
- Verify environment variables and secrets are correct
- Check database connectivity
- Fix the underlying crash loop and redeploy

## Rollback Plan

If a bad revision gets through:

1. **Immediate:** Manually shift traffic to previous revision:
   ```bash
   gcloud run services update-traffic suchi-api --to-revisions=PREVIOUS_REVISION=100 --region=us-central1
   ```
2. **Fix:** Address the issue in code
3. **Redeploy:** Run gated build again
