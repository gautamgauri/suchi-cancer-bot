#!/bin/bash
# Script to add/update Deepseek API key in Google Cloud Secret Manager
# Usage: ./add-deepseek-secret.sh [PROJECT_ID]
# 
# SECURITY: This script will prompt for the API key securely (no echo to screen)
# For Cloud Run integration, see docs/GCLOUD_SECRETS_COMMANDS.md

PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null)}"

if [ -z "$PROJECT_ID" ]; then
    echo "ERROR: No Google Cloud project configured!"
    echo "Usage: ./add-deepseek-secret.sh [API_KEY] [PROJECT_ID]"
    echo "Or set it: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "Adding Deepseek API key to Google Cloud Secret Manager..."
echo "Using Project ID: $PROJECT_ID"
echo ""

# Prompt for API key securely (no echo to screen)
echo "Enter your Deepseek API key (input will be hidden):"
read -s DEEPSEEK_API_KEY
echo ""

# Check if Secret Manager API is enabled
echo "Checking Secret Manager API..."
if ! gcloud services list --enabled --filter="name:secretmanager.googleapis.com" --format="value(name)" --project="$PROJECT_ID" &>/dev/null; then
    echo "Secret Manager API not enabled. Enabling now..."
    gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to enable Secret Manager API"
        exit 1
    fi
    echo "✓ Secret Manager API enabled"
fi

# Check if secret already exists
echo "Checking if secret 'deepseek-api-key' exists..."
if gcloud secrets describe deepseek-api-key --project="$PROJECT_ID" &>/dev/null; then
    # Secret exists - add new version (rotation-friendly)
    echo "Secret exists. Adding new version..."
    printf %s "$DEEPSEEK_API_KEY" | gcloud secrets versions add deepseek-api-key \
        --project="$PROJECT_ID" \
        --data-file=-
    
    if [ $? -eq 0 ]; then
        echo "✓ Secret updated successfully!"
    else
        echo "ERROR: Failed to update secret"
        unset DEEPSEEK_API_KEY
        exit 1
    fi
else
    # Secret doesn't exist - create it
    echo "Secret doesn't exist. Creating new secret..."
    printf %s "$DEEPSEEK_API_KEY" | gcloud secrets create deepseek-api-key \
        --project="$PROJECT_ID" \
        --data-file=- \
        --replication-policy="automatic"
    
    if [ $? -eq 0 ]; then
        echo "✓ Secret created successfully!"
    else
        echo "ERROR: Failed to create secret"
        echo "You may need roles/secretmanager.admin permission"
        unset DEEPSEEK_API_KEY
        exit 1
    fi
fi

# Clear API key from memory
unset DEEPSEEK_API_KEY

# Set LLM provider to deepseek
echo ""
echo "Setting LLM provider to 'deepseek'..."
if gcloud secrets describe eval-llm-provider --project="$PROJECT_ID" &>/dev/null; then
    echo -n "deepseek" | gcloud secrets versions add eval-llm-provider \
        --project="$PROJECT_ID" \
        --data-file=-
    echo "✓ Provider updated to 'deepseek'"
else
    echo -n "deepseek" | gcloud secrets create eval-llm-provider \
        --project="$PROJECT_ID" \
        --data-file=- \
        --replication-policy="automatic"
    echo "✓ Provider set to 'deepseek'"
fi

# Grant access to current user
echo ""
echo "Granting access permissions..."
CURRENT_USER=$(gcloud config get-value account 2>/dev/null)
if [ -n "$CURRENT_USER" ]; then
    gcloud secrets add-iam-policy-binding deepseek-api-key \
        --project="$PROJECT_ID" \
        --member="user:$CURRENT_USER" \
        --role="roles/secretmanager.secretAccessor" &>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✓ Access granted to $CURRENT_USER"
    else
        echo "⚠ Could not grant access (may already have access)"
    fi
else
    echo "⚠ Could not determine current user. Grant access manually:"
    echo "  gcloud secrets add-iam-policy-binding deepseek-api-key --member='user:YOUR_EMAIL' --role='roles/secretmanager.secretAccessor' --project=$PROJECT_ID"
fi

# Set project ID environment variable
echo ""
echo "Setting GOOGLE_CLOUD_PROJECT environment variable..."
export GOOGLE_CLOUD_PROJECT="$PROJECT_ID"
echo "export GOOGLE_CLOUD_PROJECT=$PROJECT_ID" >> ~/.bashrc 2>/dev/null || echo "export GOOGLE_CLOUD_PROJECT=$PROJECT_ID" >> ~/.zshrc 2>/dev/null
echo "✓ GOOGLE_CLOUD_PROJECT set to $PROJECT_ID"

echo ""
echo "============================================================"
echo "Setup Complete!"
echo "============================================================"
echo ""
echo "Secrets created/updated:"
echo "  ✓ deepseek-api-key"
echo "  ✓ eval-llm-provider (set to 'deepseek')"
echo ""
echo "Verification:"
echo "  gcloud secrets list --filter=\"name:deepseek-api-key\""
echo ""
echo "For Cloud Run integration:"
echo "  gcloud run services update YOUR_SERVICE_NAME \\"
echo "    --region us-central1 \\"
echo "    --set-secrets=DEEPSEEK_API_KEY=deepseek-api-key:latest"
echo ""
echo "For local evaluation framework:"
echo "  1. Install Secret Manager SDK: npm install @google-cloud/secret-manager"
echo "  2. Authenticate: gcloud auth application-default login"
echo "  3. Run evaluations: npm run eval run"
echo ""

