# PowerShell script to push Suchi Cancer Bot to GitHub
# Usage: .\push-to-github.ps1 -GitHubUsername "YOUR_USERNAME"

param(
    [Parameter(Mandatory=$true)]
    [string]$GitHubUsername,
    
    [Parameter(Mandatory=$false)]
    [string]$RepoName = "suchi-cancer-bot"
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== Pushing Suchi Cancer Bot to GitHub ===" -ForegroundColor Cyan
Write-Host ""

# Check if remote already exists
$remoteExists = git remote get-url origin 2>$null
if ($remoteExists) {
    Write-Host "Remote 'origin' already exists: $remoteExists" -ForegroundColor Yellow
    $overwrite = Read-Host "Do you want to change it? (y/n)"
    if ($overwrite -eq "y" -or $overwrite -eq "Y") {
        git remote remove origin
    } else {
        Write-Host "Using existing remote. Pushing to GitHub..." -ForegroundColor Green
        git push -u origin main
        exit 0
    }
}

$repoUrl = "https://github.com/$GitHubUsername/$RepoName.git"

Write-Host "Repository URL: $repoUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANT: Make sure you've created the repository on GitHub first!" -ForegroundColor Yellow
Write-Host "  1. Go to: https://github.com/new" -ForegroundColor White
Write-Host "  2. Repository name: $RepoName" -ForegroundColor White
Write-Host "  3. Choose Public or Private" -ForegroundColor White
Write-Host "  4. DO NOT initialize with README" -ForegroundColor White
Write-Host ""
$continue = Read-Host "Have you created the repository? (y/n)"

if ($continue -ne "y" -and $continue -ne "Y") {
    Write-Host "Please create the repository first, then run this script again." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Adding remote and pushing..." -ForegroundColor Green

# Add remote
git remote add origin $repoUrl

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error adding remote. It may already exist." -ForegroundColor Red
    exit 1
}

# Push to GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Green
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✓ Successfully pushed to GitHub!" -ForegroundColor Green
    Write-Host "  Repository: https://github.com/$GitHubUsername/$RepoName" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "✗ Error pushing to GitHub." -ForegroundColor Red
    Write-Host "  Make sure you've created the repository and have proper authentication." -ForegroundColor Yellow
}

















