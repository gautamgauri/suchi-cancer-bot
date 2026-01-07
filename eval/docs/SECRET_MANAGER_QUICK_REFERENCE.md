# Google Cloud Secret Manager - Quick Reference

## A. One-time Setup (Project + APIs)

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable secretmanager.googleapis.com
```

(If Secret Manager is already enabled, the second line is a no-op.)

## B. Create the Secret and Store Your DeepSeek API Key

### Option 1 (Recommended): Create Secret from stdin (No File Left Behind)

**Bash/Linux/Mac:**
```bash
read -s DEEPSEEK_API_KEY
printf %s "$DEEPSEEK_API_KEY" | gcloud secrets create deepseek-api-key \
    --replication-policy="automatic" \
    --data-file=-
unset DEEPSEEK_API_KEY
```

**PowerShell/Windows:**
```powershell
$secureKey = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$ApiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
$ApiKey | gcloud secrets create deepseek-api-key `
    --replication-policy="automatic" `
    --data-file=-
$ApiKey = $null
```

### Option 2: Secret Already Exists → Add a New Version (Rotation-Friendly)

**Bash/Linux/Mac:**
```bash
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

### Notes:

- ✅ `read -s` (bash) / `Read-Host -AsSecureString` (PowerShell) avoids echoing the key to your screen
- ✅ Using stdin (`--data-file=-`) avoids leaving the key in a local file
- ⚠️ **Avoid** `echo "KEY..."` as it may be stored in shell history
- ✅ Always `unset` / clear the variable after use

To create secrets you typically need **Secret Manager Admin** on the project or appropriate scope.

## C. Grant Cloud Run Permission to Access the Secret

Cloud Run needs the **Secret Manager Secret Accessor** role on the secret.

### Identify the Service Account

Your Cloud Run service runs as either:
- Default compute service account: `PROJECT_NUMBER-compute@developer.gserviceaccount.com`
- Custom service account: `YOUR_SA@YOUR_PROJECT_ID.iam.gserviceaccount.com`

### Bind the Secret Accessor Role

```bash
# For default compute service account
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="serviceAccount:$CLOUD_RUN_SA" \
    --role="roles/secretmanager.secretAccessor"
```

Or if you know your service account email:

```bash
gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="serviceAccount:YOUR_CLOUD_RUN_SA@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

## D. Attach the Secret to Your Cloud Run Service (us-central1)

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

## E. Verify (Without Leaking the Key)

### Confirm Secret Exists

```bash
gcloud secrets list --filter="name:deepseek-api-key"
```

### Confirm Cloud Run Has the Secret Mapping

```bash
gcloud run services describe YOUR_SERVICE_NAME \
    --region us-central1 \
    --format="yaml(spec.template.spec.containers[0].env)"
```

This shows all environment variables, including secrets mapped from Secret Manager.

## Common Failure Modes

### Permission Denied Creating Secret

**Error:** `PERMISSION_DENIED` when creating secret

**Solution:** You likely lack `roles/secretmanager.admin`

```bash
# Grant yourself admin role (if you have project owner/admin)
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
    --member="user:$(gcloud config get-value account)" \
    --role="roles/secretmanager.admin"
```

### Permission Denied at Runtime on Cloud Run

**Error:** Cloud Run service can't access the secret

**Solution:** The Cloud Run runtime service account lacks `roles/secretmanager.secretAccessor` on that secret

```bash
# Get your Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant access
gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="serviceAccount:$CLOUD_RUN_SA" \
    --role="roles/secretmanager.secretAccessor"
```

## Quick Setup Script

If you provide your Cloud Run service name and (if known) the service account email, you can use:

```bash
# Set variables
PROJECT_ID=$(gcloud config get-value project)
SERVICE_NAME="YOUR_SERVICE_NAME"  # Replace with your Cloud Run service name
REGION="us-central1"  # Replace with your region

# One-time setup
gcloud config set project $PROJECT_ID
gcloud services enable secretmanager.googleapis.com

# Create secret (will prompt securely)
read -s DEEPSEEK_API_KEY
printf %s "$DEEPSEEK_API_KEY" | gcloud secrets versions add deepseek-api-key \
    --data-file=- 2>/dev/null || \
printf %s "$DEEPSEEK_API_KEY" | gcloud secrets create deepseek-api-key \
    --replication-policy="automatic" \
    --data-file=-
unset DEEPSEEK_API_KEY

# Grant Cloud Run access
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="serviceAccount:$CLOUD_RUN_SA" \
    --role="roles/secretmanager.secretAccessor"

# Attach to Cloud Run
gcloud run services update $SERVICE_NAME \
    --region $REGION \
    --set-secrets=DEEPSEEK_API_KEY=deepseek-api-key:latest

# Verify
gcloud secrets list --filter="name:deepseek-api-key"
gcloud run services describe $SERVICE_NAME \
    --region $REGION \
    --format="yaml(spec.template.spec.containers[0].env)"
```





