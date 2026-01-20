# Fix Summary: 504 Timeout Issue

**Date**: 2026-01-19  
**Fixed By**: @devops-gcp-deployer  
**Build ID**: dd8a14cd-5577-4b6d-8bae-998eb59ee22a

## Root Cause

**Timeout Mismatch**: Controller had 60-second timeout, but eval framework waits 180 seconds. Requests were timing out at 60s, causing 504 Gateway Timeout errors.

## Fix Applied

1. **Increased Controller Timeout** (`apps/api/src/modules/chat/chat.controller.ts`):
   - Changed from: `60000ms` (60 seconds)
   - Changed to: `180000ms` (180 seconds / 3 minutes)
   - Matches eval framework timeout configuration

2. **Explicit Cloud Run Timeout** (`cloudbuild.yaml`):
   - Added `--timeout 300` to deployment args
   - Ensures Cloud Run allows up to 5 minutes (300s) for requests
   - Controller timeout (180s) is within Cloud Run limit

## Files Changed

- `apps/api/src/modules/chat/chat.controller.ts` - Increased REQUEST_TIMEOUT_MS to 180000
- `cloudbuild.yaml` - Added explicit --timeout 300 parameter

## Verification

After deployment, service should:
- ✅ Accept requests up to 180 seconds
- ✅ Not timeout at 60 seconds
- ✅ Allow eval framework to complete tests

## Next Steps

1. **@tests-eval-author**: Re-run verification tests
   ```bash
   cd eval && npm run eval run -- --cases cases/tier1/retrieval_quality_sample.yaml --output reports/health-check.json --summary
   ```

2. **Expected**: Tests should complete without 504 errors (may still fail evaluation, but should not timeout)

## Risks

- **None identified**: Timeout increase is safe and matches eval framework expectations
- **Resource usage**: Longer timeouts may hold connections longer, but Cloud Run handles this automatically
