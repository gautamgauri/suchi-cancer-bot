# Google Cloud Platform Deployment Guide

Complete guide for deploying Suchi Cancer Bot to Google Cloud Platform using Cloud SQL (PostgreSQL), Cloud Run, and Secret Manager.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Phase 1: Google Cloud Setup](#phase-1-google-cloud-setup)
3. [Phase 2: Secret Manager Configuration](#phase-2-secret-manager-configuration)
4. [Phase 3: Cloud SQL Database Setup](#phase-3-cloud-sql-database-setup)
5. [Phase 4: Build and Push Docker Images](#phase-4-build-and-push-docker-images)
6. [Phase 5: Deploy to Cloud Run](#phase-5-deploy-to-cloud-run)
7. [Phase 6: Database Migration](#phase-6-database-migration)
8. [Phase 7: Knowledge Base Ingestion](#phase-7-knowledge-base-ingestion)
9. [Phase 8: Verification and Testing](#phase-8-verification-and-testing)
10. [Troubleshooting](#troubleshooting)

## Prerequisites

- Google Cloud account with billing enabled
- Google Cloud CLI (`gcloud`) installed and authenticated
- Docker installed locally (for local builds, optional)
- Node.js 18+ installed (for local migration and KB ingestion)

### Install Google Cloud CLI

```bash
# On macOS
brew install google-cloud-sdk

# On Windows (via PowerShell)
(New-Object Net.WebClient).DownloadFile("https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe", "$env:Temp\GoogleCloudSDKInstaller.exe")
& $env:Temp\GoogleCloudSDKInstaller.exe

# Authenticate
gcloud auth login
gcloud auth application-default login
```

## Phase 1: Google Cloud Setup

### 1.1 Create or Select a Project

```bash
# Create a new project
gcloud projects create suchi-cancer-bot --name="Suchi Cancer Bot"

# Or select an existing project
gcloud config set project YOUR_PROJECT_ID

# Set default region
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
```

### 1.2 Enable Required APIs

```bash
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    sqladmin.googleapis.com \
    secretmanager.googleapis.com \
    artifactregistry.googleapis.com \
    cloudsql.googleapis.com
```

### 1.3 Create Artifact Registry Repository

```bash
gcloud artifacts repositories create suchi-images \
    --repository-format=docker \
    --location=us-central1 \
    --description="Docker images for Suchi Cancer Bot"
```

## Phase 2: Secret Manager Configuration

### 2.1 Create Secrets

Store all sensitive configuration in Secret Manager:

```bash
# Set your actual values (replace with your real credentials)
PROJECT_ID=$(gcloud config get-value project)

# Gemini API Key (get from https://makersuite.google.com/app/apikey)
echo -n "your_gemini_api_key_here" | gcloud secrets create gemini-api-key \
    --data-file=- \
    --replication-policy="automatic"

# Embedding API Key (can be same as Gemini)
echo -n "your_gemini_api_key_here" | gcloud secrets create embedding-api-key \
    --data-file=- \
    --replication-policy="automatic"

# Admin credentials
echo -n "admin" | gcloud secrets create admin-basic-user \
    --data-file=- \
    --replication-policy="automatic"

echo -n "your_secure_password_here" | gcloud secrets create admin-basic-pass \
    --data-file=- \
    --replication-policy="automatic"

# Database URL (will be set after Cloud SQL is created)
# Format: postgresql://USERNAME:PASSWORD@/DATABASE?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
# We'll update this after creating the database
```

## Phase 3: Cloud SQL Database Setup

### 3.1 Create Cloud SQL Instance

```bash
# Create PostgreSQL 15 instance
gcloud sql instances create suchi-db \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region=us-central1 \
    --root-password=YOUR_ROOT_PASSWORD \
    --storage-type=SSD \
    --storage-size=10GB \
    --storage-auto-increase \
    --backup \
    --enable-bin-log

# Note: For production, use db-n1-standard-1 or higher
# Note: Save the connection name: PROJECT_ID:REGION:suchi-db
```

### 3.2 Create Database and User

```bash
# Connect to the instance
gcloud sql connect suchi-db --user=postgres

# In the PostgreSQL prompt, run:
```

```sql
-- Create database
CREATE DATABASE suchi_db;

-- Create application user
CREATE USER suchi_app WITH PASSWORD 'your_app_password_here';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE suchi_db TO suchi_app;

-- Connect to suchi_db
\c suchi_db

-- Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO suchi_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO suchi_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO suchi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO suchi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO suchi_app;

-- Exit
\q
```

### 3.3 Configure Private IP (Recommended for Cloud Run)

```bash
# Allocate IP range
gcloud compute addresses create google-managed-services-default \
    --global \
    --purpose=VPC_PEERING \
    --prefix-length=16 \
    --network=default

# Create VPC peering
gcloud services vpc-peerings connect \
    --service=servicenetworking.googleapis.com \
    --ranges=google-managed-services-default \
    --network=default

# Update instance to use private IP
gcloud sql instances patch suchi-db \
    --network=default \
    --no-assign-ip
```

### 3.4 Store Database URL Secret

```bash
# Get connection name
CONNECTION_NAME=$(gcloud sql instances describe suchi-db --format="value(connectionName)")

# Create DATABASE_URL secret
# Format: postgresql://USERNAME:PASSWORD@/DATABASE?host=/cloudsql/CONNECTION_NAME
DB_URL="postgresql://suchi_app:your_app_password_here@/suchi_db?host=/cloudsql/${CONNECTION_NAME}"

echo -n "$DB_URL" | gcloud secrets create database-url \
    --data-file=- \
    --replication-policy="automatic"
```

## Phase 4: Build and Push Docker Images

### 4.1 Configure Docker Authentication

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### 4.2 Build and Push API Image

```bash
cd apps/api

# Build the image
docker build -t us-central1-docker.pkg.dev/$PROJECT_ID/suchi-images/suchi-api:latest .

# Push to Artifact Registry
docker push us-central1-docker.pkg.dev/$PROJECT_ID/suchi-images/suchi-api:latest
```

### 4.3 Build and Push Web Image

```bash
cd ../web

# Get API service URL (will be available after deployment, or use placeholder)
API_URL="https://suchi-api-XXXXX.run.app/v1"

# Build with API URL as build arg
docker build \
    --build-arg VITE_API_URL="${API_URL}" \
    -t us-central1-docker.pkg.dev/$PROJECT_ID/suchi-images/suchi-web:latest .

# Push to Artifact Registry
docker push us-central1-docker.pkg.dev/$PROJECT_ID/suchi-images/suchi-web:latest
```

**Alternative: Use Cloud Build**

```bash
# From project root
gcloud builds submit --config=cloudbuild.yaml \
    --substitutions=_REGION=us-central1,_ARTIFACT_REGISTRY=suchi-images
```

## Phase 5: Deploy to Cloud Run

### 5.1 Deploy API Service

```bash
# Get connection name
CONNECTION_NAME=$(gcloud sql instances describe suchi-db --format="value(connectionName)")

# Deploy API
gcloud run deploy suchi-api \
    --image us-central1-docker.pkg.dev/$PROJECT_ID/suchi-images/suchi-api:latest \
    --region us-central1 \
    --platform managed \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --port 8080 \
    --add-cloudsql-instances $CONNECTION_NAME \
    --set-env-vars "PORT=8080,NODE_ENV=production,EMBEDDING_MODEL=text-embedding-004,RATE_LIMIT_TTL_SEC=60,RATE_LIMIT_REQ_PER_TTL=20" \
    --set-secrets "DATABASE_URL=database-url:latest,GEMINI_API_KEY=gemini-api-key:latest,EMBEDDING_API_KEY=embedding-api-key:latest,ADMIN_BASIC_USER=admin-basic-user:latest,ADMIN_BASIC_PASS=admin-basic-pass:latest" \
    --service-account $PROJECT_NUMBER-compute@developer.gserviceaccount.com

# Save the API URL
API_URL=$(gcloud run services describe suchi-api --region us-central1 --format="value(status.url)")/v1
echo "API URL: $API_URL"
```

### 5.2 Deploy Web Service

```bash
# Deploy Web (use API URL from previous step)
gcloud run deploy suchi-web \
    --image us-central1-docker.pkg.dev/$PROJECT_ID/suchi-images/suchi-web:latest \
    --region us-central1 \
    --platform managed \
    --allow-unauthenticated \
    --memory 256Mi \
    --cpu 1 \
    --port 8080 \
    --set-env-vars "VITE_API_URL=${API_URL}"
```

### 5.3 Get Service URLs

```bash
# Get API URL
API_URL=$(gcloud run services describe suchi-api --region us-central1 --format="value(status.url)")
echo "API Service: $API_URL"

# Get Web URL
WEB_URL=$(gcloud run services describe suchi-web --region us-central1 --format="value(status.url)")
echo "Web Service: $WEB_URL"
```

## Phase 6: Database Migration

### 6.1 Option A: Local Migration with Cloud SQL Proxy

```bash
# Download Cloud SQL Proxy
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.windows.amd64

# Make executable (Linux/Mac)
chmod +x cloud-sql-proxy

# Start proxy in background
CONNECTION_NAME=$(gcloud sql instances describe suchi-db --format="value(connectionName)")
./cloud-sql-proxy $CONNECTION_NAME --port 5432 &

# Set DATABASE_URL for local connection
export DATABASE_URL="postgresql://suchi_app:your_app_password@localhost:5432/suchi_db"

# Run migration
cd apps/api
npm install
npx prisma generate
npx prisma migrate deploy

# Stop proxy
pkill cloud-sql-proxy
```

### 6.2 Option B: Migration via Cloud Run Job (Recommended)

```bash
# Create a temporary Cloud Run job for migration
gcloud run jobs create suchi-migrate \
    --image us-central1-docker.pkg.dev/$PROJECT_ID/suchi-images/suchi-api:latest \
    --region us-central1 \
    --add-cloudsql-instances $CONNECTION_NAME \
    --set-secrets "DATABASE_URL=database-url:latest" \
    --command "sh" \
    --args "-c,npx prisma migrate deploy" \
    --memory 512Mi \
    --cpu 1 \
    --max-retries 1 \
    --task-timeout 600

# Execute the migration job
gcloud run jobs execute suchi-migrate --region us-central1

# Verify migration
gcloud run jobs executions describe suchi-migrate-XXXXX --region us-central1

# Clean up (optional, keep for future migrations)
# gcloud run jobs delete suchi-migrate --region us-central1
```

### 6.3 Verify pgvector Extension

```bash
# Connect to database
gcloud sql connect suchi-db --user=postgres --database=suchi_db

# In PostgreSQL prompt:
\dx vector

# Should show:
# Name  | Version | Schema |      Description
# ------+---------+--------+-------------------
# vector | 0.5.0   | public | vector data type and ivfflat access method

# Exit
\q
```

## Phase 7: Knowledge Base Ingestion

### 7.1 Local Ingestion (Recommended for First Time)

```bash
# Start Cloud SQL Proxy (see Phase 6.1)
CONNECTION_NAME=$(gcloud sql instances describe suchi-db --format="value(connectionName)")
./cloud-sql-proxy $CONNECTION_NAME --port 5432 &

# Set environment variables
export DATABASE_URL="postgresql://suchi_app:your_app_password@localhost:5432/suchi_db"
export GEMINI_API_KEY="your_gemini_api_key"
export EMBEDDING_API_KEY="your_gemini_api_key"
export EMBEDDING_MODEL="text-embedding-004"

# Run ingestion
cd apps/api
npm install
npm run kb:ingest

# Stop proxy
pkill cloud-sql-proxy
```

### 7.2 Cloud Run Job for KB Ingestion

```bash
# Create Cloud Run job for KB ingestion
gcloud run jobs create suchi-kb-ingest \
    --image us-central1-docker.pkg.dev/$PROJECT_ID/suchi-images/suchi-api:latest \
    --region us-central1 \
    --add-cloudsql-instances $CONNECTION_NAME \
    --set-secrets "DATABASE_URL=database-url:latest,GEMINI_API_KEY=gemini-api-key:latest,EMBEDDING_API_KEY=embedding-api-key:latest" \
    --set-env-vars "EMBEDDING_MODEL=text-embedding-004" \
    --command "sh" \
    --args "-c,npm run kb:ingest" \
    --memory 1Gi \
    --cpu 2 \
    --max-retries 1 \
    --task-timeout 3600

# Execute ingestion
gcloud run jobs execute suchi-kb-ingest --region us-central1
```

## Phase 8: Verification and Testing

### 8.1 Health Check

```bash
# Test API health endpoint
curl https://suchi-api-XXXXX.run.app/v1/health

# Expected response:
# {"status":"ok","timestamp":"2024-01-01T00:00:00.000Z"}
```

### 8.2 Test Chat Endpoint

```bash
# Create a session
SESSION_RESPONSE=$(curl -X POST https://suchi-api-XXXXX.run.app/v1/sessions \
    -H "Content-Type: application/json" \
    -d '{"channel":"web","locale":"en"}')

SESSION_ID=$(echo $SESSION_RESPONSE | jq -r '.sessionId')

# Send a test message
curl -X POST https://suchi-api-XXXXX.run.app/v1/chat \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":\"$SESSION_ID\",\"channel\":\"web\",\"userText\":\"What is cancer?\"}"
```

### 8.3 Verify KB Content

```bash
# Connect to database
gcloud sql connect suchi-db --user=postgres --database=suchi_db

# Check KB documents
SELECT COUNT(*) FROM "KbDocument";
SELECT id, title, "sourceType", "isTrustedSource" FROM "KbDocument" LIMIT 10;

# Check chunks with embeddings
SELECT COUNT(*) FROM "KbChunk" WHERE embedding IS NOT NULL;

# Exit
\q
```

### 8.4 Access Web Interface

Open the Web service URL in your browser:
```
https://suchi-web-XXXXX.run.app
```

## Troubleshooting

### Issue: Cloud Run can't connect to Cloud SQL

**Solution:**
- Ensure Cloud SQL instance has private IP enabled
- Verify Cloud Run service has Cloud SQL connection configured
- Check that the service account has Cloud SQL Client role

```bash
# Grant Cloud SQL Client role
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
    --role="roles/cloudsql.client"
```

### Issue: Secrets not accessible

**Solution:**
```bash
# Grant Secret Manager Secret Accessor role
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

### Issue: Build fails in Cloud Build

**Solution:**
- Check Cloud Build logs: `gcloud builds list`
- Ensure all required files are committed to repository
- Verify .gcloudignore doesn't exclude necessary files

### Issue: API returns 500 errors

**Solution:**
- Check Cloud Run logs: `gcloud run logs read suchi-api --region us-central1`
- Verify all secrets are correctly configured
- Check database connection string format

### Issue: Embeddings not generating

**Solution:**
- Verify EMBEDDING_API_KEY secret is set correctly
- Check API key has necessary permissions
- Review Cloud Run logs for embedding errors

## Cost Optimization

### Development Environment
- Use `db-f1-micro` for Cloud SQL (free tier eligible)
- Set `min-instances=0` for Cloud Run (scales to zero)
- Use minimal memory allocations (256Mi-512Mi)

### Production Environment
- Upgrade to `db-n1-standard-1` or higher for Cloud SQL
- Set `min-instances=1` for Cloud Run to reduce cold starts
- Enable Cloud SQL backups and high availability

## Next Steps

1. **Set up Custom Domain** (optional)
   ```bash
   gcloud run domain-mappings create --service suchi-web --domain yourdomain.com
   ```

2. **Enable Monitoring**
   - Set up Cloud Monitoring dashboards
   - Configure alerting policies
   - Enable Cloud Trace for request tracing

3. **Automate Deployments**
   - Set up Cloud Build triggers on GitHub push
   - Configure CI/CD pipeline
   - Set up automated testing

4. **Scale for Production**
   - Review and adjust resource limits
   - Enable Cloud CDN for static assets
   - Configure autoscaling policies

## Additional Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud SQL Documentation](https://cloud.google.com/sql/docs)
- [Secret Manager Documentation](https://cloud.google.com/secret-manager/docs)
- [Cloud Build Documentation](https://cloud.google.com/build/docs)


