# Quick Guide: Push to GitHub

## Option 1: Manual Setup (Easiest)

### Step 1: Create Repository on GitHub
1. Go to https://github.com/new
2. Repository name: `suchi-cancer-bot`
3. Description: "Suchi (Suchitra Cancer Bot) - AI-powered cancer information assistant"
4. Choose Public or Private
5. **DO NOT** check "Initialize with README"
6. Click "Create repository"

### Step 2: Push Your Code

After creating the repo, GitHub will show you commands. Use these (replace YOUR_USERNAME):

```powershell
cd "C:\Users\gauta\OneDrive\Documents\suchi_phase1_pack"

# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/suchi-cancer-bot.git

# Push to GitHub
git push -u origin main
```

## Option 2: Using GitHub CLI

If you prefer using GitHub CLI:

```powershell
# First authenticate
gh auth login

# Then create and push
cd "C:\Users\gauta\OneDrive\Documents\suchi_phase1_pack"
gh repo create suchi-cancer-bot --public --source=. --remote=origin --push
```





















