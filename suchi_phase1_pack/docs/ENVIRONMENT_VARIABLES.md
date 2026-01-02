# Environment Variables Configuration

This document lists all required and optional environment variables for Suchi Cancer Bot.

## API Service Environment Variables

### Required Variables

Create these as secrets in Google Cloud Secret Manager:

| Variable | Description | Example | Secret Name |
|----------|-------------|---------|-------------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@/db?host=/cloudsql/project:region:instance` | `database-url` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIzaSy...` | `gemini-api-key` |
| `ADMIN_BASIC_USER` | Admin authentication username | `admin` | `admin-basic-user` |
| `ADMIN_BASIC_PASS` | Admin authentication password | `secure_password` | `admin-basic-pass` |

### Optional Variables

| Variable | Description | Default | Notes |
|----------|-------------|---------|-------|
| `EMBEDDING_API_KEY` | Embedding API key (can use Gemini key) | Uses `GEMINI_API_KEY` | Store as `embedding-api-key` secret |
| `EMBEDDING_MODEL` | Embedding model name | `text-embedding-004` | Google's embedding model |
| `PORT` | Server port | `8080` | Cloud Run uses 8080 by default |
| `NODE_ENV` | Node environment | `production` | Set to `development` for local |
| `RATE_LIMIT_TTL_SEC` | Rate limit time window | `60` | Seconds |
| `RATE_LIMIT_REQ_PER_TTL` | Requests per time window | `20` | Max requests |

### Local Development `.env` File

Create `apps/api/.env` for local development:

```env
# Database Configuration
DATABASE_URL=postgresql://suchi_app:password@localhost:5432/suchi_db

# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key_here

# Embeddings Configuration (can use same key as Gemini)
EMBEDDING_API_KEY=your_gemini_api_key_here
EMBEDDING_MODEL=text-embedding-004

# Admin Authentication
ADMIN_BASIC_USER=admin
ADMIN_BASIC_PASS=your_secure_password_here

# Server Configuration
PORT=3001
NODE_ENV=development

# Rate Limiting
RATE_LIMIT_TTL_SEC=60
RATE_LIMIT_REQ_PER_TTL=20
```

## Web Service Environment Variables

### Required Variables

| Variable | Description | Example | Notes |
|----------|-------------|---------|-------|
| `VITE_API_URL` | Backend API URL | `https://suchi-api-XXXXX.run.app/v1` | Must be set at build time |

### Local Development

For local development, the web app uses Vite proxy (configured in `vite.config.ts`):
- Default: `/v1` (relative path)
- Development proxy: `http://localhost:3001`

### Production Build

The `VITE_API_URL` must be set during Docker build:

```bash
docker build \
    --build-arg VITE_API_URL="https://suchi-api-XXXXX.run.app/v1" \
    -t suchi-web:latest .
```

## Cloud SQL Connection String Format

For Cloud Run with Private IP:

```
postgresql://USERNAME:PASSWORD@/DATABASE_NAME?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
```

Example:
```
postgresql://suchi_app:mypassword@/suchi_db?host=/cloudsql/my-project:us-central1:suchi-db
```

For Local Development with Cloud SQL Proxy:

```
postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME
```

## Google Cloud Secret Manager Setup

### Create Secrets via CLI

```bash
# Gemini API Key
echo -n "your_api_key" | gcloud secrets create gemini-api-key \
    --data-file=- \
    --replication-policy="automatic"

# Embedding API Key (can be same as Gemini)
echo -n "your_api_key" | gcloud secrets create embedding-api-key \
    --data-file=- \
    --replication-policy="automatic"

# Admin credentials
echo -n "admin" | gcloud secrets create admin-basic-user \
    --data-file=- \
    --replication-policy="automatic"

echo -n "secure_password" | gcloud secrets create admin-basic-pass \
    --data-file=- \
    --replication-policy="automatic"

# Database URL
echo -n "postgresql://..." | gcloud secrets create database-url \
    --data-file=- \
    --replication-policy="automatic"
```

### Update Secrets

```bash
echo -n "new_value" | gcloud secrets versions add SECRET_NAME \
    --data-file=-
```

### Access Secrets in Cloud Run

When deploying to Cloud Run, reference secrets:

```bash
--set-secrets "DATABASE_URL=database-url:latest,GEMINI_API_KEY=gemini-api-key:latest"
```

## Security Best Practices

1. **Never commit `.env` files** - They are in `.gitignore`
2. **Use Secret Manager** - Store all sensitive values in Google Cloud Secret Manager
3. **Rotate secrets regularly** - Update API keys and passwords periodically
4. **Use least privilege** - Grant minimal permissions to service accounts
5. **Enable audit logging** - Monitor secret access in Cloud Logging

## Environment-Specific Configuration

### Development
- Use local PostgreSQL or Cloud SQL Proxy
- Set `NODE_ENV=development`
- Enable debug logging
- Use development API keys (if separate)

### Staging
- Use separate Cloud SQL instance
- Set `NODE_ENV=production`
- Use staging API keys
- Enable monitoring

### Production
- Use production Cloud SQL instance
- Set `NODE_ENV=production`
- Use production API keys
- Enable full monitoring and alerting
- Use higher resource limits







