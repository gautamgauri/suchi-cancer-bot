# Script to add/update Deepseek API key in Google Cloud Secret Manager
# Usage: .\add-deepseek-secret.ps1 [PROJECT_ID]
# 
# SECURITY: This script will prompt for the API key securely (no echo to screen)
# For Cloud Run integration, see docs/GCLOUD_SECRETS_COMMANDS.md

param(
    [Parameter(Mandatory=$false)]
    [string]$ProjectId = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipPrompt = $false
)

Write-Host "Adding Deepseek API key to Google Cloud Secret Manager..." -ForegroundColor Green
Write-Host ""

# Get project ID if not provided
if ([string]::IsNullOrEmpty($ProjectId)) {
    $ProjectId = gcloud config get-value project 2>$null
    if ([string]::IsNullOrEmpty($ProjectId)) {
        Write-Host "ERROR: No Google Cloud project configured!" -ForegroundColor Red
        Write-Host "Please provide project ID: .\add-deepseek-secret.ps1 -ProjectId YOUR_PROJECT_ID" -ForegroundColor Yellow
        Write-Host "Or set it: gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "Using Project ID: $ProjectId" -ForegroundColor Cyan
Write-Host ""

# Prompt for API key securely (no echo to screen)
if (-not $SkipPrompt) {
    Write-Host "Enter your Deepseek API key (input will be hidden):" -ForegroundColor Yellow
    $secureKey = Read-Host -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $ApiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
    Write-Host ""
} else {
    # Fallback for automation (not recommended for production)
    $ApiKey = "sk-6bc325dec38c4d4c95f9f4ecb185e1dc"
    Write-Host "⚠ Using default API key from script (not recommended for production)" -ForegroundColor Yellow
    Write-Host ""
}

# Check if Secret Manager API is enabled
Write-Host "Checking Secret Manager API..." -ForegroundColor Yellow
$apiEnabled = gcloud services list --enabled --filter="name:secretmanager.googleapis.com" --format="value(name)" --project=$ProjectId 2>$null
if ([string]::IsNullOrEmpty($apiEnabled)) {
    Write-Host "Secret Manager API not enabled. Enabling now..." -ForegroundColor Yellow
    gcloud services enable secretmanager.googleapis.com --project=$ProjectId
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to enable Secret Manager API" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Secret Manager API enabled" -ForegroundColor Green
}

# Check if secret already exists
Write-Host "Checking if secret 'deepseek-api-key' exists..." -ForegroundColor Yellow
$secretExists = gcloud secrets describe deepseek-api-key --project=$ProjectId 2>$null

if ($LASTEXITCODE -eq 0) {
    # Secret exists - add new version (rotation-friendly)
    Write-Host "Secret exists. Adding new version..." -ForegroundColor Yellow
    $ApiKey | gcloud secrets versions add deepseek-api-key `
        --project=$ProjectId `
        --data-file=-
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Secret updated successfully!" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Failed to update secret" -ForegroundColor Red
        exit 1
    }
} else {
    # Secret doesn't exist - create it
    Write-Host "Secret doesn't exist. Creating new secret..." -ForegroundColor Yellow
    $ApiKey | gcloud secrets create deepseek-api-key `
        --project=$ProjectId `
        --data-file=- `
        --replication-policy="automatic"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Secret created successfully!" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Failed to create secret" -ForegroundColor Red
        Write-Host "You may need roles/secretmanager.admin permission" -ForegroundColor Yellow
        exit 1
    }
}

# Clear API key from memory
$ApiKey = $null

# Set LLM provider to deepseek
Write-Host ""
Write-Host "Setting LLM provider to 'deepseek'..." -ForegroundColor Yellow
$providerExists = gcloud secrets describe eval-llm-provider --project=$ProjectId 2>$null

if ($LASTEXITCODE -eq 0) {
    echo -n "deepseek" | gcloud secrets versions add eval-llm-provider `
        --project=$ProjectId `
        --data-file=-
    Write-Host "✓ Provider updated to 'deepseek'" -ForegroundColor Green
} else {
    echo -n "deepseek" | gcloud secrets create eval-llm-provider `
        --project=$ProjectId `
        --data-file=- `
        --replication-policy="automatic"
    Write-Host "✓ Provider set to 'deepseek'" -ForegroundColor Green
}

# Grant access to current user
Write-Host ""
Write-Host "Granting access permissions..." -ForegroundColor Yellow
$currentUser = gcloud config get-value account
if ($currentUser) {
    gcloud secrets add-iam-policy-binding deepseek-api-key `
        --project=$ProjectId `
        --member="user:$currentUser" `
        --role="roles/secretmanager.secretAccessor" 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Access granted to $currentUser" -ForegroundColor Green
    } else {
        Write-Host "⚠ Could not grant access (may already have access)" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ Could not determine current user. Grant access manually:" -ForegroundColor Yellow
    Write-Host "  gcloud secrets add-iam-policy-binding deepseek-api-key --member='user:YOUR_EMAIL' --role='roles/secretmanager.secretAccessor' --project=$ProjectId" -ForegroundColor White
}

# Set project ID environment variable
Write-Host ""
Write-Host "Setting GOOGLE_CLOUD_PROJECT environment variable..." -ForegroundColor Yellow
$env:GOOGLE_CLOUD_PROJECT = $ProjectId
[System.Environment]::SetEnvironmentVariable("GOOGLE_CLOUD_PROJECT", $ProjectId, "User")
Write-Host "✓ GOOGLE_CLOUD_PROJECT set to $ProjectId" -ForegroundColor Green

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""
Write-Host "Secrets created/updated:" -ForegroundColor Yellow
Write-Host "  ✓ deepseek-api-key" -ForegroundColor Green
Write-Host "  ✓ eval-llm-provider (set to 'deepseek')" -ForegroundColor Green
Write-Host ""
Write-Host "Verification:" -ForegroundColor Yellow
Write-Host "  gcloud secrets list --filter=`"name:deepseek-api-key`"" -ForegroundColor White
Write-Host ""
Write-Host "For Cloud Run integration:" -ForegroundColor Yellow
Write-Host "  gcloud run services update YOUR_SERVICE_NAME \`" -ForegroundColor White
Write-Host "    --region us-central1 \`" -ForegroundColor White
Write-Host "    --set-secrets=DEEPSEEK_API_KEY=deepseek-api-key:latest" -ForegroundColor White
Write-Host ""
Write-Host "For local evaluation framework:" -ForegroundColor Yellow
Write-Host "  1. Install Secret Manager SDK: npm install @google-cloud/secret-manager" -ForegroundColor White
Write-Host "  2. Authenticate: gcloud auth application-default login" -ForegroundColor White
Write-Host "  3. Run evaluations: npm run eval run" -ForegroundColor White
Write-Host ""

