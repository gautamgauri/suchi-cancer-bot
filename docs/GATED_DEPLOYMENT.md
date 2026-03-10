# Gated Deployment with Cloud Build

## Overview

This deployment pattern provides "staging safety" without creating a separate environment. It works by:

1. Deploying a **candidate revision** with 0% traffic
2. Running `eval:tier1` against the candidate
3. Only shifting traffic to the candidate if eval passes
4. If eval fails, the build stops and live traffic remains on the previous revision

## How It Works

### Step-by-Step Flow

```
1. Build Docker image
   ↓
2. Push to Artifact Registry
   ↓
3. Deploy candidate revision (0% traffic, tagged 'candidate')
   ↓
4. Wait for candidate to be healthy
   ↓
5. Run eval:tier1 against candidate URL
   ↓
6. If eval passes → Shift 100% traffic to candidate
   If eval fails → Build stops, traffic stays on previous revision
   ↓
7. Deploy web (after API is promoted)
```

### Key Benefits

- ✅ **No separate staging environment** - uses the same Cloud Run service
- ✅ **Zero risk to live users** - traffic only shifts after eval passes
- ✅ **Automatic rollback** - if eval fails, previous revision stays live
- ✅ **NCI-optimized** - strict expectations for NCI-only corpus

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

Ensure these secrets exist in Google Cloud Secret Manager:

#### Eval Framework Secrets (Required for Gated Build)

1. **deepseek-api-key** (or openai-api-key)
   - Used by the LLM judge in eval framework
   - **Creation command:**
     ```bash
     echo -n "your-deepseek-api-key" | gcloud secrets create deepseek-api-key --data-file=-
     ```
   - **Or update existing:**
     ```bash
     echo -n "your-deepseek-api-key" | gcloud secrets versions add deepseek-api-key --data-file=-
     ```
   - **Verify:**
     ```bash
     gcloud secrets versions access latest --secret=deepseek-api-key
     ```

2. **openai-api-key** (optional, if using OpenAI instead of Deepseek)
   - **Creation command:**
     ```bash
     echo -n "your-openai-api-key" | gcloud secrets create openai-api-key --data-file=-
     ```

#### Standard API Secrets (Already Configured)

These secrets are used by the API service itself:

- `database-url` - PostgreSQL connection string
- `openai-api-key` - OpenAI API key for embeddings/LLM
- `embedding-api-key` - Embedding API key (if separate)
- `admin-basic-user` - Basic auth username
- `admin-basic-pass` - Basic auth password

**Verification:**
```bash
# List all secrets
gcloud secrets list

# Verify a specific secret exists
gcloud secrets describe deepseek-api-key
```

**Troubleshooting Missing Secrets:**

If the build fails with "secret not found" errors:

1. Check which secret is missing:
   ```bash
   gcloud secrets list | grep -E "deepseek|openai"
   ```

2. Create the missing secret using commands above

3. Verify the secret is accessible:
   ```bash
   gcloud secrets versions access latest --secret=deepseek-api-key
   ```

4. Ensure the Cloud Build service account has access:
   ```bash
   # Get the Cloud Build service account email
   PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
   CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
   
   # Grant secret accessor role
   gcloud secrets add-iam-policy-binding deepseek-api-key \
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

## Eval Expectations (NCI-only Corpus)

Since your corpus is NCI-only, the eval gate expects:

- **Top-3 Trusted Source Presence:** Near 100% (all NCI)
- **Citation Coverage:** Near 100%
- **Abstention Rate:** Low (<10%) for informational queries
- **Improved Cases:** At least 3 cases showing improved top-3 relevance

If these metrics fail, the build stops and traffic doesn't shift.

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
- Increase health check retries (currently 30 attempts, 5s apart = 2.5 minutes)
- Verify health endpoint is `/health` (not `/v1/health`)
- Check Cloud Run service logs

### Eval Fails

**Symptoms:**
- Build fails at `eval-tier1` step
- Report shows metrics below thresholds

**Possible Causes:**
- Retrieval quality regression
- Citation integrity issues
- Abstention rate increase

**Solutions:**
- Review eval report artifact in Cloud Build logs
- Check for code changes that might affect retrieval
- Verify NCI source metadata is correct
- Fix issues and re-run build

### Traffic Doesn't Shift

**Symptoms:**
- Eval passes but traffic stays on previous revision

**Possible Causes:**
- `promote-candidate` step failed silently
- Cloud Run traffic update failed

**Solutions:**
- Check Cloud Build logs for `promote-candidate` step
- Manually shift traffic: `gcloud run services update-traffic suchi-api --to-latest --region us-central1`

## Manual Override

If you need to deploy without eval (e.g., emergency fix):

1. Use original `cloudbuild.yaml`:
   ```bash
   gcloud builds submit --config=cloudbuild.yaml
   ```

2. Or temporarily disable eval step in `cloudbuild.gated.yaml` by commenting it out

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
- Check `eval-tier1` step for eval results

### Eval Report Artifacts

Eval reports are automatically uploaded as Cloud Build artifacts:

1. **Access via Cloud Console:**
   - Go to Cloud Build → History → Click on build
   - Click "Artifacts" tab
   - Download `tier1-report.json` and `tier1-summary.txt`

2. **Access via gsutil:**
   ```bash
   # List artifacts for a build
   gsutil ls gs://${PROJECT_ID}_cloudbuild/${BUILD_ID}/eval-reports/
   
   # Download reports
   gsutil cp gs://${PROJECT_ID}_cloudbuild/${BUILD_ID}/eval-reports/* ./eval-reports/
   ```

3. **Summary is also printed to build logs:**
   - Check the `generate-eval-summary` step output
   - Includes metrics and improved case count

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

### 3. Eval Timeout

**Symptoms:**
- Build fails at `eval-tier1` step
- Logs show: `Error: Timeout of 1800000ms exceeded`
- Eval step times out after 30 minutes

**Root Cause:**
- LLM provider (Deepseek/OpenAI) is slow or unresponsive
- Too many test cases (should be ~15 for tier1)
- Network issues between Cloud Build and LLM provider
- Per-case retries exhausting timeout

**Diagnostic Commands:**
```bash
# Check eval report (if partial)
cd eval
cat reports/tier1-report.json | jq '.summary'

# Test LLM provider connectivity
curl -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  https://api.deepseek.com/v1/models

# Check eval case count
cat cases/tier1/retrieval_quality.yaml | grep -c "^- id:"
```

**Fix:**
1. **If LLM provider is slow:**
   - Increase eval step timeout in `cloudbuild.gated.yaml`:
     ```yaml
     timeout: '3600s'  # 60 minutes
     ```
   - Or reduce test cases temporarily

2. **If too many cases:**
   - Verify tier1 has ~15 cases (not 100+)
   - Consider splitting into smaller batches

3. **If network issues:**
   - Check LLM provider status
   - Verify API keys are valid
   - Retry the build

4. **Add per-case timeout:**
   - Already handled by eval framework (60s per case)
   - Verify `EVAL_TIMEOUT_MS` is reasonable

### 4. Citation Coverage Drop

**Symptoms:**
- Build fails at `nci-dominance-gate` or eval shows low citation coverage
- Logs show: `Citation Coverage: 75%` (below 90% threshold)
- Eval report shows many cases with missing citations

**Root Cause:**
- Orphan citation filtering too aggressive
- Citation extraction bug
- LLM not generating citations correctly
- Retrieved chunks not being cited

**Diagnostic Commands:**
```bash
# Check eval report for citation details
cd eval
cat reports/tier1-report.json | jq '.results[] | select(.retrievalQuality.citationCoverage < 1.0) | {id: .testCaseId, coverage: .retrievalQuality.citationCoverage}'

# Check for citation integrity warnings in API logs
gcloud logging read "resource.type=cloud_run_revision AND textPayload=~'CITATION_INTEGRITY'" \
  --limit=20
```

**Fix:**
1. **If orphan filtering is too aggressive:**
   - Check `apps/api/src/modules/citations/citation.service.ts`
   - Review `[CITATION_INTEGRITY]` warnings in logs
   - Verify citation-to-chunk mapping logic
   - Adjust filtering threshold if needed

2. **If citations aren't being generated:**
   - Check LLM prompt includes citation instructions
   - Verify retrieved chunks are passed to LLM
   - Review citation extraction regex patterns

3. **If retrieved chunks aren't being cited:**
   - Verify `retrievedChunks` are included in API response
   - Check that LLM has access to chunk metadata
   - Review evidence coupling logic

### 5. Trusted Presence Drop (NCI Dominance Gate Failure)

**Symptoms:**
- Build fails at `nci-dominance-gate` step
- Logs show: `❌ BUILD FAILED: NCI Dominance Gate`
- `Top-3 Trusted Presence Rate: 75%` (below 90% threshold)

**Root Cause:**
- Reranking not working correctly
- Source metadata misclassified (non-NCI marked as trusted)
- Non-NCI sources in corpus (unexpected)
- Retrieval pulling from wrong sources

**Diagnostic Commands:**
```bash
# Check eval report for source types
cd eval
cat reports/tier1-report.json | jq '.results[] | .retrievalQuality.top3SourceTypes'

# Check source metadata in database
gcloud sql connect suchi-db --user=postgres
# Then: SELECT DISTINCT "sourceType", "isTrustedSource" FROM "Document" LIMIT 20;

# Check reranking logs (if RAG_TRACE_RERANK enabled)
gcloud logging read "resource.type=cloud_run_revision AND textPayload=~'RERANK'" \
  --limit=20
```

**Fix:**
1. **If reranking not working:**
   - Verify `rerankByTrustedSource` is being called
   - Check `apps/api/src/modules/rag/rag.service.ts`
   - Enable `RAG_TRACE_RERANK=true` and review logs
   - Verify trusted source config is correct

2. **If source metadata is wrong:**
   - Check `apps/api/src/config/trusted-sources.config.ts`
   - Verify NCI sources are marked as trusted
   - Review source type classification logic
   - Fix metadata and re-ingest if needed

3. **If non-NCI sources in corpus:**
   - This shouldn't happen for NCI-only corpus
   - Check KB ingestion logs
   - Verify only NCI sources are being ingested
   - Clean up any non-NCI sources

4. **Temporary workaround (not recommended):**
   - Lower threshold in `cloudbuild.gated.yaml`:
     ```javascript
     const threshold = 0.85; // Lower from 0.90
     ```
   - **Only do this if you understand why trusted presence dropped**

## Next Steps

1. **Test the gated build** on a feature branch
2. **Verify eval passes** with your current code
3. **Set up Cloud Build trigger** to use gated build on `main`
4. **Monitor first few deployments** to ensure smooth operation

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
