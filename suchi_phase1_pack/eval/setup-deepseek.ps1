# Setup script for Deepseek API key using Google Cloud Secret Manager
# This script helps you store the API key securely in GCP Secret Manager

Write-Host "Setting up Deepseek API key in Google Cloud Secret Manager..." -ForegroundColor Green
Write-Host ""

# Check if gcloud is installed
$gcloudPath = Get-Command gcloud -ErrorAction SilentlyContinue
if (-not $gcloudPath) {
    Write-Host "ERROR: gcloud CLI not found!" -ForegroundColor Red
    Write-Host "Please install Google Cloud SDK: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# Get project ID
$projectId = gcloud config get-value project 2>$null
if (-not $projectId) {
    Write-Host "ERROR: No Google Cloud project configured!" -ForegroundColor Red
    Write-Host "Run: gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Yellow
    exit 1
}

Write-Host "Using Google Cloud Project: $projectId" -ForegroundColor Cyan
Write-Host ""

# Check if Secret Manager API is enabled
Write-Host "Checking Secret Manager API..." -ForegroundColor Yellow
$apiEnabled = gcloud services list --enabled --filter="name:secretmanager.googleapis.com" --format="value(name)" 2>$null
if (-not $apiEnabled) {
    Write-Host "Secret Manager API not enabled. Enabling now..." -ForegroundColor Yellow
    gcloud services enable secretmanager.googleapis.com --project=$projectId
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to enable Secret Manager API" -ForegroundColor Red
        exit 1
    }
}

# Create Deepseek API key secret
Write-Host "Creating deepseek-api-key secret..." -ForegroundColor Yellow
$secretExists = gcloud secrets describe deepseek-api-key --project=$projectId 2>$null
if ($secretExists) {
    Write-Host "Secret already exists. Updating with new version..." -ForegroundColor Yellow
    echo -n "sk-6bc325dec38c4d4c95f9f4ecb185e1dc" | gcloud secrets versions add deepseek-api-key --project=$projectId --data-file=-
} else {
    echo -n "sk-6bc325dec38c4d4c95f9f4ecb185e1dc" | gcloud secrets create deepseek-api-key --project=$projectId --data-file=- --replication-policy="automatic"
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Deepseek API key stored in Secret Manager" -ForegroundColor Green
} else {
    Write-Host "ERROR: Failed to create/update secret" -ForegroundColor Red
    exit 1
}

# Set LLM provider secret
Write-Host "Setting LLM provider to 'deepseek'..." -ForegroundColor Yellow
$providerExists = gcloud secrets describe eval-llm-provider --project=$projectId 2>$null
if ($providerExists) {
    echo -n "deepseek" | gcloud secrets versions add eval-llm-provider --project=$projectId --data-file=-
} else {
    echo -n "deepseek" | gcloud secrets create eval-llm-provider --project=$projectId --data-file=- --replication-policy="automatic"
}

# Grant access to current user
Write-Host "Granting access permissions..." -ForegroundColor Yellow
$currentUser = gcloud config get-value account
gcloud secrets add-iam-policy-binding deepseek-api-key --project=$projectId --member="user:$currentUser" --role="roles/secretmanager.secretAccessor" 2>$null

# Set project ID environment variable
Write-Host ""
Write-Host "Setting GOOGLE_CLOUD_PROJECT environment variable..." -ForegroundColor Yellow
$env:GOOGLE_CLOUD_PROJECT = $projectId
[System.Environment]::SetEnvironmentVariable("GOOGLE_CLOUD_PROJECT", $projectId, "User")

Write-Host ""
Write-Host "✓ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  Project ID: $projectId"
Write-Host "  Secret: deepseek-api-key"
Write-Host "  Provider: deepseek"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Install Secret Manager SDK: npm install @google-cloud/secret-manager" -ForegroundColor White
Write-Host "  2. Authenticate: gcloud auth application-default login" -ForegroundColor White
Write-Host "  3. Run evaluations: npm run eval run" -ForegroundColor White
Write-Host ""
Write-Host "The framework will automatically load secrets from Secret Manager!" -ForegroundColor Green

