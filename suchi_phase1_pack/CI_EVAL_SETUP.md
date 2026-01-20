# CI Eval Setup - Non-Blocking Mode

## What Was Created

### 1. GitHub Actions Workflow
**File:** `.github/workflows/eval-tier1.yml`

A non-blocking CI workflow that:
- ✅ Runs on manual trigger (`workflow_dispatch`)
- ✅ Runs nightly on schedule (2 AM UTC)
- ✅ Runs on PRs touching RAG/evidence code (non-blocking)
- ✅ Uploads reports as artifacts
- ✅ Generates summary in GitHub Actions UI

### 2. Documentation
- `.github/workflows/README.md` - Workflow usage guide
- `.github/workflows/MAKING_EVAL_REQUIRED.md` - Guide for making it required after verification

## Current Configuration: Non-Blocking

The workflow uses `continue-on-error: true` on the eval step, meaning:
- ⚠️ It won't block merges or deployments
- ✅ It will still run and report results
- ✅ Reports are uploaded as artifacts for review
- ✅ Warnings are logged but don't fail the workflow

## Required Secrets

Add these to your GitHub repository secrets (Settings → Secrets and variables → Actions):

1. **DEEPSEEK_API_KEY** (or OPENAI_API_KEY if using OpenAI)
   - Used by the LLM judge in the eval framework
   - Get from your Deepseek/OpenAI account

2. **EVAL_LLM_PROVIDER** (optional)
   - Defaults to 'deepseek' if not set
   - Options: 'deepseek', 'openai', 'vertex_ai'

3. **GOOGLE_CLOUD_PROJECT** (optional)
   - Defaults to 'gen-lang-client-0202543132' if not set
   - Used for Secret Manager access

## Usage

### Manual Trigger

**Via GitHub UI:**
1. Go to Actions tab
2. Select "Eval Tier1 - Retrieval Quality"
3. Click "Run workflow"
4. Optionally specify a different API URL (e.g., candidate revision)
5. Click "Run workflow"

**Via CLI:**
```bash
# Uses default live service
gh workflow run eval-tier1.yml

# Specify candidate revision URL
gh workflow run eval-tier1.yml -f api_url=https://suchi-api-lxiveognla-uc.a.run.app/v1
```

### Automatic Triggers

- **Nightly:** Runs automatically at 2 AM UTC
- **On PRs:** Runs when PRs touch RAG/evidence code (non-blocking)

## Viewing Results

1. **GitHub Actions UI:**
   - Go to Actions tab
   - Click on the workflow run
   - View the "Generate summary" step for metrics
   - Download artifacts for full report JSON

2. **Report Artifacts:**
   - Click "tier1-eval-report-{number}" artifact
   - Download `tier1-report.json`
   - Review metrics and per-case results

## Expected Metrics (NCI-only Corpus)

Since your corpus is NCI-only, expectations are strict:

- **Top-3 Trusted Source Presence:** Should be near 100% (all NCI)
- **Citation Coverage:** Should be near 100%
- **Abstention Rate:** Should be low (<10%) for informational queries
- **Improved Cases:** At least 3 cases showing improved top-3 relevance

## Testing Against Candidate Revisions

To test against a candidate revision before shifting traffic:

1. **Deploy candidate revision:**
   ```bash
   gcloud run deploy suchi-api \
     --image=gcr.io/PROJECT/suchi-api:SHORT_SHA \
     --tag=candidate \
     --no-traffic \
     --region=us-central1
   ```

2. **Get candidate URL:**
   ```bash
   # Get the tagged revision URL
   gcloud run services describe suchi-api \
     --region=us-central1 \
     --format='value(status.url)'
   # Append /v1 for API base URL
   ```

3. **Run eval against candidate:**
   ```bash
   gh workflow run eval-tier1.yml \
     -f api_url=https://suchi-api-XXXXX-uc.a.run.app/v1
   ```

4. **If eval passes, shift traffic:**
   ```bash
   gcloud run services update-traffic suchi-api \
     --to-latest \
     --region=us-central1
   ```

## Making It Required (After Pass 2/3)

Once you've verified:
- ≥3 cases improved
- Citation coverage stable
- Abstention rate acceptable
- Trace logs rational

Follow the guide in `.github/workflows/MAKING_EVAL_REQUIRED.md` to:
1. Remove `continue-on-error`
2. Add branch protection rule
3. Make it a required check

## Troubleshooting

### Workflow Fails to Start
- Check that secrets are configured
- Verify API URL is accessible
- Check GitHub Actions permissions

### Eval Fails but Workflow Continues
- This is expected in non-blocking mode
- Review the report artifact to identify issues
- Check logs in the "Run Tier1 Eval" step

### No Report Generated
- Check that `eval/reports/tier1-report.json` exists
- Verify eval package built successfully
- Check API connectivity

### API Health Check Fails
- Health check is non-blocking (`continue-on-error: true`)
- Eval will still run even if health check fails
- Verify API is accessible manually

## Next Steps

1. **Add secrets** to GitHub repository
2. **Test manual trigger** to verify setup
3. **Complete Pass 2/3 verification** locally
4. **Review first CI run** results
5. **Make it required** after verification passes

## Integration with Cloud Build (Future)

Once eval is required and stable, you can integrate it into your Cloud Build pipeline to run before deployment. See `.github/workflows/MAKING_EVAL_REQUIRED.md` for an example.
