# Quick Guide: Using Secret Manager for Eval API Keys

## Current Status

✅ **Secret Exists**: `deepseek-api-key` is in Google Cloud Secret Manager  
✅ **Package Installed**: `@google-cloud/secret-manager@5.6.0` is installed  
✅ **Config Ready**: Eval config loader supports Secret Manager  
⚠️ **Auth Issue**: Need to authenticate for Secret Manager access (or use env var fallback)

## Quick Setup (Choose One)

### Option 1: Use Secret Manager (Recommended)

1. **Set Project ID**:
   ```powershell
   $env:GOOGLE_CLOUD_PROJECT = "gen-lang-client-0202543132"
   ```

2. **Authenticate Application Default Credentials**:
   ```powershell
   gcloud auth application-default login
   ```

3. **Run Setup Script** (optional):
   ```powershell
   cd eval
   .\setup-secrets.ps1
   ```

4. **Run Eval**:
   ```powershell
   npm run eval:tier1
   ```

You should see: `Loaded secrets from Google Cloud Secret Manager`

### Option 2: Use Environment Variable (Quick Fix)

If Secret Manager authentication is having issues, use environment variable:

```powershell
$env:GOOGLE_CLOUD_PROJECT = "gen-lang-client-0202543132"
$env:EVAL_LLM_PROVIDER = "deepseek"
$env:DEEPSEEK_API_KEY = (gcloud secrets versions access latest --secret="deepseek-api-key")
npm run eval:tier1
```

## Verification

When eval runs successfully with Secret Manager, you'll see:
```
Loaded secrets from Google Cloud Secret Manager
```

If you see:
```
Failed to load secrets from Secret Manager: [error]
Falling back to environment variables
```

Then either:
- Fix authentication (Option 1)
- Use environment variable (Option 2)

## Secret Name

The eval framework looks for: **`deepseek-api-key`** in Secret Manager

## Files

- `eval/config/loader.ts` - Auto-loads from Secret Manager
- `eval/config/secrets-manager.ts` - Secret Manager client
- `eval/setup-secrets.ps1` - Setup helper script
- `eval/docs/SECRET_MANAGER_SETUP.md` - Detailed documentation
