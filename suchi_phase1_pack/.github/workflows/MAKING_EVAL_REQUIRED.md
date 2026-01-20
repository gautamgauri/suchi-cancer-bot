# Making Eval Tier1 a Required Check

## Current Status: Non-Blocking

The `eval-tier1.yml` workflow currently runs with `continue-on-error: true`, meaning it won't block merges or deployments.

## When to Make It Required

After completing Pass 2 and Pass 3 verification and confirming:
- ✅ ≥3 cases showing improved top-3 relevance
- ✅ Citation coverage not degraded materially
- ✅ Abstention rate stable for informational cases
- ✅ Trace logs look rational (no bizarre reranking jumps)

## Steps to Make It Required

### Step 1: Remove continue-on-error

Edit `.github/workflows/eval-tier1.yml`:

**Find:**
```yaml
      - name: Run Tier1 Eval
        working-directory: eval
        env:
          ...
        run: |
          npm run eval:tier1
        continue-on-error: true  # Non-blocking until Pass 2/3 verified
        id: eval-run
```

**Change to:**
```yaml
      - name: Run Tier1 Eval
        working-directory: eval
        env:
          ...
        run: |
          npm run eval:tier1
        # continue-on-error removed - now blocking
        id: eval-run
```

### Step 2: Update result check to fail on warnings

**Find:**
```yaml
      - name: Check eval results
        if: always()
        run: |
          if [ "${{ steps.eval-run.outcome }}" != "success" ]; then
            echo "⚠️ Eval run completed with errors (non-blocking mode)"
            echo "Review the report artifact to identify issues"
            exit 0  # Don't fail the workflow in non-blocking mode
          fi
```

**Change to:**
```yaml
      - name: Check eval results
        if: always()
        run: |
          if [ "${{ steps.eval-run.outcome }}" != "success" ]; then
            echo "❌ Eval run failed - blocking merge"
            exit 1  # Fail the workflow
          fi
          
          # Check if report exists and has reasonable metrics
          if [ -f "eval/reports/tier1-report.json" ]; then
            node -e "
              const fs = require('fs');
              const report = JSON.parse(fs.readFileSync('eval/reports/tier1-report.json', 'utf8'));
              const q = report.summary.retrievalQuality || {};
              
              // Count improved cases (top3TrustedPresence === true)
              const improved = report.results.filter(r => r.retrievalQuality?.top3TrustedPresence).length;
              
              // Fail if metrics are below expectations
              if (improved < 3) {
                console.error('❌ FAIL: Less than 3 cases showing improved top-3 relevance');
                process.exit(1);
              }
              if (q.citationCoverageRate < 0.90) {
                console.error('❌ FAIL: Citation coverage below 90%');
                process.exit(1);
              }
              if (q.abstentionRate > 0.10) {
                console.error('❌ FAIL: Abstention rate above 10%');
                process.exit(1);
              }
              
              console.log('✅ All metrics passed');
            "
          else
            echo "❌ No report file found"
            exit 1
          fi
```

### Step 3: Add Branch Protection Rule (Optional but Recommended)

In GitHub repository settings:
1. Go to Settings → Branches
2. Add or edit branch protection rule for `main` (or your default branch)
3. Under "Require status checks to pass before merging":
   - Check "Require status checks to pass before merging"
   - Add `eval-tier1` to the list of required checks

**Note:** For solo developer, you can skip branch protection and just rely on the workflow failing, but branch protection adds an extra safety layer.

### Step 4: Update PR Trigger (Optional)

If you want eval to run on all PRs (not just RAG-related), you can modify the `pull_request` trigger:

**Current (only RAG-related PRs):**
```yaml
  pull_request:
    paths:
      - 'apps/api/src/modules/rag/**'
      - 'apps/api/src/modules/evidence/**'
      ...
```

**To run on all PRs:**
```yaml
  pull_request:
    # Runs on all PRs
```

Or keep it path-based but remove `continue-on-error` from the PR context.

## Testing the Required Mode

Before making it required on `main`, test on a feature branch:

1. Create a test branch
2. Make a small change that would fail eval (e.g., break citation integrity)
3. Push and create PR
4. Verify the workflow fails and blocks merge
5. Revert the change
6. Verify the workflow passes

## Rollback Plan

If you need to temporarily disable the required check:
1. Re-add `continue-on-error: true` to the eval step
2. Or disable the workflow in GitHub Actions settings
3. Fix the issue
4. Re-enable

## Integration with Cloud Build (Future)

Once eval is required and stable, you can integrate it into your Cloud Build pipeline:

```yaml
# In cloudbuild.yaml, add before deploy-api step:
  - name: 'gcr.io/cloud-builders/npm'
    id: 'eval-tier1'
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        cd eval
        npm ci
        npm run build
        EVAL_API_BASE_URL=$${_API_URL} npm run eval:tier1
    env:
      - 'DEEPSEEK_API_KEY=$${_DEEPSEEK_API_KEY}'
```

This runs eval before deploying, ensuring only passing revisions get deployed.
