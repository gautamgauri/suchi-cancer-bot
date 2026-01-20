# 🚀 START DEPLOYMENT - Instructions for @devops-gcp-deployer

**Task:** Deploy Trust-First RAG v2 Phase 1 to Cloud  
**Handoff Document:** `docs/ops/handoffs/2026-01-20-devops-deploy-trust-first-rag-v2.md`  
**Status:** Ready to begin

---

## How to Start

### For the Deployer Agent

When you're invoked, follow these steps:

1. **Read the handoff document:**
   ```
   Open: docs/ops/handoffs/2026-01-20-devops-deploy-trust-first-rag-v2.md
   ```

2. **Gather required information from user:**
   - Cloud SQL Instance Name
   - GCP Project ID
   - Cloud Run Service Name
   - Region
   - Database credentials

3. **Execute phases sequentially:**
   - Phase 1: Backup Database
   - Phase 2: Verify Prerequisites  
   - Phase 3: Apply Migration
   - Phase 4: Deploy API Code
   - Phase 5: Smoke Testing
   - Phase 6: Verification

4. **Report back after each phase** with status and ask user to confirm before proceeding to next phase.

---

## For the User

To start the deployment, say:

```
@devops-gcp-deployer - Please execute the deployment following the handoff document at docs/ops/handoffs/2026-01-20-devops-deploy-trust-first-rag-v2.md
```

Or simply:

```
@devops-gcp-deployer - Deploy Trust-First RAG v2 to cloud
```

The agent will then:
1. Ask you for required GCP information
2. Guide you through each deployment phase
3. Run smoke tests to verify
4. Provide monitoring guidance

---

## Quick Deployment Overview

**Total Time:** ~30-45 minutes  
**Phases:** 6  
**Risk Level:** Low (migration is non-destructive)  
**Rollback Available:** Yes (documented in handoff)

**Key Points:**
- ✅ Your NCI chunks will NOT be re-uploaded
- ✅ Migration only adds a generated column (instant)
- ✅ Complete backup and rollback plan included
- ✅ Comprehensive smoke tests provided
- ✅ 24-hour monitoring guide included

---

**Ready when you are! Just invoke @devops-gcp-deployer to begin.** 🚀
