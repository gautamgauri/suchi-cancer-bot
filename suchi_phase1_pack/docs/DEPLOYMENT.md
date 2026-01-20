# Deployment Guide

This document covers the deployment pipeline, database migrations, and operational procedures for the Suchi Cancer Bot.

## Overview

The deployment pipeline uses **gated Cloud Build** with the following flow:

1. Build and push Docker images
2. Check for schema drift (fail fast if migrations are out of sync)
3. Update migration job to use new image
4. Execute migration job (applies pending migrations)
5. Deploy candidate revision (0% traffic)
6. Run health check
7. Run eval:tier1 against candidate
8. Check NCI dominance gate
9. Promote candidate to 100% traffic (if all checks pass)

## Database Migrations

### How Migrations Work

Migrations are handled via a **Cloud Run Job** (`suchi-db-migrate`) that:

- Uses the **same Docker image** as the API service (ensures parity)
- Runs with **concurrency control** (max 1 instance, prevents race conditions)
- Uses the **same environment** (DATABASE_URL, Cloud SQL connection) as the service
- Executes `npx prisma migrate deploy` (safe for production - only applies pending migrations)

### Migration Flow

1. **Schema Drift Detection** (pre-deploy): Runs `prisma migrate status` to detect if migrations are out of sync
2. **Job Image Update**: Updates the migration job to use the just-built image
3. **Migration Execution**: Executes the job, which applies any pending migrations
4. **Deployment**: Only proceeds if migration succeeds (fail-fast)

### Safety Rails

- **Concurrency Control**: Migration job runs with `--parallelism=1 --tasks=1` to prevent simultaneous migrations
- **Fail-Fast**: If migration fails, Cloud Build halts and deployment does not proceed
- **Schema Drift Detection**: Pre-deploy check catches "migration exists but not applied" before the app touches the DB
- **Parity**: Migration job uses the same image, secrets, and Cloud SQL connection as the service

### Emergency Migration

If you need to run a migration manually (e.g., outside of the normal deployment cycle):

**Windows:**
```powershell
.\scripts\migrate-prod.ps1
```

**Linux/Mac:**
```bash
chmod +x scripts/migrate-prod.sh
./scripts/migrate-prod.sh
```

Or directly:
```bash
gcloud run jobs execute suchi-db-migrate --region=us-central1 --wait
```

### Verifying Migration Status

Check if migrations are in sync:
```bash
cd apps/api
npx prisma migrate status
```

Should show: "Database schema is up to date!"

## Troubleshooting

### Migration Fails in Cloud Build

**Symptoms:**
- Cloud Build step `run-migrations` fails
- Error: "P3005: Database schema is not empty"

**Diagnosis:**
1. Check Cloud Run Job logs:
   ```bash
   gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=suchi-db-migrate" --limit=20
   ```
2. Check Cloud Build logs for the `run-migrations` step
3. Verify `DATABASE_URL` secret is correct and accessible

**Fixes:**
- If database needs baselining: Run `npx prisma migrate resolve --applied <migration_name>`
- If schema drift detected: Run `npx prisma migrate status` locally to see details
- If connection fails: Verify Cloud SQL instance is accessible and `DATABASE_URL` format is correct

### Schema Drift Detected

**Symptoms:**
- Cloud Build step `check-schema-drift` fails
- Error: "Schema drift detected! Migrations are out of sync."

**Diagnosis:**
```bash
cd apps/api
npx prisma migrate status
```

**Fixes:**
- If migrations exist but not applied: Run migration job manually
- If local migrations differ from production: Sync migration files
- If database was modified outside Prisma: Baseline the database

### App Can't Connect to Database

**Symptoms:**
- Health check fails
- Session creation returns 500
- Error: "Column does not exist"

**Diagnosis:**
1. Check startup logs for DB schema version:
   ```
   [DB Schema] Latest migration: <migration_name>
   [Build] Image tag: <build_id>
   ```
2. Verify migration was applied:
   ```bash
   gcloud run jobs executions list --job=suchi-db-migrate --region=us-central1 --limit=1
   ```
3. Check if app and migration job use the same `DATABASE_URL`

**Fixes:**
- If migration not applied: Run migration job manually
- If wrong database: Verify `DATABASE_URL` secret points to correct database
- If connection issue: Check Cloud SQL instance status and network connectivity

## Operational Procedures

### Viewing Migration History

```bash
# Check Prisma migration history in database
gcloud sql connect suchi-db --user=postgres --database=suchi_db
# In PostgreSQL:
SELECT migration_name, applied_steps_count, finished_at 
FROM _prisma_migrations 
ORDER BY finished_at DESC;
```

### Viewing Startup Schema Version

Check application logs for:
```
[DB Schema] Latest migration: 20250101000000_add_greeting_context_to_session
[Build] Image tag: <build_id>
```

This appears in Cloud Logging when the service starts.

### Manual Database Operations

**⚠️ Warning:** Only use these if you understand the implications.

**Baseline a migration (mark as applied without running):**
```bash
cd apps/api
npx prisma migrate resolve --applied <migration_name>
```

**Rollback a migration:**
```bash
# Not recommended - Prisma doesn't support automatic rollbacks
# You'll need to write a new migration to undo changes
```

## Related Documentation

- [GCP Deployment Guide](./GCP_DEPLOYMENT.md) - Initial setup and configuration
- [Gated Deployment Guide](./GATED_DEPLOYMENT.md) - Gated build pipeline details
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) - Required environment variables
