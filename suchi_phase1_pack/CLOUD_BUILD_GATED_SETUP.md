# Cloud Build Gated Deployment Setup

## What Was Created

### 1. Gated Cloud Build Configuration
**File:** `cloudbuild.gated.yaml`

A Cloud Build pipeline that:
- ✅ Builds and pushes Docker image
- ✅ Deploys candidate revision with 0% traffic (tagged 'candidate')
- ✅ Waits for candidate to be healthy
- ✅ Runs `eval:tier1` against candidate revision
- ✅ Only shifts traffic if eval passes
- ✅ Deploys web after API is promoted

### 2. Documentation
- `docs/GATED_DEPLOYMENT.md` - Complete guide for gated deployment
- This file - Quick setup reference

## Key Configuration Details

### Service Information
- **Service Name:** `suchi-api`
- **Region:** `us-central1`
- **Health Endpoint:** `/v1/health` (global prefix is `/v1`)
- **API Base URL:** `https://suchi-api-lxiveognla-uc.a.run.app/v1`

### Eval Configuration
- **Eval Runner:** Already supports `EVAL_API_BASE_URL` env var ✅
- **Eval Command:** `cd eval && npm ci && npm run build && npm run eval:tier1`
- **LLM Provider:** Deepseek (configurable via `EVAL_LLM_PROVIDER`)

## Required Secrets

Ensure these secrets exist in Google Cloud Secret Manager:

1. **deepseek-api-key** (or openai-api-key)
   ```bash
   echo -n "your-api-key" | gcloud secrets create deepseek-api-key --data-file=-
   ```

2. **Standard secrets** (should already exist):
   - `database-url`
   - `openai-api-key`
   - `embedding-api-key`
   - `admin-basic-user`
   - `admin-basic-pass`

## Usage

### Run Gated Deployment

```bash
gcloud builds submit --config=cloudbuild.gated.yaml
```

### Run Original Deployment (No Gate)

```bash
gcloud builds submit --config=cloudbuild.yaml
```

## How It Works

### Deployment Flow

```
1. Build API Docker image
   ↓
2. Push to Artifact Registry
   ↓
3. Deploy candidate revision (0% traffic, tagged 'candidate')
   ↓
4. Wait for candidate to be healthy (/v1/health)
   ↓
5. Run eval:tier1 against candidate revision URL
   ↓
6a. If eval passes → Shift 100% traffic to candidate
6b. If eval fails → Build stops, traffic stays on previous revision
   ↓
7. Deploy web (after API is promoted)
```

### Candidate Revision Access

The candidate revision is accessed via its **revision-specific URL** (not the service URL), which allows testing even with 0% traffic:

```bash
# Get revision URL
REVISION_URL=$(gcloud run revisions describe REVISION_NAME --region=us-central1 --format='value(status.url)')
# API base URL
CANDIDATE_API_URL="${REVISION_URL}/v1"
```

## Eval Expectations (NCI-only Corpus)

Since your corpus is NCI-only, the eval gate expects:

- **Top-3 Trusted Source Presence:** Near 100% (all NCI)
- **Citation Coverage:** Near 100%
- **Abstention Rate:** Low (<10%) for informational queries
- **Improved Cases:** At least 3 cases showing improved top-3 relevance

**If any of these fail, the build stops and traffic doesn't shift.**

## Setting Up Cloud Build Trigger

### Option 1: GitHub Trigger (Recommended)

```bash
gcloud builds triggers create github \
  --name="gated-deploy-main" \
  --repo-name="YOUR_REPO_NAME" \
  --repo-owner="YOUR_GITHUB_USERNAME" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.gated.yaml" \
  --region="us-central1"
```

### Option 2: Manual Trigger

```bash
gcloud builds submit --config=cloudbuild.gated.yaml
```

## Testing the Setup

### 1. Test Health Check

```bash
# Deploy a test revision
gcloud run deploy suchi-api \
  --image=YOUR_IMAGE \
  --tag=test \
  --no-traffic \
  --region=us-central1

# Get revision URL and test health
REVISION=$(gcloud run revisions list --service=suchi-api --region=us-central1 --limit=1 --format='value(name)')
REVISION_URL=$(gcloud run revisions describe "$REVISION" --region=us-central1 --format='value(status.url)')
curl "${REVISION_URL}/v1/health"
```

### 2. Test Eval Locally Against Candidate

```bash
# Get candidate revision URL
REVISION=$(gcloud run revisions list --service=suchi-api --region=us-central1 --limit=1 --format='value(name)')
REVISION_URL=$(gcloud run revisions describe "$REVISION" --region=us-central1 --format='value(status.url)')

# Run eval
cd eval
EVAL_API_BASE_URL="${REVISION_URL}/v1" npm run eval:tier1
```

### 3. Test Full Gated Build

```bash
# Run the gated build
gcloud builds submit --config=cloudbuild.gated.yaml

# Monitor in Cloud Console
# Go to Cloud Build → History → Click on build
```

## Troubleshooting

### Candidate Revision Not Accessible

**Issue:** Health check or eval can't reach candidate revision

**Solution:**
- Verify revision was created: `gcloud run revisions list --service=suchi-api --region=us-central1`
- Check revision URL: `gcloud run revisions describe REVISION_NAME --region=us-central1 --format='value(status.url)'`
- Verify health endpoint: `curl "${REVISION_URL}/v1/health"`

### Eval Fails

**Issue:** Eval step fails, blocking deployment

**Check:**
1. Review eval report in Cloud Build logs
2. Verify metrics meet thresholds
3. Check for retrieval quality regressions
4. Verify NCI source metadata

**Fix:**
- Address code issues
- Re-run build

### Traffic Doesn't Shift

**Issue:** Eval passes but traffic stays on previous revision

**Check:**
- Cloud Build logs for `promote-candidate` step
- Verify step completed successfully

**Manual Override:**
```bash
gcloud run services update-traffic suchi-api \
  --to-latest \
  --region=us-central1
```

## Next Steps

1. **Add secrets** to Secret Manager (if not already present)
2. **Test health check** against a candidate revision
3. **Test eval** locally against candidate URL
4. **Run first gated build** manually
5. **Set up Cloud Build trigger** for automatic deployments
6. **Monitor first few deployments** to ensure smooth operation

## Rollback

If a bad revision gets through:

```bash
# List revisions
gcloud run revisions list --service=suchi-api --region=us-central1

# Shift traffic to previous revision
gcloud run services update-traffic suchi-api \
  --to-revisions=PREVIOUS_REVISION=100 \
  --region=us-central1
```

## Comparison: Gated vs Original

| Feature | `cloudbuild.gated.yaml` | `cloudbuild.yaml` |
|---------|------------------------|-------------------|
| Eval Gate | ✅ Yes | ❌ No |
| Candidate Revision | ✅ Yes | ❌ No |
| Traffic Safety | ✅ Only shifts if eval passes | ⚠️ Direct deployment |
| Use Case | Production deployments | Emergency fixes |

**Recommendation:** Use gated build for all production deployments, original build only for emergency fixes.
