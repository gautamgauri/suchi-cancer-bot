# Handoff: Deploy Deterministic Extractor Enhancements

**Date**: 2026-01-19  
**Assigned To**: @devops-gcp-deployer  
**Priority**: Medium  
**Status**: Open

## Task Summary

Deploy the deterministic extraction layer enhancements after eval verification confirms improvements.

## Changes to Deploy

**Files Modified**:
1. `apps/api/src/modules/chat/chat.service.spec.ts` - Added integration tests
2. `apps/api/src/modules/chat/chat.service.ts` - Added observability logging and improved fallback insertion

**Key Changes**:
- Structured logging for completeness outcomes (observability)
- Improved fallback insertion with multiple pattern matching
- Integration tests for extract → generate → enforce pipeline

## Deployment Steps

1. **Wait for eval verification** (from @tests-eval-author)
2. **Commit changes** (if not already committed)
3. **Trigger Cloud Build**:
   ```bash
   gcloud builds submit --config=cloudbuild.yaml --substitutions=SHORT_SHA=$(git rev-parse --short HEAD)
   ```
4. **Verify deployment**:
   - Check Cloud Build logs for success
   - Verify new revision is active
   - Check service health

## Expected Behavior

After deployment:
- Structured logs will show completeness outcomes in Cloud Logging
- Fallback insertion will be more robust (multiple insertion points)
- Integration tests will verify pipeline correctness

## Monitoring

Watch for these log messages in Cloud Logging:
- `event: "completeness_check"` - Structured logs with coverage metrics
- `fallbackInserted: true/false` - Indicates when fallback was needed
- `meetsPolicy: true/false` - Indicates if response met completeness policy

## Related Documentation

- `docs/ops/handoffs/2026-01-19-tests-eval-author-extractor-verification.md` - Eval verification handoff
