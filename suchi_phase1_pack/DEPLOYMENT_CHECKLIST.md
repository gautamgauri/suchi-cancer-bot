# Trust-First RAG v2 - Deployment Checklist

**Date:** 2026-01-20  
**Version:** Phase 1  
**Deployment Target:** Cloud (GCP)

---

## Pre-Deployment Checklist

### ✅ Code Validation (COMPLETE)
- [x] TypeScript compilation passes
- [x] No linting errors
- [x] All tests pass locally
- [x] Code review complete

### 🔒 Safety Checks (REQUIRED BEFORE DEPLOYMENT)

#### 1. Backup Your Database
```bash
# CRITICAL: Take a backup before any deployment
gcloud sql backups create \
  --instance=YOUR_INSTANCE_NAME \
  --description="Pre-TrustRAGv2-backup-$(date +%Y%m%d)"

# Verify backup was created
gcloud sql backups list --instance=YOUR_INSTANCE_NAME --limit=5
```

**Why this matters:** The migration is non-destructive, but backups are always critical.

#### 2. Verify Postgres Version
```bash
# Check your Cloud SQL Postgres version
gcloud sql instances describe YOUR_INSTANCE_NAME \
  --format="value(databaseVersion)"

# Required: PostgreSQL 9.6 or higher (for websearch_to_tsquery)
```

**If version < 9.6:** You'll need to upgrade Cloud SQL first.

---

## Deployment Steps

### Phase 1: Deploy Database Migration (5 minutes)

**Step 1.1: Connect to Cloud SQL**
```bash
# Option A: Cloud SQL Proxy
cloud_sql_proxy -instances=PROJECT:REGION:INSTANCE=tcp:5432

# Option B: Direct connection (if IP whitelisted)
# Use connection string from Cloud SQL console
```

**Step 1.2: Apply Migration**
```bash
cd apps/api

# Set DATABASE_URL to your Cloud SQL instance
export DATABASE_URL="postgresql://user:pass@host:5432/suchi_db"

# Apply migration
npx prisma migrate deploy

# Expected output:
# ✓ Applying migration `20260120163141_add_fts_to_kbchunk`
# ✓ Migration applied successfully
```

**Step 1.3: Verify Migration**
```bash
# Check that content_tsv column exists and is populated
psql $DATABASE_URL -c "SELECT id, length(content) as content_len, content_tsv IS NOT NULL as has_tsv FROM \"KbChunk\" LIMIT 5;"

# Expected: has_tsv should be 't' (true) for all rows
```

**⚠️ IMPORTANT:** Your existing NCI chunks are NOT re-uploaded. The migration just adds a generated column from existing content.

---

### Phase 2: Deploy API Code (10-15 minutes)

**Step 2.1: Commit Changes**
```bash
# Review changes
git status
git diff

# Stage all changes
git add .

# Commit with descriptive message
git commit -m "feat: Trust-First RAG v2 Phase 1 - Hybrid retrieval + evidence gating

- Add hybrid search (vector + full-text) with 60/40 weighting
- Implement hard evidence gate (no evidence → no LLM call)
- Add runtime citation enforcement (medical content requires 2-5 citations)
- Implement idempotent ingestion with hash-based SKIP logic
- Add 12 eval scenarios for hybrid retrieval testing
- Create comprehensive policy documentation

All TypeScript compilation and linting checks pass.
See TRUST_FIRST_RAG_V2_IMPLEMENTATION_SUMMARY.md for details."
```

**Step 2.2: Push to Repository**
```bash
# Push to your deployment branch (adjust branch name as needed)
git push origin main

# Or create a feature branch first
git checkout -b feature/trust-rag-v2-phase1
git push origin feature/trust-rag-v2-phase1
```

**Step 2.3: Deploy via Cloud Build / Cloud Run**

Depending on your setup:

```bash
# Option A: Trigger Cloud Build manually
gcloud builds submit --config cloudbuild.yaml

# Option B: Cloud Build will auto-deploy on git push (if configured)
# Just wait for the build to complete

# Option C: Manual Cloud Run deployment
gcloud run deploy suchi-api \
  --source . \
  --region YOUR_REGION \
  --platform managed
```

**Step 2.4: Wait for Deployment**
- Check Cloud Build logs
- Verify new revision is deployed to Cloud Run
- Check health endpoint

---

### Phase 3: Smoke Testing (5 minutes)

**Test 1: Basic Health Check**
```bash
# Check API is running
curl https://YOUR_API_URL/health

# Expected: 200 OK
```

**Test 2: Hybrid Search Test**
```bash
# Test a medical query that should use hybrid search
curl -X POST https://YOUR_API_URL/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "smoke-test-001",
    "userText": "What are the symptoms of lung cancer?",
    "channel": "test",
    "locale": "en-US"
  }'

# Expected: Response with 2-5 citations
# Check response.citations array length >= 2
```

**Test 3: Evidence Gate Test**
```bash
# Test a query with no KB evidence (should return SafeFallbackResponse)
curl -X POST https://YOUR_API_URL/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "smoke-test-002",
    "userText": "What is quantum cancer treatment?",
    "channel": "test",
    "locale": "en-US"
  }'

# Expected: SafeFallbackResponse with no medical advice
# Should mention "don't have enough specific information"
```

**Test 4: Check Logs**
```bash
# View Cloud Run logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=suchi-api" \
  --limit=50 \
  --format=json

# Look for:
# - "Hybrid search returned X results" (confirms hybrid search working)
# - "Evidence gate BLOCKED" (if any no-evidence queries)
# - No errors or exceptions
```

---

### Phase 4: Run Full Evaluation (Optional but Recommended)

**Step 4.1: Run Hybrid Retrieval Eval**
```bash
# Point eval script to your cloud API
export API_BASE_URL=https://YOUR_API_URL

# Run evaluation suite
npm run eval:hybrid-retrieval

# Expected: Pass rate ≥ 80%
# Check report: eval/reports/hybrid-retrieval-test.json
```

**Step 4.2: Review Results**
```bash
# Check which scenarios passed/failed
cat eval/reports/hybrid-retrieval-test.json | jq '.results[] | {id, passed}'

# If pass rate < 80%: Review failed scenarios and adjust
```

---

## Post-Deployment Monitoring

### Key Metrics to Watch (First 24 Hours)

**1. Evidence Gate Metrics**
```bash
# Count evidence_gate_blocked events
gcloud logging read "jsonPayload.event=evidence_gate_blocked" \
  --limit=100 \
  --format="table(timestamp,jsonPayload.reasonCode)"

# Expected: Some blocks are normal (e.g., NO_RESULTS for out-of-scope queries)
# Concerning: High rate of LOW_TRUST or LOW_SCORE blocks
```

**2. Citation Enforcement**
```bash
# Count citation_enforcement_failed events
gcloud logging read "jsonPayload.event=citation_enforcement_failed" \
  --limit=100

# Expected: Very few (should be rare)
# Concerning: Frequent failures indicate LLM not citing properly
```

**3. Response Times**
```bash
# Check hybrid search latency
gcloud logging read "textPayload=~'Hybrid search returned'" \
  --limit=50 \
  --format="table(timestamp,textPayload)"

# Expected: <200ms for most queries
```

**4. Error Rate**
```bash
# Check for any errors
gcloud logging read "severity>=ERROR AND resource.type=cloud_run_revision" \
  --limit=50

# Expected: No new errors related to hybrid search or evidence gate
```

---

## Rollback Plan (If Issues Occur)

### Quick Rollback (5 minutes)

**Option 1: Revert Cloud Run to Previous Revision**
```bash
# List recent revisions
gcloud run revisions list --service=suchi-api --region=YOUR_REGION

# Rollback to previous revision
gcloud run services update-traffic suchi-api \
  --to-revisions=PREVIOUS_REVISION=100 \
  --region=YOUR_REGION
```

**Option 2: Revert Database Migration (if needed)**
```bash
# Only if migration caused issues (unlikely)
# Restore from backup taken in Pre-Deployment step
gcloud sql backups restore BACKUP_ID \
  --backup-instance=YOUR_INSTANCE_NAME \
  --backup-instance=YOUR_INSTANCE_NAME
```

---

## Success Criteria

Your deployment is successful when:

✅ **Migration Applied:** `content_tsv` column exists and is populated  
✅ **API Deployed:** New Cloud Run revision is live  
✅ **Smoke Tests Pass:** All 4 smoke tests return expected results  
✅ **No Errors:** No new errors in logs  
✅ **Evidence Gate Working:** Blocks queries with insufficient evidence  
✅ **Citations Present:** Medical responses have 2-5 citations  
✅ **Hybrid Search Active:** Logs show "Hybrid search returned X results"

---

## Troubleshooting

### Issue: Migration Fails

**Symptom:** `npx prisma migrate deploy` fails  
**Cause:** Usually Postgres version < 9.6  
**Fix:** Upgrade Cloud SQL Postgres to 9.6+

### Issue: API Won't Start

**Symptom:** Cloud Run deployment fails or times out  
**Cause:** TypeScript compilation errors (we fixed these)  
**Fix:** Check Cloud Build logs, verify all fixes were pushed

### Issue: Hybrid Search Not Working

**Symptom:** Logs don't show "Hybrid search returned"  
**Cause:** Migration not applied or FTS query failing  
**Fix:** Verify migration, check for Postgres errors in logs

### Issue: Too Many Evidence Gate Blocks

**Symptom:** Most queries returning SafeFallbackResponse  
**Cause:** Evidence gate threshold too strict  
**Fix:** Review `gateResult.reasonCode` distribution, may need tuning

---

## Next Steps After Successful Deployment

1. **Monitor for 24-48 hours** (key metrics above)
2. **Review eval results** (aim for ≥80% pass rate)
3. **Collect user feedback** (if applicable)
4. **Plan Phase 2 enhancements** (debug mode, expanded eval scenarios)
5. **Document lessons learned**

---

## Questions or Issues?

- **Migration issues:** Check `CLOUD_BUILD_GATED_SETUP.md`
- **Policy questions:** See `docs/SUCHI_ANSWER_POLICY.md`
- **Technical details:** Review `TRUST_FIRST_RAG_V2_IMPLEMENTATION_SUMMARY.md`

**Contact:** Your DevOps team or orchestrator

---

## Quick Reference

| Task | Command |
|------|---------|
| Backup DB | `gcloud sql backups create --instance=NAME` |
| Apply migration | `npx prisma migrate deploy` |
| Deploy API | `git push origin main` (triggers auto-deploy) |
| Check logs | `gcloud logging read "resource.type=cloud_run_revision"` |
| Rollback | `gcloud run services update-traffic suchi-api --to-revisions=PREV=100` |
| Run eval | `API_BASE_URL=https://... npm run eval:hybrid-retrieval` |

---

**Good luck with your deployment! 🚀**
