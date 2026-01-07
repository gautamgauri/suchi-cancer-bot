# PowerShell script to run evaluations with proper configuration
# This sets up the environment for running evaluations against GCloud API

Write-Host "Setting up evaluation environment..." -ForegroundColor Green

# Set Google Cloud Project
$env:GOOGLE_CLOUD_PROJECT = "gen-lang-client-0202543132"

# Set LLM Provider to Deepseek
$env:EVAL_LLM_PROVIDER = "deepseek"

# Get Deepseek API key from Secret Manager
Write-Host "Retrieving Deepseek API key from Secret Manager..." -ForegroundColor Yellow
try {
    $deepseekKey = gcloud secrets versions access latest --secret="deepseek-api-key" --project=$env:GOOGLE_CLOUD_PROJECT 2>&1
    if ($LASTEXITCODE -eq 0) {
        $env:DEEPSEEK_API_KEY = $deepseekKey.Trim()
        Write-Host "Deepseek API key loaded" -ForegroundColor Green
    } else {
        Write-Host "Warning: Could not load from Secret Manager. Using hardcoded key." -ForegroundColor Yellow
        $env:DEEPSEEK_API_KEY = "sk-6bc325dec38c4d4c95f9f4ecb185e1dc"
    }
} catch {
    Write-Host "Warning: Could not load from Secret Manager. Using hardcoded key." -ForegroundColor Yellow
    $env:DEEPSEEK_API_KEY = "sk-6bc325dec38c4d4c95f9f4ecb185e1dc"
}

# API is already configured in default.json to use GCloud
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  API: https://suchi-api-lxiveognla-uc.a.run.app/v1" -ForegroundColor White
Write-Host "  LLM Provider: $env:EVAL_LLM_PROVIDER" -ForegroundColor White
Write-Host "  Project: $env:GOOGLE_CLOUD_PROJECT" -ForegroundColor White
Write-Host ""

# Run the evaluation with provided arguments
Write-Host "Running evaluation..." -ForegroundColor Green
Write-Host ""
if ($args.Count -gt 0) {
    & npm run eval run -- $args
} else {
    & npm run eval run
}
