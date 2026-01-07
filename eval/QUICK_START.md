# Quick Start Guide - Evaluation Framework

## Secure Setup with Google Cloud Secret Manager

### Step 1: Run Setup Script

**Windows:**
```powershell
cd eval
.\setup-deepseek.ps1
```

This will:
- Store your Deepseek API key in Google Cloud Secret Manager
- Configure IAM permissions
- Set up your project ID

### Step 2: Install Dependencies

```bash
npm install @google-cloud/secret-manager
```

### Step 3: Authenticate

```bash
gcloud auth application-default login
```

### Step 4: Run Evaluations

```bash
npm run eval run
```

The framework will automatically:
1. ✅ Load secrets from Google Cloud Secret Manager
2. ✅ Fall back to environment variables if needed
3. ✅ Use config file as final fallback

## Manual Secret Creation

If you prefer to create secrets manually:

```bash
# Set project
export PROJECT_ID=$(gcloud config get-value project)

# Create Deepseek API key secret
echo -n "sk-6bc325dec38c4d4c95f9f4ecb185e1dc" | gcloud secrets create deepseek-api-key \
    --project=$PROJECT_ID \
    --data-file=- \
    --replication-policy="automatic"

# Set provider
echo -n "deepseek" | gcloud secrets create eval-llm-provider \
    --project=$PROJECT_ID \
    --data-file=- \
    --replication-policy="automatic"

# Grant access
gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="user:$(gcloud config get-value account)" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT_ID
```

## Verification

Check that secrets are accessible:

```bash
gcloud secrets list
gcloud secrets versions access latest --secret="deepseek-api-key"
```

## Troubleshooting

**"Secret not found"**: Run the setup script or create secrets manually

**"Permission denied"**: Grant Secret Accessor role to your account

**"GOOGLE_CLOUD_PROJECT not set"**: 
```bash
export GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project)
```

For detailed instructions, see [docs/SECRETS_SETUP.md](docs/SECRETS_SETUP.md)





