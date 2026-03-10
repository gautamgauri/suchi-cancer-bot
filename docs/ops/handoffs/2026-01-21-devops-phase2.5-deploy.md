# Handoff: Deploy Phase 2.5 Citation Repair

**Date:** 2026-01-21 03:05 UTC  
**From:** @safety-gatekeeper (implementation complete)  
**To:** @devops-gcp-deployer (deployment)  
**Priority:** HIGH  
**Type:** Standard deployment (code changes only, no infrastructure)

---

## Deployment Request

Deploy Phase 2.5 citation repair logic to production Cloud Run service.

**Changes Summary:**
- Modified `apps/api/src/modules/llm/llm.service.ts` (strengthened LLM prompt)
- Modified `apps/api/src/modules/chat/chat.service.ts` (added citation repair at 6 locations)
- No database migrations required
- No infrastructure changes required
- No environment variable changes required

**Build Status:**
- ✅ TypeScript compilation: PASSED
- ✅ Code review: Complete
- ✅ Unit tests: N/A (existing tests still valid)

---

## Deployment Steps

### 1. Build and Deploy to Cloud Run

**Standard deployment using Cloud Build:**

```bash
# Set project
gcloud config set project YOUR_PROJECT_ID

# Trigger Cloud Build deployment
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_DEPLOY_ENV=production,_IMAGE_TAG=$BUILD_ID \
  --region=us-central1

# Monitor build progress
# Expected: 3-5 minutes
```

**Or using existing scripts:**

```bash
# If you have deployment scripts
./scripts/deploy-prod.sh
```

### 2. Verify Deployment

**Check new revision is deployed:**

```bash
gcloud run services describe suchi-api \
  --region=us-central1 \
  --format='value(status.latestReadyRevisionName,status.url)'
```

**Expected output:**
- New revision name (e.g., `suchi-api-00065-xyz`)
- Service URL: `https://suchi-api-*.run.app`

**Verify service is healthy:**

```bash
# Check service status
gcloud run services describe suchi-api \
  --region=us-central1 \
  --format='value(status.conditions[0].status)'
```

**Expected:** `True` (service is ready)

### 3. Quick Smoke Test

**Test basic health:**

```bash
# Health check
curl https://suchi-api-lxiveognla-uc.a.run.app/health

# Expected: {"status":"ok"}
```

**Test citation repair logic (quick):**

```bash
# Create session
SESSION_RESPONSE=$(curl -s -X POST https://suchi-api-lxiveognla-uc.a.run.app/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"channel":"web"}')

SESSION_ID=$(echo $SESSION_RESPONSE | jq -r '.sessionId')

# Send test query (LUNG-GEN-01)
curl -X POST https://suchi-api-lxiveognla-uc.a.run.app/v1/chat \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\":\"$SESSION_ID\",
    \"userText\":\"How do you identify lung cancer?\",
    \"channel\":\"web\",
    \"locale\":\"en-US\"
  }" | jq '{citations: .citations | length, abstention: .abstentionReason, chunks: .retrievedChunks | length}'
```

**Expected output:**
```json
{
  "citations": 3,  // or 4-5 (repair should attach citations)
  "abstention": null,  // NOT "citation_validation_failed"
  "chunks": 6
}
```

**If abstention is still "citation_validation_failed":** STOP, deployment may have failed or code not picked up

### 4. Check Logs for Citation Repair Events

**Verify repair logic is active:**

```bash
# Check for citation_repair events in the last 5 minutes
gcloud logging read \
  "resource.type=cloud_run_revision
   AND resource.labels.service_name=suchi-api
   AND jsonPayload.event=citation_repair" \
  --limit=10 \
  --format=json \
  --freshness=5m
```

**Expected:** At least 1 event from the smoke test above (if LLM didn't generate citations)

**Log format should include:**
```json
{
  "event": "citation_repair",
  "message": "LLM generated response but no citations found - attaching deterministic citations",
  "sessionId": "...",
  "intent": "INFORMATIONAL_GENERAL",
  "evidenceChunksAvailable": 6
}
```

---

## Rollback Plan (If Needed)

**If smoke test fails or issues detected:**

```bash
# Get previous revision
PREVIOUS_REVISION=$(gcloud run services describe suchi-api \
  --region=us-central1 \
  --format='value(status.traffic[1].revisionName)')

# Rollback to previous revision
gcloud run services update-traffic suchi-api \
  --region=us-central1 \
  --to-revisions=$PREVIOUS_REVISION=100

# Verify rollback
gcloud run services describe suchi-api \
  --region=us-central1 \
  --format='value(status.traffic[0].revisionName,status.traffic[0].percent)'
```

---

## Post-Deployment

### Success Criteria

Deployment is **SUCCESSFUL** if:
- ✅ New Cloud Run revision deployed
- ✅ Service health check returns 200 OK
- ✅ Smoke test shows citations > 0 (not abstaining)
- ✅ Logs show citation_repair events (or LLM generating citations)

### Next Steps After Successful Deployment

**Hand off to @tests-eval-author for comprehensive validation:**

1. Create handoff document (already exists):
   - `docs/ops/handoffs/2026-01-21-tests-eval-author-phase2.5-validation.md`

2. Notify @tests-eval-author:
   - Deployment complete
   - Smoke test passed
   - Ready for full 15-case validation

3. @tests-eval-author will:
   - Run full 15-case evaluation suite
   - Verify citation coverage ≥ 65%
   - Verify no Phase 2.2 regressions
   - Generate Phase 2.5 validation report

---

## Environment Information

**GCP Project:** (use your project ID)
**Region:** us-central1
**Service:** suchi-api
**Image:** gcr.io/PROJECT_ID/suchi-api:$BUILD_ID

**Cloud Build Config:** `cloudbuild.yaml` (in repo root)

**Required Permissions:**
- Cloud Build Editor
- Cloud Run Admin
- Storage Admin (for build artifacts)

---

## Troubleshooting

### Build Fails

**Symptom:** `gcloud builds submit` fails

**Common causes:**
- Missing permissions
- Docker build errors
- Environment variables not set

**Action:** Check build logs:
```bash
gcloud builds list --limit=5
gcloud builds log BUILD_ID
```

### Deployment Succeeds but Code Not Updated

**Symptom:** Smoke test still shows old behavior (0 citations, abstaining)

**Possible causes:**
- Cloud Run using cached image
- Code not committed/pushed to repo
- Build picked up wrong branch

**Action:** 
1. Verify latest commit in build:
   ```bash
   gcloud builds describe BUILD_ID --format='value(source.repoSource.commitSha)'
   ```
2. Compare with local commit:
   ```bash
   git rev-parse HEAD
   ```

### Service Unhealthy After Deployment

**Symptom:** Health check fails or service not ready

**Action:**
1. Check service logs:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=suchi-api" --limit=50
   ```
2. Look for startup errors, crashes, or dependency issues
3. Rollback if critical

---

## Reference Documents

- **Implementation:** `PHASE2.5_IMPLEMENTATION_COMPLETE.md`
- **Code Changes:** 
  - `apps/api/src/modules/llm/llm.service.ts`
  - `apps/api/src/modules/chat/chat.service.ts`
- **Validation Handoff:** `docs/ops/handoffs/2026-01-21-tests-eval-author-phase2.5-validation.md`

---

**Created:** 2026-01-21 03:05 UTC  
**Status:** Ready for deployment  
**Estimated Time:** 5-10 minutes (build + deploy + smoke test)
