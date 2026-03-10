# Google Cloud Secret Manager - gcloud CLI Commands

Quick reference for managing evaluation framework secrets using gcloud CLI.

## Prerequisites

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Enable Secret Manager API (no-op if already enabled)
gcloud services enable secretmanager.googleapis.com

# Authenticate
gcloud auth login
gcloud auth application-default login
```

## Add/Update Deepseek API Key

### Option 1: Create New Secret (Recommended - Secure Input)

**Bash/Linux/Mac:**
```bash
# Prompt for API key securely (no echo to screen, no file left behind)
read -s DEEPSEEK_API_KEY
printf %s "$DEEPSEEK_API_KEY" | gcloud secrets create deepseek-api-key \
    --replication-policy="automatic" \
    --data-file=-
unset DEEPSEEK_API_KEY
```

**PowerShell/Windows:**
```powershell
# Prompt for API key securely
$secureKey = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$ApiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
$ApiKey | gcloud secrets create deepseek-api-key `
    --replication-policy="automatic" `
    --data-file=-
$ApiKey = $null
```

### Option 2: Update Existing Secret (Rotation-Friendly)

**Bash/Linux/Mac:**
```bash
# Prompt for API key securely
read -s DEEPSEEK_API_KEY
printf %s "$DEEPSEEK_API_KEY" | gcloud secrets versions add deepseek-api-key \
    --data-file=-
unset DEEPSEEK_API_KEY
```

**PowerShell/Windows:**
```powershell
$secureKey = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$ApiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
$ApiKey | gcloud secrets versions add deepseek-api-key `
    --data-file=-
$ApiKey = $null
```

### Security Notes

- ✅ `read -s` (bash) / `Read-Host -AsSecureString` (PowerShell) avoids echoing the key to your screen
- ✅ Using stdin (`--data-file=-`) avoids leaving the key in a local file
- ⚠️ **Avoid** `echo "KEY..."` as it may be stored in shell history
- ✅ Always `unset` the variable after use to clear it from memory

### Set LLM Provider

```bash
PROJECT_ID=$(gcloud config get-value project)

# Create or update provider secret
echo -n "deepseek" | gcloud secrets versions add eval-llm-provider \
    --project=$PROJECT_ID \
    --data-file=-
```

## Grant Access Permissions

### Grant to Your User Account (for local development)

```bash
gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="user:$(gcloud config get-value account)" \
    --role="roles/secretmanager.secretAccessor"
```

### Grant to Cloud Run Service Account (for production)

**Identify your Cloud Run service account:**
```bash
# Get the default compute service account
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Or if using a custom service account
CLOUD_RUN_SA="YOUR_CUSTOM_SA@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

**Grant Secret Accessor role:**
```bash
gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="serviceAccount:$CLOUD_RUN_SA" \
    --role="roles/secretmanager.secretAccessor"
```

**Note:** Cloud Run needs `roles/secretmanager.secretAccessor` on the secret to access it at runtime.

## View Secrets

### List All Secrets

```bash
gcloud secrets list --project=$(gcloud config get-value project)
```

### View Secret Value

```bash
gcloud secrets versions access latest \
    --secret="deepseek-api-key" \
    --project=$(gcloud config get-value project)
```

### View Secret Metadata

```bash
gcloud secrets describe deepseek-api-key \
    --project=$(gcloud config get-value project)
```

### List Secret Versions

```bash
gcloud secrets versions list deepseek-api-key \
    --project=$(gcloud config get-value project)
```

## Delete Secrets

### Delete a Secret Version

```bash
gcloud secrets versions destroy VERSION_NUMBER \
    --secret="deepseek-api-key" \
    --project=$(gcloud config get-value project)
```

### Delete Entire Secret

```bash
gcloud secrets delete deepseek-api-key \
    --project=$(gcloud config get-value project)
```

## Cloud Run Integration

### Attach Secret to Cloud Run Service

Use Secret Manager integration for Cloud Run (recommended by Google):

```bash
gcloud run services update YOUR_SERVICE_NAME \
    --region us-central1 \
    --set-secrets=DEEPSEEK_API_KEY=deepseek-api-key:latest
```

This exposes the secret to your container as an environment variable named `DEEPSEEK_API_KEY`.

**For multiple secrets:**
```bash
gcloud run services update YOUR_SERVICE_NAME \
    --region us-central1 \
    --set-secrets=DEEPSEEK_API_KEY=deepseek-api-key:latest,OPENAI_API_KEY=openai-api-key:latest
```

### Verify Cloud Run Secret Mapping

```bash
gcloud run services describe YOUR_SERVICE_NAME \
    --region us-central1 \
    --format="yaml(spec.template.spec.containers[0].env)"
```

This shows all environment variables, including secrets mapped from Secret Manager.

## Windows PowerShell Commands

### Create/Update Secret (Secure)

```powershell
# Prompt securely (no echo)
$secureKey = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$ApiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
$ApiKey | gcloud secrets versions add deepseek-api-key `
    --data-file=-
$ApiKey = $null
```

### Set Provider

```powershell
"deepseek" | gcloud secrets versions add eval-llm-provider `
    --data-file=-
```

## Verification (Without Leaking the Key)

### Confirm Secret Exists

```bash
gcloud secrets list --filter="name:deepseek-api-key"
```

### Check Permissions

```bash
gcloud secrets get-iam-policy deepseek-api-key
```

### Test Secret Access (Without Viewing Value)

```bash
# This will show if you can access it (but don't print the value in logs)
gcloud secrets versions access latest --secret="deepseek-api-key" > /dev/null && echo "✓ Access granted" || echo "✗ Access denied"
```

## Troubleshooting

### Common Failure Modes

**1. Permission denied creating secret**
- **Error:** `PERMISSION_DENIED` when creating secret
- **Solution:** You need `roles/secretmanager.admin` on the project
```bash
# Grant yourself admin role (if you have project owner/admin)
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
    --member="user:$(gcloud config get-value account)" \
    --role="roles/secretmanager.admin"
```

**2. Permission denied at runtime on Cloud Run**
- **Error:** Cloud Run service can't access the secret
- **Solution:** The Cloud Run runtime service account lacks `roles/secretmanager.secretAccessor`
```bash
# Get your Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant access
gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="serviceAccount:$CLOUD_RUN_SA" \
    --role="roles/secretmanager.secretAccessor"
```

**3. Secret not found in Cloud Run**
- **Error:** Environment variable not available in container
- **Solution:** Verify secret is attached to the service
```bash
gcloud run services describe YOUR_SERVICE_NAME \
    --region us-central1 \
    --format="yaml(spec.template.spec.containers[0].env)"
```

## Security Best Practices

1. **Never commit API keys** - Always use Secret Manager
2. **Use least privilege** - Only grant `secretmanager.secretAccessor` role
3. **Rotate regularly** - Update secrets periodically
4. **Monitor access** - Check Cloud Logging for secret access
5. **Use separate projects** - Dev, staging, production

