# Handoff: Critical 504 Timeout Issues - All API Requests Failing

**Date**: 2026-01-19  
**Assigned To**: @devops-gcp-deployer  
**Priority**: **CRITICAL**  
**Status**: ✅ **FIXED** (Build ID: dd8a14cd-5577-4b6d-8bae-998eb59ee22a)

## Problem Summary

**All API requests are timing out with 504 errors** after the urgent response template fix deployment.

## Evidence

**Test Results** (`eval/reports/urgent-fix-verification.json`):
- RQ-BREAST-01: `504 Gateway Timeout`
- RQ-LUNG-01: `504 Gateway Timeout`
- RQ-ORAL-01: `504 Gateway Timeout`
- **All 3 test cases failed** with timeout errors
- **Average Score: 0.0%** (all tests failed)

## Timeline

1. **Deployment**: Build ID `3ea88cfe-aeb3-4fd2-92eb-1dfbe7739821` - Status: SUCCESS
2. **Service URL**: `https://suchi-api-lxiveognla-uc.a.run.app`
3. **Test Run**: All requests timing out immediately

## Possible Causes

1. **Service Not Running**: Cloud Run service may have crashed or not started
2. **Timeout Configuration**: Request timeout may be too low (currently 60s in controller)
3. **Resource Limits**: Service may be hitting memory/CPU limits
4. **Database Connection**: Cloud SQL connection may be failing
5. **Cold Start Issues**: Service may be taking too long to start

## Immediate Actions Required

1. **Check Service Status**:
   ```bash
   gcloud run services describe suchi-api --region us-central1
   ```

2. **Check Service Logs**:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=suchi-api" --limit 50 --format json
   ```

3. **Verify Service Health**:
   ```bash
   curl -v https://suchi-api-lxiveognla-uc.a.run.app/v1/health
   ```

4. **Check Recent Deployments**:
   ```bash
   gcloud run revisions list --service suchi-api --region us-central1 --limit 5
   ```

## Configuration to Check

1. **Request Timeout** (`apps/api/src/modules/chat/chat.controller.ts`):
   - Currently: 60 seconds
   - May need to increase or check if service is actually processing

2. **Cloud Run Timeout** (`cloudbuild.yaml`):
   - Check if Cloud Run service timeout is set correctly
   - Default is 300s, but may need adjustment

3. **Service Resources**:
   - Memory: 512Mi (may be insufficient)
   - CPU: 1 (may be insufficient)
   - Min instances: 0 (cold starts may be causing issues)

## Expected Fix

1. **Immediate**: Get service responding (even if slow)
2. **Short-term**: Identify root cause (logs, metrics)
3. **Long-term**: Optimize timeout/resource configuration

## Verification

After fix:
```bash
cd eval
npm run eval run -- --cases cases/tier1/retrieval_quality_sample.yaml --output reports/health-check.json --summary
```

**Expected**: At least one test should complete (even if it fails evaluation, should not timeout).

## Allowed Paths

- `cloudbuild.yaml` - Deployment configuration
- `apps/api/cloudrun-service.yaml` - Cloud Run service config
- `apps/api/src/modules/chat/chat.controller.ts` - Timeout configuration
- `docs/ops/handoffs/**` - For status updates

## Related Handoffs

- `docs/ops/handoffs/2026-01-19-devops-deploy-urgent-template-fix.md` - Recent deployment
- `docs/ops/handoffs/2026-01-19-devops-timeout-504-errors.md` - Previous timeout issues

## Urgency

**CRITICAL** - All evaluation tests are blocked. Service appears to be completely unresponsive.
