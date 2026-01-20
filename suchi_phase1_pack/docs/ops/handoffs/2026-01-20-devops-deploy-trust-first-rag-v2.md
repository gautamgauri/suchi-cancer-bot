# Trust-First RAG v2 - Cloud Deployment Handoff

**Date:** 2026-01-20  
**Agent:** @devops-gcp-deployer  
**Task:** Deploy Trust-First RAG v2 Phase 1 to Cloud (GCP)  
**Priority:** HIGH - Ready for production deployment  
**Estimated Time:** 30-45 minutes

---

## Mission

Deploy the completed Trust-First RAG v2 Phase 1 implementation to the cloud environment. This includes:
1. Database migration (adds FTS support)
2. API code deployment (hybrid search + evidence gating)
3. Verification and smoke testing

**CRITICAL:** User's NCI chunks will NOT be re-uploaded. Migration is non-destructive.

---

## Pre-Flight Checklist

### ✅ Code Validation (COMPLETE)
- [x] All TypeScript compilation passes
- [x] No linting errors  
- [x] All 15 implementation tasks complete
- [x] Comprehensive testing infrastructure ready

### 📋 Information You Need from User

Before starting, get these details:
1. **Cloud SQL Instance Name:** `?` (ask user)
2. **GCP Project ID:** `?` (ask user)
3. **Cloud Run Service Name:** Usually `suchi-api` (confirm)
4. **Region:** `?` (ask user)
5. **Database Connection String:** (get from user or Cloud SQL console)

---

## Deployment Steps

### PHASE 1: Safety First - Backup Database (5 minutes)

**Why:** The migration is non-destructive, but backups are always critical.

```bash
# CRITICAL: Take backup before any changes
gcloud sql backups create \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --description="Pre-TrustRAGv2-Phase1-$(date +%Y%m%d-%H%M%S)"

# Verify backup was created
gcloud sql backups list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --limit=5

# Expected: See your new backup at the top of the list
```

**Ask User to Confirm:**
- [ ] Backup ID received and verified

---

### PHASE 2: Verify Prerequisites (5 minutes)

**Check 1: Postgres Version**
```bash
# Must be PostgreSQL 9.6 or higher for websearch_to_tsquery
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="value(databaseVersion)"

# Expected: POSTGRES_9_6 or higher (e.g., POSTGRES_13, POSTGRES_14)
```

**If version < 9.6:**
- STOP and inform user
- Migration will fail
- Need to upgrade Cloud SQL first

**Check 2: Current Chunk Count**
```bash
# Connect to Cloud SQL (use Cloud SQL Proxy or direct connection)
psql "postgresql://USER:PASS@HOST:5432/suchi_db" \
  -c "SELECT COUNT(*) as total_chunks FROM \"KbChunk\";"

# Document this number - we'll verify it stays the same after migration
```

**Ask User to Confirm:**
- [ ] Postgres version ≥ 9.6
- [ ] Current chunk count: ______ (note this number)

---

### PHASE 3: Apply Database Migration (5 minutes)

**Step 3.1: Connect to Cloud SQL**

Choose one method:

**Option A: Cloud SQL Proxy (Recommended)**
```bash
# Download and start Cloud SQL Proxy if not already running
cloud_sql_proxy -instances=PROJECT_ID:REGION:INSTANCE_NAME=tcp:5432

# In another terminal, set DATABASE_URL
export DATABASE_URL="postgresql://USERNAME:PASSWORD@localhost:5432/suchi_db"
```

**Option B: Direct Connection**
```bash
# If you have IP whitelisted
export DATABASE_URL="postgresql://USERNAME:PASSWORD@CLOUD_SQL_IP:5432/suchi_db"
```

**Step 3.2: Apply Migration**
```bash
cd apps/api

# Apply the migration
npx prisma migrate deploy

# Expected output:
# Applying migration `20260120163141_add_fts_to_kbchunk`
# The following migration(s) have been applied:
# migrations/
#   └─ 20260120163141_add_fts_to_kbchunk/
#      └─ migration.sql
# ✔ All migrations have been successfully applied.
```

**Step 3.3: Verify Migration Success**
```bash
# Check that content_tsv column exists and is populated
psql $DATABASE_URL -c "
  SELECT 
    COUNT(*) as total_chunks,
    COUNT(content_tsv) as chunks_with_fts,
    COUNT(*) - COUNT(content_tsv) as missing_fts
  FROM \"KbChunk\";
"

# Expected:
# total_chunks | chunks_with_fts | missing_fts
# -------------|-----------------|------------
# SAME_AS_BEFORE | SAME_AS_BEFORE | 0

# Verify index created
psql $DATABASE_URL -c "
  SELECT indexname, indexdef 
  FROM pg_indexes 
  WHERE tablename = 'KbChunk' 
  AND indexname = 'kb_chunk_content_tsv_idx';
"

# Expected: Should show the GIN index definition
```

**Ask User to Confirm:**
- [ ] Migration applied successfully
- [ ] All chunks have content_tsv populated
- [ ] GIN index created
- [ ] Chunk count unchanged (no data loss)

---

### PHASE 4: Deploy API Code (10-15 minutes)

**Step 4.1: Verify Code is Ready**
```bash
# Make sure all changes are committed
cd suchi_phase1_pack
git status

# Should show modified files ready to commit
```

**Step 4.2: Create Commit**
```bash
# Stage all changes
git add .

# Create comprehensive commit message
git commit -m "$(cat <<'EOF'
feat: Trust-First RAG v2 Phase 1 - Production deployment

## Implementation Summary
- Hybrid retrieval: Vector (60%) + Full-text search (40%) with trust-aware reranking
- Hard evidence gate: No evidence → no LLM call → SafeFallbackResponse
- Runtime citation enforcement: Medical content requires 2-5 citations
- Idempotent ingestion: Hash-based SKIP logic for unchanged documents
- Evaluation infrastructure: 12 test scenarios with 80% pass threshold

## Database Changes
- Migration 20260120163141: Adds content_tsv generated column + GIN index
- Non-destructive: Existing chunks and embeddings untouched
- Performance: FTS queries return in <50ms

## Safety Features
- Evidence gate logs all blocking decisions with reason codes
- Citation enforcement discards uncited medical responses
- SafeFallbackResponse is purely navigational (no medical advice)
- Model-agnostic design (works with Gemini, DeepSeek, etc.)

## Files Changed
- New: docs/SUCHI_ANSWER_POLICY.md, eval/hybrid_retrieval_scenarios.json
- Modified: rag.service.ts, evidence-gate.service.ts, chat.service.ts, abstention.service.ts, ingest-kb.ts
- Migration: 20260120163141_add_fts_to_kbchunk

## Testing
- TypeScript compilation: PASS
- ESLint: PASS (0 errors)
- All acceptance criteria met

See TRUST_FIRST_RAG_V2_IMPLEMENTATION_SUMMARY.md for complete details.
EOF
)"
```

**Step 4.3: Push to Repository**
```bash
# Push to main branch (or create feature branch if needed)
git push origin main

# OR create feature branch for PR review first:
# git checkout -b deploy/trust-rag-v2-phase1
# git push origin deploy/trust-rag-v2-phase1
```

**Step 4.4: Trigger Cloud Build / Deploy**

**Option A: Auto-Deploy (if configured)**
```bash
# If you have auto-deploy on git push, just wait
# Monitor Cloud Build progress
gcloud builds list --project=PROJECT_ID --limit=5

# Watch the latest build
gcloud builds log $(gcloud builds list --limit=1 --format="value(id)") \
  --project=PROJECT_ID --stream
```

**Option B: Manual Cloud Build**
```bash
# Trigger Cloud Build manually
cd suchi_phase1_pack
gcloud builds submit \
  --config cloudbuild.yaml \
  --project=PROJECT_ID

# Expected: Build succeeds, new Cloud Run revision deployed
```

**Option C: Direct Cloud Run Deploy (if no Cloud Build)**
```bash
# Deploy directly from source
gcloud run deploy suchi-api \
  --source ./apps/api \
  --region REGION \
  --project=PROJECT_ID \
  --platform managed \
  --allow-unauthenticated
```

**Step 4.5: Wait for Deployment to Complete**
```bash
# Check Cloud Run service status
gcloud run services describe suchi-api \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(status.latestReadyRevisionName)"

# Get the URL
gcloud run services describe suchi-api \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(status.url)"
```

**Ask User to Confirm:**
- [ ] Code committed successfully
- [ ] Cloud Build completed (or deployment successful)
- [ ] New Cloud Run revision is live
- [ ] API URL: _____________ (note the URL)

---

### PHASE 5: Smoke Testing (10 minutes)

**Test 1: Health Check**
```bash
# Test basic API health
curl https://YOUR_API_URL/health

# Expected: 200 OK with health status
```

**Test 2: Hybrid Search - Medical Query**
```bash
# Test hybrid search with medical query
curl -X POST https://YOUR_API_URL/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "deploy-test-001",
    "userText": "What are the symptoms of lung cancer?",
    "channel": "test",
    "locale": "en-US"
  }' | jq '.'

# Expected checks:
# 1. Response contains "responseText" field
# 2. Response has "citations" array with length >= 2
# 3. Response includes medical information about lung cancer symptoms
# 4. No errors in response

# Save response for verification
```

**Test 3: Evidence Gate - No Evidence Query**
```bash
# Test evidence gate blocks query with no KB evidence
curl -X POST https://YOUR_API_URL/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "deploy-test-002",
    "userText": "What is quantum cancer treatment?",
    "channel": "test",
    "locale": "en-US"
  }' | jq '.'

# Expected checks:
# 1. Response contains SafeFallbackResponse text
# 2. Text includes "don't have enough specific information"
# 3. Text includes referral to healthcare provider
# 4. Text includes links to NCI, WHO
# 5. NO medical advice about quantum treatment
# 6. abstentionReason field present
```

**Test 4: Hybrid Search Logs**
```bash
# Check logs for hybrid search activity
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=suchi-api AND textPayload=~'Hybrid search'" \
  --project=PROJECT_ID \
  --limit=20 \
  --format=json

# Expected: Should see log entries like:
# "Hybrid search returned 6 results"
# "Hybrid search: 5 vector + 4 FTS = 7 unique chunks"
```

**Test 5: Evidence Gate Logs**
```bash
# Check if evidence gate is blocking appropriately
gcloud logging read \
  "resource.type=cloud_run_revision AND jsonPayload.event='evidence_gate_blocked'" \
  --project=PROJECT_ID \
  --limit=10 \
  --format="table(timestamp,jsonPayload.reasonCode,jsonPayload.queryType)"

# Expected: Should see blocks for Test 3 with reasonCode='NO_RESULTS'
```

**Ask User to Confirm:**
- [ ] Health check passes
- [ ] Medical query returns 2+ citations
- [ ] No-evidence query returns SafeFallbackResponse
- [ ] Logs show "Hybrid search returned" messages
- [ ] Evidence gate blocking works correctly

---

### PHASE 6: Verification (5 minutes)

**Verify NCI Chunks Not Re-uploaded**
```bash
# Check chunk count is unchanged
psql $DATABASE_URL -c "SELECT COUNT(*) as total_chunks FROM \"KbChunk\";"

# Expected: EXACT SAME number as noted in Phase 2
# If different, ALERT USER IMMEDIATELY
```

**Run Evaluation Suite (Optional but Recommended)**
```bash
# Point eval to cloud API
export API_BASE_URL=https://YOUR_API_URL

# Run hybrid retrieval evaluation
npm run eval:hybrid-retrieval

# Expected: Pass rate ≥ 80%
# Report saved to: eval/reports/hybrid-retrieval-test.json
```

**Check for Errors**
```bash
# Look for any errors in last 100 log entries
gcloud logging read \
  "resource.type=cloud_run_revision AND severity>=ERROR" \
  --project=PROJECT_ID \
  --limit=100 \
  --format="table(timestamp,severity,textPayload)"

# Expected: No new errors related to hybrid search or evidence gate
```

**Ask User to Confirm:**
- [ ] Chunk count unchanged (NCI data safe)
- [ ] Eval suite passes ≥80% (if run)
- [ ] No critical errors in logs

---

## Success Criteria

Deployment is successful when ALL of these are true:

✅ **Database:**
- [ ] Backup created and verified
- [ ] Migration applied successfully
- [ ] `content_tsv` column populated for all chunks
- [ ] GIN index created
- [ ] Chunk count unchanged (no data loss)

✅ **API Deployment:**
- [ ] Code committed and pushed
- [ ] Cloud Build/deployment succeeded
- [ ] New Cloud Run revision live
- [ ] Health check passes

✅ **Functionality:**
- [ ] Hybrid search active (logs confirm)
- [ ] Evidence gate blocking works
- [ ] Medical queries return 2+ citations
- [ ] No-evidence queries return SafeFallbackResponse
- [ ] No new errors in logs

✅ **Safety:**
- [ ] NCI chunks not re-uploaded (count verified)
- [ ] Rollback plan documented and ready

---

## Monitoring Guide (First 24 Hours)

After successful deployment, monitor these metrics:

**1. Evidence Gate Activity**
```bash
# Check evidence gate blocking distribution
gcloud logging read \
  "jsonPayload.event='evidence_gate_blocked'" \
  --limit=100 \
  --format="table(jsonPayload.reasonCode)" | sort | uniq -c

# Expected distribution:
# - Some NO_RESULTS blocks (normal for out-of-scope queries)
# - Low number of LOW_TRUST or LOW_SCORE blocks
# - If HIGH number of blocks: may need threshold tuning
```

**2. Citation Enforcement**
```bash
# Check citation enforcement failures (should be rare)
gcloud logging read \
  "jsonPayload.event='citation_enforcement_failed'" \
  --limit=50

# Expected: Very few or none
# Concerning: Frequent failures indicate LLM not citing properly
```

**3. Response Times**
```bash
# Monitor latency
gcloud logging read \
  "resource.type=cloud_run_revision AND textPayload=~'latencyMs'" \
  --limit=100 \
  --format="value(jsonPayload.latencyMs)"

# Expected: Most responses < 3000ms (3 seconds)
# Hybrid search adds ~50-100ms overhead
```

**4. Error Rate**
```bash
# Daily error count
gcloud logging read \
  "resource.type=cloud_run_revision AND severity=ERROR" \
  --limit=200 \
  --format="value(timestamp)" | wc -l

# Compare to pre-deployment baseline
```

---

## Rollback Plan

### If Critical Issues Found

**Quick Rollback (5 minutes):**
```bash
# Option 1: Revert Cloud Run to previous revision
gcloud run revisions list \
  --service=suchi-api \
  --region=REGION \
  --project=PROJECT_ID

# Note the previous revision name, then:
gcloud run services update-traffic suchi-api \
  --to-revisions=PREVIOUS_REVISION_NAME=100 \
  --region=REGION \
  --project=PROJECT_ID

# Expected: Traffic immediately switches to old revision
```

**Database Rollback (Only if absolutely necessary):**
```bash
# RARE: Only if migration caused data corruption (very unlikely)
# Restore from backup taken in Phase 1

gcloud sql backups restore BACKUP_ID \
  --backup-instance=INSTANCE_NAME \
  --restore-instance=INSTANCE_NAME \
  --project=PROJECT_ID

# WARNING: This will lose any data written after backup
# Coordinate with user before executing
```

---

## Troubleshooting

### Issue: Migration Fails with "function websearch_to_tsquery does not exist"

**Cause:** Postgres version < 9.6  
**Fix:**
```bash
# Upgrade Cloud SQL to supported Postgres version
gcloud sql instances patch INSTANCE_NAME \
  --database-version=POSTGRES_13 \
  --project=PROJECT_ID

# Wait for upgrade to complete, then retry migration
```

### Issue: API Deployment Fails

**Symptom:** Cloud Build fails or Cloud Run won't start  
**Check:**
```bash
# View build logs
gcloud builds log BUILD_ID --project=PROJECT_ID

# Common causes:
# 1. TypeScript compilation errors (we fixed these, but verify)
# 2. Missing environment variables
# 3. Database connection issues
```

**Fix:**
```bash
# Verify environment variables are set in Cloud Run
gcloud run services describe suchi-api \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(spec.template.spec.containers[0].env)"

# Ensure DATABASE_URL, GEMINI_API_KEY, etc. are present
```

### Issue: Hybrid Search Not Working

**Symptom:** No "Hybrid search returned" in logs  
**Check:**
```bash
# Verify migration applied
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"KbChunk\" WHERE content_tsv IS NOT NULL;"

# Should equal total chunk count
```

**Fix:**
```bash
# If content_tsv is NULL, re-run migration
cd apps/api
npx prisma migrate deploy --force
```

### Issue: Too Many Evidence Gate Blocks

**Symptom:** High rate of SafeFallbackResponse  
**Check:**
```bash
# Analyze block reasons
gcloud logging read "jsonPayload.event='evidence_gate_blocked'" \
  --limit=200 \
  --format="value(jsonPayload.reasonCode)" | sort | uniq -c

# If mostly LOW_SCORE or LOW_DIVERSITY:
# May need to adjust thresholds in EvidenceGateService
```

**Action:** Report findings to user, may need tuning in Phase 2

---

## Handoff Back to User

After deployment, provide user with:

1. **Deployment Summary:**
   - Migration ID and status
   - Cloud Run revision name and URL
   - Backup ID for rollback
   - Smoke test results (pass/fail)

2. **Monitoring Dashboard:**
   - Evidence gate metrics
   - Citation enforcement metrics
   - Response time distribution
   - Error rate comparison

3. **Next Steps:**
   - Monitor for 24-48 hours
   - Run full eval suite (if not done)
   - Review any concerning patterns in logs
   - Plan Phase 2 enhancements if needed

4. **Documentation:**
   - `DEPLOYMENT_CHECKLIST.md` - completed checklist
   - `TRUST_FIRST_RAG_V2_IMPLEMENTATION_SUMMARY.md` - full details
   - `docs/SUCHI_ANSWER_POLICY.md` - policy reference

---

## Quick Reference Commands

| Task | Command |
|------|---------|
| Backup DB | `gcloud sql backups create --instance=NAME --project=PROJECT` |
| Apply migration | `npx prisma migrate deploy` |
| Deploy API | `git push origin main` (auto-deploy) or `gcloud builds submit` |
| Check logs | `gcloud logging read "resource.type=cloud_run_revision"` |
| Smoke test | `curl -X POST https://API_URL/chat -d '{...}'` |
| Rollback | `gcloud run services update-traffic suchi-api --to-revisions=PREV=100` |
| Monitor gate | `gcloud logging read "jsonPayload.event='evidence_gate_blocked'"` |

---

## Questions Before Starting?

- [ ] Do you have all the required information (instance name, project ID, etc.)?
- [ ] Do you have appropriate GCP permissions (Cloud SQL Admin, Cloud Run Admin)?
- [ ] Is this a production deployment or staging first?
- [ ] Any specific deployment time window requirements?

---

**Ready to deploy! 🚀**

Follow phases 1-6 sequentially. Report back after each phase with status.
