# PowerShell script to run tier1 retrieval quality eval with timestamped output
# Generates timestamped report output

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputPath = "reports/tier1-$timestamp.json"

Write-Host "Running Tier1 Retrieval Quality Evaluation..." -ForegroundColor Green
Write-Host "Output will be saved to: $outputPath" -ForegroundColor Cyan
Write-Host ""

# Run the evaluation
npm run eval run -- --cases cases/tier1/retrieval_quality.yaml --output $outputPath --summary
