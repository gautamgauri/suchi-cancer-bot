# Manual migration script for Windows - executes Cloud Run migration job
# This is the "big red button" for emergency migrations

param(
    [string]$Region = "us-central1",
    [string]$Job = "suchi-db-migrate"
)

Write-Host "Executing Cloud Run migration job: $Job ($Region)" -ForegroundColor Cyan
gcloud run jobs execute $Job --region=$Region --wait
Write-Host "✅ Migration complete!" -ForegroundColor Green
