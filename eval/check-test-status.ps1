# Quick status check for 100-case test
$reportFile = "reports/phase3-100case-batched.json"

if (-not (Test-Path $reportFile)) {
    Write-Host "`n⏳ Test not started yet or report not created..." -ForegroundColor Yellow
    exit 0
}

$data = Get-Content $reportFile | ConvertFrom-Json
$completed = $data.results.Count
$total = 100
$batches = [math]::Ceiling($completed / 5)
$totalBatches = 20
$percent = [math]::Round(($completed / $total) * 100, 1)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  100-CASE TEST - STATUS REPORT" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Progress:" -ForegroundColor Yellow
Write-Host "  Cases Completed: $completed / $total" -ForegroundColor White
Write-Host "  Progress: $percent percent" -ForegroundColor White
Write-Host "  Batches: $batches / $totalBatches" -ForegroundColor White

if ($data.suite) {
    Write-Host "`nSuite Metadata:" -ForegroundColor Yellow
    Write-Host "  Loaded: $($data.suite.loadedCount)" -ForegroundColor Gray
    Write-Host "  Selected: $($data.suite.selectedCount)" -ForegroundColor Gray
    Write-Host "  Executed: $($data.suite.executedCount)" -ForegroundColor Gray
    $statusColor = if($data.suite.status -eq 'VALID') { 'Green' } else { 'Yellow' }
    Write-Host "  Status: $($data.suite.status)" -ForegroundColor $statusColor
}

if ($completed -gt 0) {
    $withCites = ($data.results | Where-Object { $_.responseMetadata.citations.Count -ge 1 }).Count
    $with2Plus = ($data.results | Where-Object { $_.responseMetadata.citations.Count -ge 2 }).Count
    $abstentions = ($data.results | Where-Object { $_.responseText -like "*don't have enough*" -or $_.responseText -like "*can't confidently*" }).Count
    $totalCites = ($data.results | ForEach-Object { $_.responseMetadata.citations.Count } | Measure-Object -Sum).Sum
    $avgCites = [math]::Round($totalCites / $completed, 2)
    
    $citeCoverage = [math]::Round(($withCites / $completed) * 100, 1)
    $abstentionRate = [math]::Round(($abstentions / $completed) * 100, 1)
    
    Write-Host "`nCurrent Metrics:" -ForegroundColor Yellow
    Write-Host "  Citation Coverage: $withCites / $completed" -ForegroundColor White
    Write-Host "  Coverage Rate: $citeCoverage percent" -ForegroundColor $(if($citeCoverage -ge 50) { 'Green' } else { 'Yellow' })
    Write-Host "  Strong Coverage (2+): $with2Plus / $completed" -ForegroundColor White
    Write-Host "  Abstention Rate: $abstentions / $completed" -ForegroundColor White
    Write-Host "  Abstention Pct: $abstentionRate percent" -ForegroundColor $(if($abstentionRate -le 10) { 'Green' } else { 'Yellow' })
    Write-Host "  Average Citations: $avgCites per case" -ForegroundColor White
    
    if ($data.summary.retrievalQuality) {
        Write-Host "`nRetrieval Quality:" -ForegroundColor Yellow
        $trustedPct = [math]::Round($data.summary.retrievalQuality.top3TrustedPresenceRate * 100, 1)
        Write-Host "  Top-3 Trusted: $trustedPct percent" -ForegroundColor White
    }
}

$timestamp = Get-Date -Format 'HH:mm:ss'
Write-Host "`nLast Updated: $timestamp" -ForegroundColor Gray
Write-Host ""
