# Gated Deployment with Cloud Build

## Overview

This deployment pattern provides "staging safety" without creating a separate environment. It works by:

1. Deploying a **candidate revision** with 0% traffic
2. Running a health check against the candidate (timeout 900s)
3. Only shifting traffic to the candidate if the health check passes
4. If the health check fails, the build stops and live traffic remains on the previous revision

> **Note (Feb 2026):** The eval:tier1 gate was removed from the gated pipeline due to reliability issues (see `cloudbuild-gated-issues.md`). The gate is now health-check only. Quality gating is handled separately by the autoresearch engine (`eval/autoresearch/`).

## How It Works

### Step-by-Step Flow

```
1. Build Docker image
   ↓
2. Push to Artifact Registry
   ↓
3. Deploy candidate revision (0% traffic, tagged 'candidate')
   ↓
4. Wait for candidate to be healthy (health check, 900s timeout)
   ↓
5. If healthy → Shift 100% traffic to candidate
   If unhealthy → Build stops, traffic stays on previous revision
   ↓
6. Deploy web (after API is promoted)
```

> The eval:tier1 step was previously between steps 4 and 5 but was removed in Feb 2026.

### Key Benefits

- **No separate staging environment** - uses the same Cloud Run service
- **Zero risk to live users** - traffic only shifts after health check passes
- **Automatic rollback** - if health check fails, previous revision stays live

## Usage

### Option 1: Use Gated Build (Recommended)

**File:** `cloudbuild.gated.yaml`

```bash
gcloud builds submit --config=cloudbuild.gated.yaml
```

This runs the full gated deployment pipeline.

### Option 2: Use Original Build (No Gate)

**File:** `cloudbuild.yaml`

```bash
gcloud builds submit --config=cloudbuild.yaml
```

This deploys directly without eval gate (use for emergency fixes or when eval is temporarily disabled).

## Configuration

### Required Secrets

Ensure these secrets exist in Google Cloud Secret Manager. The table below is the exact `--set-secrets` mapping deployed by both `cloudbuild.yaml` and `cloudbuild.gated.yaml` (the two files carry identical mappings — keep them in sync; `scripts/check_deploy_config_parity.py` enforces this in CI). Note that env var names and Secret Manager IDs differ for some entries.

| Env var (runtime) | Secret Manager ID | Purpose |
|---|---|---|
| `DATABASE_URL` | `database-url` | PostgreSQL connection string |
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | Gemini API key |
| `DEEPSEEK_API_KEY` | `deepseek-api-key` | DeepSeek API key (legacy LLM provider plumbing; prod is 100% Gemini) |
| `EMBEDDING_API_KEY` | `embedding-api-key` | Embedding API key |
| `ADMIN_BASIC_USER` | `admin-basic-user` | Basic auth username |
| `ADMIN_BASIC_PASS` | `admin-basic-pass` | Basic auth password |
| `SMTP_PASS` | `SMTP_PASS` | SMTP password for sending emails |
| `LANGFUSE_PUBLIC_KEY` | `langfuse-public-key` | Langfuse observability |
| `LANGFUSE_SECRET_KEY` | `langfuse-secret-key` | Langfuse observability |
| `NAVIGATOR_APPROVAL_SECRET` | `NAVIGATOR_APPROVAL_SECRET` | Signs navigator approval links |
| `CONTENT_APPROVAL_SECRET` | `CONTENT_APPROVAL_SECRET` | Signs content approval links |
| `DISTRIBUTION_APPROVAL_SECRET` | `DISTRIBUTION_APPROVAL_SECRET` | Signs distribution approval links |
| `META_PAGE_ACCESS_TOKEN` | `META_PAGE_ACCESS_TOKEN` | Meta Graph API (Facebook + Instagram) |
| `META_PAGE_ID` | `META_PAGE_ID` | Facebook page ID |
| `META_IG_USER_ID` | `META_IG_USER_ID` | Instagram business user ID |

`SOCIAL_APPROVAL_SECRET` is intentionally **not** mounted: the social pipeline falls back to `CONTENT_APPROVAL_SECRET` for signing approval links (`social-post.service.ts`, `buildToken()`).

**Verification:**
```bash
# List all secrets
gcloud secrets list

# Verify a specific secret exists
gcloud secrets describe database-url
```

**Troubleshooting Missing Secrets:**

If the build fails with "secret not found" errors:

1. Check which secret is missing:
   ```bash
   gcloud secrets list
   ```

2. Create the missing secret or verify the secret is accessible:
   ```bash
   gcloud secrets versions access latest --secret=database-url
   ```

3. Ensure the Cloud Build service account has access:
   ```bash
   # Get the Cloud Build service account email
   PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
   CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
   
   # Grant secret accessor role
   gcloud secrets add-iam-policy-binding database-url \
     --member="serviceAccount:${CLOUD_BUILD_SA}" \
     --role="roles/secretmanager.secretAccessor"
   ```

### Substitution Variables

The gated build uses the same substitution variables as the original:

- `_REGION`: `us-central1`
- `_API_SERVICE_NAME`: `suchi-api`
- `_WEB_SERVICE_NAME`: `suchi-web`
- `_ARTIFACT_REGISTRY`: `suchi-images`
- `_CLOUDSQL_CONNECTION_NAME`: `gen-lang-client-0202543132:us-central1:suchi-db`
- `_API_URL`: `https://suchi-api-lxiveognla-uc.a.run.app/v1`

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
- Increase health check retries (currently 60 attempts, 5s apart = 5 minutes)
- Verify health endpoint is `/v1/health` (not `/health`)
- Check Cloud Run service logs

### Traffic Doesn't Shift

**Symptoms:**
- Candidate revision is healthy but traffic stays on previous revision

**Possible Causes:**
- `promote-candidate` step failed silently
- Cloud Run traffic update failed

**Solutions:**
- Check Cloud Build logs for `promote-candidate` step
- Manually shift traffic: `gcloud run services update-traffic suchi-api --to-latest --region us-central1`

## Manual Override

If you need to bypass the gated candidate/promote pipeline (e.g. for emergency fixes):

1. Use original `cloudbuild.yaml`:
   ```bash
   gcloud builds submit --config=cloudbuild.yaml
   ```

## Integration with CI/CD

### Cloud Build Trigger

Set up a trigger to use the gated build on push to `main`:

```bash
gcloud builds triggers create github \
  --name="gated-deploy" \
  --repo-name="your-repo" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.gated.yaml"
```

### GitHub Actions Alternative

If you prefer GitHub Actions, you can trigger Cloud Build from Actions:

```yaml
- name: Trigger Gated Deploy
  run: |
    gcloud builds submit --config=cloudbuild.gated.yaml \
      --substitutions=_SHORT_SHA=${{ github.sha }}
```

## Monitoring

### Cloud Build Logs

View build logs in Cloud Console:
- Go to Cloud Build → History
- Click on build to see step-by-step logs

### Cloud Run Revisions

Monitor revisions:
```bash
gcloud run revisions list --service=suchi-api --region=us-central1
```

Check traffic distribution:
```bash
gcloud run services describe suchi-api --region=us-central1 \
  --format='value(status.traffic)'
```

## Failure Playbook

This section maps the top 5 failure modes to exact fixes. Use this when builds fail at midnight.

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

# Test with auth token
TOKEN=$(gcloud auth print-identity-token)
curl -H "Authorization: Bearer $TOKEN" "${SERVICE_URL}/v1/health"
```

**Fix:**
1. **If service is public (--allow-unauthenticated):**
   - Verify service config: `gcloud run services describe suchi-api --region=us-central1`
   - The unauthenticated fallback should work
   - Check if service was accidentally made private

2. **If service requires auth:**
   - Ensure Cloud Build service account has `roles/run.invoker`:
     ```bash
     PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
     CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
     gcloud run services add-iam-policy-binding suchi-api \
       --member="serviceAccount:${CLOUD_BUILD_SA}" \
       --role="roles/run.invoker" \
       --region=us-central1
     ```

3. **Verify ID token generation works:**
   ```bash
   gcloud auth print-identity-token
   ```

### 2. Health Check Timeout

**Symptoms:**
- Build fails at `healthcheck-candidate` step
- Logs show: `❌ Candidate revision never became healthy after 5 minutes`
- All 60 attempts failed

**Root Cause:**
- Container cold start taking longer than 5 minutes
- Service failing to start (crash loop)
- Network/routing issue preventing access to revision URL

**Diagnostic Commands:**
```bash
# Check revision status
LATEST_REVISION=$(gcloud run revisions list --service=suchi-api --region=us-central1 --limit=1 --format='value(name)')
gcloud run revisions describe "$LATEST_REVISION" --region=us-central1

# Check revision logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=suchi-api" \
  --limit=50 \
  --format=json

# Test revision URL directly
REVISION_URL=$(gcloud run revisions describe "$LATEST_REVISION" --region=us-central1 --format='value(status.url)')
curl -v "${REVISION_URL}/v1/health"
```

**Fix:**
1. **If cold start is too long:**
   - Increase health check timeout in `cloudbuild.gated.yaml`:
     ```yaml
     # Change from 60 to 84 attempts (7 minutes)
     for i in $(seq 1 84); do
     ```

2. **If service is crashing:**
   - Check revision logs for errors
   - Verify environment variables and secrets are correct
   - Check database connectivity
   - Fix the underlying issue and redeploy

3. **If revision URL is inaccessible:**
   - Verify revision was created: `gcloud run revisions list --service=suchi-api --region=us-central1`
   - Check if revision has 0% traffic (expected for candidate)
   - Test revision URL manually

## Next Steps

1. **Test the gated build** on a feature branch
2. **Set up Cloud Build trigger** to use gated build on `main`
3. **Monitor first few deployments** to ensure smooth operation

## Rollback Plan

If a bad revision gets through:

1. **Immediate:** Manually shift traffic to previous revision:
   ```bash
   # List revisions
   gcloud run revisions list --service=suchi-api --region=us-central1
   
   # Shift to previous revision
   gcloud run services update-traffic suchi-api \
     --to-revisions=PREVIOUS_REVISION=100 \
     --region=us-central1
   ```

2. **Fix:** Address the issue in code

3. **Redeploy:** Run gated build again
