# GitHub Actions Workflows

## eval-tier1.yml

Runs Tier1 retrieval quality evaluation against the Suchi API.

### Current Status: **Non-Blocking**

This workflow runs in non-blocking mode until Pass 2/3 verification is complete. It will:
- ✅ Run on manual trigger (`workflow_dispatch`)
- ✅ Run nightly on schedule
- ✅ Run on PRs touching RAG/evidence code (non-blocking)
- ⚠️ Continue on error (won't block merges)

### After Pass 2/3 Verification

Once you've confirmed:
- ≥3 cases showing improved top-3 relevance
- Citation coverage not degraded
- Abstention rate stable
- Trace logs look rational

**To make it required:**
1. Remove `continue-on-error: true` from the "Run Tier1 Eval" step
2. Add branch protection rule requiring `eval-tier1` check to pass
3. Optionally remove `continue-on-error` from PR trigger

### Usage

**Manual trigger:**
```bash
# Uses default live service URL
gh workflow run eval-tier1.yml

# Or specify a candidate revision URL
gh workflow run eval-tier1.yml -f api_url=https://suchi-api-lxiveognla-uc.a.run.app/v1
```

**Required Secrets:**
- `DEEPSEEK_API_KEY` (or `OPENAI_API_KEY` if using OpenAI)
- `EVAL_LLM_PROVIDER` (optional, defaults to 'deepseek')
- `GOOGLE_CLOUD_PROJECT` (optional, for Secret Manager)

### Integration with Cloud Run Candidate Revisions

To test against a candidate revision before shifting traffic:

1. Deploy candidate revision with tag:
   ```bash
   gcloud run deploy suchi-api \
     --image=... \
     --tag=candidate \
     --no-traffic
   ```

2. Get candidate URL:
   ```bash
   gcloud run services describe suchi-api --format='value(status.url)'
   # Append /v1 for API base URL
   ```

3. Run eval against candidate:
   ```bash
   gh workflow run eval-tier1.yml -f api_url=<candidate-url>/v1
   ```

4. If eval passes, shift traffic:
   ```bash
   gcloud run services update-traffic suchi-api \
     --to-latest
   ```

### Expected Metrics (NCI-only corpus)

Since the corpus is NCI-only, expectations are strict:
- **Top-3 Trusted Source Presence:** Should be near 100% (all NCI)
- **Citation Coverage:** Should be near 100%
- **Abstention Rate:** Should be low (<10%) for informational queries

If these metrics degrade, it's a clear signal of a retrieval/citation issue.
