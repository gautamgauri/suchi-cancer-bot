# GitHub Repository Setup Guide

## Step 1: Create GitHub Repository

1. Go to [GitHub](https://github.com) and sign in
2. Click the "+" icon in the top right → "New repository"
3. Repository name: `suchi-cancer-bot` (or your preferred name)
4. Description: "Suchi (Suchitra Cancer Bot) - AI-powered cancer information assistant with safety guardrails"
5. Visibility: Choose Public or Private
6. **DO NOT** initialize with README, .gitignore, or license (we already have these)
7. Click "Create repository"

## Step 2: Connect Local Repository to GitHub

After creating the repository, GitHub will show you commands. Use these:

```bash
cd "C:\Users\gauta\OneDrive\Documents\suchi_phase1_pack"

# Add the remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/suchi-cancer-bot.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

## Step 3: Verify Push

After pushing, check your GitHub repository page - you should see all files uploaded.

## Important Notes

### Files Excluded (.gitignore)

The following are **NOT** uploaded (as they should be):
- `.env` files (contains API keys - NEVER commit these!)
- `node_modules/` (dependencies)
- `venv/` (Python virtual environment)
- Database files
- Build artifacts
- Log files
- Temporary files

### Before Pushing to GitHub

1. **Verify no sensitive data**: Check that no `.env` files are included
2. **API Keys**: Ensure no API keys are hardcoded in the code
3. **Database credentials**: Only `.env.example` should be committed

### Environment Variables

Users will need to:
1. Copy `.env.example` to `.env`
2. Fill in their own values
3. Never commit `.env` to the repository

## Quick Command Reference

```bash
# Check what will be committed
git status

# See commit history
git log --oneline

# Push updates
git add .
git commit -m "Your commit message"
git push

# Pull latest changes (if working with others)
git pull
```





















