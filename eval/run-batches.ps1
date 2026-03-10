# PowerShell script to run evaluations in batches of 20 cases
# Groups 20 cancers into 5 batches of 4 cancers each (4 cancers x 5 modes = 20 cases per batch)

param(
    [int]$BatchNumber = 1,
    [int]$TotalBatches = 5
)

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
        Write-Host "✓ Deepseek API key loaded" -ForegroundColor Green
    } else {
        Write-Host "⚠ Warning: Could not load from Secret Manager. Using hardcoded key." -ForegroundColor Yellow
        $env:DEEPSEEK_API_KEY = "sk-6bc325dec38c4d4c95f9f4ecb185e1dc"
    }
} catch {
    Write-Host "⚠ Warning: Could not load from Secret Manager. Using hardcoded key." -ForegroundColor Yellow
    $env:DEEPSEEK_API_KEY = "sk-6bc325dec38c4d4c95f9f4ecb185e1dc"
}

# Define 20 cancers grouped into 5 batches of 4 cancers each
$cancerBatches = @(
    @("lung", "breast", "colorectal", "prostate"),           # Batch 1: 4 cancers x 5 modes = 20 cases
    @("cervical", "ovarian", "oral_cavity", "head_neck"),   # Batch 2: 4 cancers x 5 modes = 20 cases
    @("stomach", "liver", "pancreatic", "esophageal"),       # Batch 3: 4 cancers x 5 modes = 20 cases
    @("kidney", "bladder", "thyroid", "brain"),             # Batch 4: 4 cancers x 5 modes = 20 cases
    @("leukemia", "lymphoma", "melanoma", "nhl")            # Batch 5: 4 cancers x 5 modes = 20 cases
)

if ($BatchNumber -lt 1 -or $BatchNumber -gt $TotalBatches) {
    Write-Host "Error: Batch number must be between 1 and $TotalBatches" -ForegroundColor Red
    exit 1
}

$cancers = $cancerBatches[$BatchNumber - 1]
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  API: https://suchi-api-lxiveognla-uc.a.run.app/v1" -ForegroundColor White
Write-Host "  LLM Provider: $env:EVAL_LLM_PROVIDER" -ForegroundColor White
Write-Host "  Project: $env:GOOGLE_CLOUD_PROJECT" -ForegroundColor White
Write-Host "  Batch: $BatchNumber of $TotalBatches" -ForegroundColor White
Write-Host "  Cancers: $($cancers -join ', ')" -ForegroundColor White
Write-Host '  Expected Cases: ~20 (4 cancers x 5 modes)' -ForegroundColor White
Write-Host ""

# Run evaluation for each cancer in the batch
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$allResults = @()

foreach ($cancer in $cancers) {
    Write-Host "Running tests for $cancer..." -ForegroundColor Green
    $outputFile = "reports/batch$BatchNumber-$cancer-$timestamp.json"
    
    npm run eval run -- --cases cases/tier1/common_cancers_20_mode_matrix.yaml --cancer $cancer --output $outputFile --summary 2>&1 | Out-Null
    
    if (Test-Path $outputFile) {
        Write-Host "  ✓ Completed: $outputFile" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Failed: $cancer" -ForegroundColor Red
    }
}

# Create combined report
Write-Host ""
Write-Host "Batch $BatchNumber complete!" -ForegroundColor Green
Write-Host "Individual reports saved in reports/ directory" -ForegroundColor Cyan
