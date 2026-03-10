# Run 100-Case Suite by Cancer Type (Natural Batches of 5)
# Phase 2.5 Scaled Testing

# ✅ CANONICALIZED: Use lowercase to match YAML (single source of truth)
$cancerTypes = @(
    "lung", "breast", "colorectal", "prostate", "stomach",
    "liver", "cervical", "thyroid", "bladder", "esophagus",
    "pancreas", "kidney", "ovarian", "endometrial", "melanoma",
    "oral_cavity", "non_hodgkin_lymphoma", "leukemia", "brain_cns", "laryngeal"
)

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$overallStartTime = Get-Date

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "PHASE 2.5 - 100-CASE BY CANCER TYPE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nConfiguration:" -ForegroundColor Yellow
Write-Host "  Total Cancer Types: $($cancerTypes.Count)" -ForegroundColor White
Write-Host "  Cases per Type: 5 (GEN, PATIENT, CAREGIVER, POST, URGENT)" -ForegroundColor White
Write-Host "  Total Cases: 100" -ForegroundColor White
Write-Host "  Started: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

$totalCitations = 0
$totalAbstentions = 0
$totalCases = 0
$failedBatches = @()

foreach($cancer in $cancerTypes) {
    $batchNum = [array]::IndexOf($cancerTypes, $cancer) + 1
    
    Write-Host "`n=== BATCH $batchNum/20: $cancer ===" -ForegroundColor Yellow
    Write-Host "Running 5 cases (all intents)... " -ForegroundColor Cyan -NoNewline
    
    $batchStartTime = Get-Date
    $reportFile = "reports/cancer-$cancer-$timestamp.json"
    
    # Run evaluation for this cancer type
    npx ts-node cli.ts run `
        --cases cases/tier1/common_cancers_20_mode_matrix.yaml `
        --cancer $cancer `
        --output $reportFile 2>&1 | Out-Null
    
    $batchDuration = ((Get-Date) - $batchStartTime).TotalSeconds
    
    if($LASTEXITCODE -eq 0 -and (Test-Path $reportFile)) {
        # Load and analyze results
        $report = Get-Content $reportFile | ConvertFrom-Json
        
        $citationCount = ($report.results | Where-Object { $_.responseMetadata.citations.Count -ge 2 }).Count
        $abstentionCount = ($report.results | Where-Object { $_.responseMetadata.abstentionReason }).Count
        $caseCount = $report.results.Count
        
        $totalCitations += $citationCount
        $totalAbstentions += $abstentionCount
        $totalCases += $caseCount
        
        Write-Host "✅ DONE ($([math]::Round($batchDuration, 1))s)" -ForegroundColor Green
        Write-Host "  Cases: $caseCount" -ForegroundColor White
        Write-Host "  With Citations: $citationCount" -ForegroundColor White
        Write-Host "  Abstentions: $abstentionCount" -ForegroundColor $(if($abstentionCount -gt 0) { "Yellow" } else { "White" })
        
        # Brief pause
        if($batchNum -lt $cancerTypes.Count) {
            Start-Sleep -Seconds 5
        }
    } else {
        Write-Host "❌ FAILED" -ForegroundColor Red
        $failedBatches += $cancer
    }
}

# Summary
$overallDuration = ((Get-Date) - $overallStartTime).TotalMinutes

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "EVALUATION COMPLETE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nExecution:" -ForegroundColor Yellow
Write-Host "  Cancer Types Run: $($cancerTypes.Count - $failedBatches.Count)/$($cancerTypes.Count)" -ForegroundColor White
Write-Host "  Total Cases: $totalCases" -ForegroundColor White
Write-Host "  Total Time: $([math]::Round($overallDuration, 1)) minutes" -ForegroundColor White

Write-Host "`nResults:" -ForegroundColor Yellow
$citationCoverage = if($totalCases -gt 0) { ($totalCitations / $totalCases) * 100 } else { 0 }
$abstentionRate = if($totalCases -gt 0) { ($totalAbstentions / $totalCases) * 100 } else { 0 }

Write-Host "  Citation Coverage: $([math]::Round($citationCoverage, 1))%" -ForegroundColor White
Write-Host "  Abstention Rate: $([math]::Round($abstentionRate, 1))%" -ForegroundColor White

if($failedBatches.Count -gt 0) {
    Write-Host "`nFailed Batches:" -ForegroundColor Red
    $failedBatches | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
}

Write-Host "`nReports saved in: eval/reports/cancer-*-$timestamp.json" -ForegroundColor Cyan
Write-Host ""
