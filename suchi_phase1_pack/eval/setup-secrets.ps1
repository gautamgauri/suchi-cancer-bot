# Quick setup script to ensure Secret Manager is configured for eval
# This sets the GOOGLE_CLOUD_PROJECT environment variable needed for Secret Manager access

Write-Host "Setting up Secret Manager access for eval..." -ForegroundColor Green

# Set Google Cloud Project
$env:GOOGLE_CLOUD_PROJECT = "gen-lang-client-0202543132"
Write-Host "✓ GOOGLE_CLOUD_PROJECT set to: $env:GOOGLE_CLOUD_PROJECT" -ForegroundColor Cyan

# Verify secret exists
Write-Host "`nVerifying secret access..." -ForegroundColor Yellow
try {
    $secretValue = gcloud secrets versions access latest --secret="deepseek-api-key" --project=$env:GOOGLE_CLOUD_PROJECT 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Secret 'deepseek-api-key' is accessible" -ForegroundColor Green
        Write-Host "  Key preview: $($secretValue.Trim().Substring(0, [Math]::Min(15, $secretValue.Length)))..." -ForegroundColor Gray
    } else {
        Write-Host "✗ Could not access secret. Check permissions." -ForegroundColor Red
        Write-Host "  Run: gcloud secrets add-iam-policy-binding deepseek-api-key --member='user:YOUR_EMAIL' --role='roles/secretmanager.secretAccessor'" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ Error accessing secret: $_" -ForegroundColor Red
}

# Check if package is installed
Write-Host "`nChecking dependencies..." -ForegroundColor Yellow
$packageInstalled = npm list @google-cloud/secret-manager 2>&1 | Select-String -Pattern "@google-cloud/secret-manager" -Quiet
if ($packageInstalled) {
    Write-Host "✓ @google-cloud/secret-manager is installed" -ForegroundColor Green
} else {
    Write-Host "✗ @google-cloud/secret-manager not found. Installing..." -ForegroundColor Yellow
    npm install @google-cloud/secret-manager
}

Write-Host "`nConfiguration Summary:" -ForegroundColor Cyan
Write-Host "  Project: $env:GOOGLE_CLOUD_PROJECT" -ForegroundColor White
Write-Host "  Secret: deepseek-api-key" -ForegroundColor White
Write-Host "  Package: @google-cloud/secret-manager" -ForegroundColor White
Write-Host "`nThe eval framework will automatically load the API key from Secret Manager." -ForegroundColor Green
Write-Host "Run: npm run eval:tier1" -ForegroundColor Cyan
