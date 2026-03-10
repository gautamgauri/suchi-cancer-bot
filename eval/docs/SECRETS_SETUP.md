# Google Cloud Secrets Manager Setup

This guide explains how to securely store and use API keys for the evaluation framework using Google Cloud Secrets Manager.

## Why Use Secret Manager?

- **Security**: API keys are never stored in code or config files
- **Centralized Management**: All secrets in one place
- **Access Control**: Fine-grained IAM permissions
- **Audit Logging**: Track who accessed secrets and when
- **Versioning**: Keep history of secret changes
- **Rotation**: Easy to update secrets without code changes

## Prerequisites

1. Google Cloud Project with billing enabled
2. Secret Manager API enabled
3. `gcloud` CLI installed and authenticated
4. Appropriate IAM permissions

## Setup Steps

### 1. Enable Secret Manager API

```bash
gcloud services enable secretmanager.googleapis.com
```

### 2. Create Secrets

Create secrets for your API keys:

```bash
# Set your project ID
export PROJECT_ID=$(gcloud config get-value project)

# Deepseek API Key
echo -n "sk-6bc325dec38c4d4c95f9f4ecb185e1dc" | gcloud secrets create deepseek-api-key \
    --project=$PROJECT_ID \
    --data-file=- \
    --replication-policy="automatic"

# OpenAI API Key (if using OpenAI)
echo -n "your_openai_api_key_here" | gcloud secrets create openai-api-key \
    --project=$PROJECT_ID \
    --data-file=- \
    --replication-policy="automatic"

# LLM Provider Selection (optional - defaults to "openai")
echo -n "deepseek" | gcloud secrets create eval-llm-provider \
    --project=$PROJECT_ID \
    --data-file=- \
    --replication-policy="automatic"

# Model names (optional - uses defaults if not set)
echo -n "deepseek-chat" | gcloud secrets create deepseek-model \
    --project=$PROJECT_ID \
    --data-file=- \
    --replication-policy="automatic"

echo -n "gpt-4o" | gcloud secrets create openai-model \
    --project=$PROJECT_ID \
    --data-file=- \
    --replication-policy="automatic"
```

### 3. Grant Access Permissions

Grant your user/service account access to read secrets:

```bash
# For your user account (local development)
gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="user:$(gcloud config get-value account)" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT_ID

# For service account (Cloud Run / Cloud Build)
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding deepseek-api-key \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT_ID
```

### 4. Set Project ID

Set the Google Cloud Project ID as an environment variable:

```bash
# Windows PowerShell
$env:GOOGLE_CLOUD_PROJECT = "your-project-id"

# Linux/Mac
export GOOGLE_CLOUD_PROJECT=your-project-id
```

Or set it in your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
export GOOGLE_CLOUD_PROJECT=your-project-id
```

### 5. Install Dependencies

```bash
cd eval
npm install @google-cloud/secret-manager
```

### 6. Authenticate

Ensure you're authenticated with Google Cloud:

```bash
gcloud auth application-default login
```

## Usage

Once secrets are set up, the evaluation framework will automatically:

1. Check if `GOOGLE_CLOUD_PROJECT` is set
2. Try to load secrets from Secret Manager
3. Fall back to environment variables if secrets aren't available
4. Use config file values as final fallback

### Running Evaluations

```bash
# Set project ID
export GOOGLE_CLOUD_PROJECT=your-project-id

# Run evaluations (will use secrets automatically)
npm run eval run
```

## Secret Names Reference

| Secret Name | Description | Required For |
|------------|-------------|--------------|
| `deepseek-api-key` | Deepseek API key | Deepseek provider |
| `openai-api-key` | OpenAI API key | OpenAI provider |
| `eval-llm-provider` | Provider selection (`openai`, `deepseek`, `vertex_ai`) | Optional (defaults to `openai`) |
| `deepseek-model` | Deepseek model name | Optional (defaults to `deepseek-chat`) |
| `openai-model` | OpenAI model name | Optional (defaults to `gpt-4o`) |

## Updating Secrets

To update a secret value:

```bash
echo -n "new_api_key_value" | gcloud secrets versions add deepseek-api-key \
    --project=$PROJECT_ID \
    --data-file=-
```

The framework will automatically use the latest version.

## Verifying Secrets

List all secrets:

```bash
gcloud secrets list --project=$PROJECT_ID
```

View a secret value (requires access):

```bash
gcloud secrets versions access latest --secret="deepseek-api-key" --project=$PROJECT_ID
```

## Troubleshooting

### Error: "Secret not found or access denied"

**Solution:**
1. Verify the secret exists: `gcloud secrets list`
2. Check IAM permissions: `gcloud secrets get-iam-policy deepseek-api-key`
3. Grant access: `gcloud secrets add-iam-policy-binding ...`

### Error: "GOOGLE_CLOUD_PROJECT not set"

**Solution:**
```bash
export GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project)
```

### Error: "Secret Manager SDK not installed"

**Solution:**
```bash
cd eval
npm install @google-cloud/secret-manager
```

### Fallback to Environment Variables

If Secret Manager is unavailable, the framework will automatically fall back to:
1. Environment variables (`DEEPSEEK_API_KEY`, etc.)
2. Config file values (`config/default.json`)

This ensures the framework works in all environments.

## Security Best Practices

1. **Never commit secrets** - Use Secret Manager or environment variables
2. **Use least privilege** - Grant only `secretmanager.secretAccessor` role
3. **Enable audit logging** - Monitor secret access in Cloud Logging
4. **Rotate secrets regularly** - Update API keys periodically
5. **Use separate secrets per environment** - Dev, staging, production
6. **Enable secret versioning** - Keep history of changes

## Cost

Google Cloud Secret Manager pricing:
- **First 6 secrets**: Free
- **Additional secrets**: $0.06 per secret per month
- **Operations**: $0.03 per 10,000 operations

For evaluation framework usage, this is typically free or very low cost.









