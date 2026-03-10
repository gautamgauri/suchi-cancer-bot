# PowerShell script to run general info eval pack
# Generates timestamped report output

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputPath = "reports/generalinfo-$timestamp.json"

Write-Host "Running General Info 100-case pack..." -ForegroundColor Green
Write-Host "Output will be saved to: $outputPath" -ForegroundColor Cyan
Write-Host ""

# Run the evaluation
npm run eval run -- --cases cases/generalinfo/general_info_100.yaml --output $outputPath --summary
