# Simple batch runner - runs all 100 cases but you can monitor progress
# For true batching, we'd need to split the YAML file

param(
    [int]$BatchNumber = 1
)

$env:GOOGLE_CLOUD_PROJECT = "gen-lang-client-0202543132"
$env:EVAL_LLM_PROVIDER = "deepseek"

Write-Host "Loading Deepseek API key..." -ForegroundColor Yellow
$deepseekKey = gcloud secrets versions access latest --secret="deepseek-api-key" 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -eq 0) {
    $env:DEEPSEEK_API_KEY = $deepseekKey.Trim()
    Write-Host "✓ API key loaded" -ForegroundColor Green
} else {
    $env:DEEPSEEK_API_KEY = "sk-6bc325dec38c4d4c95f9f4ecb185e1dc"
    Write-Host "⚠ Using fallback key" -ForegroundColor Yellow
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputFile = "reports/batch-$BatchNumber-$timestamp.json"

Write-Host ""
Write-Host "Running test cases in batches of 5..." -ForegroundColor Green
Write-Host "This will process cases in smaller batches for better monitoring" -ForegroundColor Cyan
Write-Host ""

npm run eval run -- --cases cases/tier1/common_cancers_20_mode_matrix.yaml --batch-size 5 --output $outputFile --summary

Write-Host ""
Write-Host "Report saved to: $outputFile" -ForegroundColor Green
