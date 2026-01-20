# PowerShell script to run all 5 batches sequentially
# Each batch contains 20 cases (4 cancers × 5 modes)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Running All Evaluation Batches" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

for ($batch = 1; $batch -le 5; $batch++) {
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "Starting Batch $batch of 5" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    
    .\run-batches.ps1 -BatchNumber $batch -TotalBatches 5
    
    Write-Host ""
    Write-Host "Batch $batch completed. Waiting 10 seconds before next batch..." -ForegroundColor Cyan
    Start-Sleep -Seconds 10
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "All Batches Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Reports saved in: reports/" -ForegroundColor Cyan
Write-Host "Total cases evaluated: ~100 (20 cancers × 5 modes)" -ForegroundColor Cyan
