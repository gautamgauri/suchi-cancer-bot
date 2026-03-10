# Using Google Cloud Secret Manager for Eval API Keys

## Overview

The eval framework automatically loads API keys from Google Cloud Secret Manager when available. This is the **recommended and secure** way to configure API keys for evaluations.

## Prerequisites

1. **Google Cloud Project**: Your project ID should be set
2. **Secret Manager API**: Enabled in your project
3. **Secret Exists**: The secret `deepseek-api-key` should exist in Secret Manager
4. **Package Installed**: `@google-cloud/secret-manager` package installed

## Current Setup Status

✅ **Secret Exists**: `deepseek-api-key` is available in Secret Manager  
✅ **Config Loader**: The eval config loader (`eval/config/loader.ts`) already supports Secret Manager  
✅ **Auto-Detection**: The loader automatically detects and uses Secret Manager when available

## How It Works

The eval config loader follows this priority order:

1. **Secret Manager** (if available and `GOOGLE_CLOUD_PROJECT` is set)
2. **Environment Variables** (fallback)
3. **Config File** (default.json)

### Secret Names Expected

The loader looks for these secrets in Secret Manager:
- `deepseek-api-key` - Deepseek API key
- `openai-api-key` - OpenAI API key (if using OpenAI)
- `eval-llm-provider` - LLM provider preference ("deepseek", "openai", or "vertex_ai")
- `deepseek-model` - Deepseek model name (optional, defaults to "deepseek-chat")
- `openai-model` - OpenAI model name (optional, defaults to "gpt-4o")

## Setup Instructions

### 1. Install Required Package

```bash
cd eval
npm install @google-cloud/secret-manager
```

### 2. Set Google Cloud Project

The eval framework needs `GOOGLE_CLOUD_PROJECT` environment variable set:

**Windows (PowerShell):**
```powershell
$env:GOOGLE_CLOUD_PROJECT = "gen-lang-client-0202543132"
```

**Linux/Mac:**
```bash
export GOOGLE_CLOUD_PROJECT=gen-lang-client-0202543132
```

**Or set it in your shell profile** (`.bashrc`, `.zshrc`, or PowerShell profile) to make it persistent.

### 3. Verify Secret Access

Test that you can access the secret:

```bash
gcloud secrets versions access latest --secret="deepseek-api-key"
```

If this works, the eval framework should be able to access it too.

### 4. Run Eval

Simply run the eval as normal:

```bash
cd eval
npm run eval:tier1
```

The config loader will automatically:
1. Detect Secret Manager availability
2. Load `deepseek-api-key` from Secret Manager
3. Use it for LLM judge evaluations

## Verification

When the eval runs, you should see this message in the console:

```
Loaded secrets from Google Cloud Secret Manager
```

If you see:

```
Failed to load secrets from Secret Manager: [error message]
Falling back to environment variables
```

Then check:
1. Is `GOOGLE_CLOUD_PROJECT` set?
2. Is `@google-cloud/secret-manager` installed?
3. Do you have permission to access the secret?

## Troubleshooting

### Issue: "Deepseek client not initialized"

**Cause**: The API key is not being loaded from Secret Manager.

**Solutions**:
1. **Check GOOGLE_CLOUD_PROJECT**:
   ```powershell
   echo $env:GOOGLE_CLOUD_PROJECT
   ```
   If empty, set it as shown in step 2 above.

2. **Check Package Installation**:
   ```bash
   cd eval
   npm list @google-cloud/secret-manager
   ```
   If not installed, run: `npm install @google-cloud/secret-manager`

3. **Check Secret Access**:
   ```bash
   gcloud secrets versions access latest --secret="deepseek-api-key"
   ```
   If this fails, you may need to grant yourself access:
   ```bash
   gcloud secrets add-iam-policy-binding deepseek-api-key \
     --member="user:YOUR_EMAIL" \
     --role="roles/secretmanager.secretAccessor"
   ```

4. **Manual Fallback**: If Secret Manager doesn't work, you can set the environment variable:
   ```powershell
   $env:DEEPSEEK_API_KEY = "your-key-here"
   ```

### Issue: "Cannot find module @google-cloud/secret-manager"

**Solution**: Install the package:
```bash
cd eval
npm install @google-cloud/secret-manager
```

## Alternative: Using Environment Variables

If you prefer not to use Secret Manager, you can set environment variables directly:

**Windows (PowerShell):**
```powershell
$env:GOOGLE_CLOUD_PROJECT = "gen-lang-client-0202543132"
$env:EVAL_LLM_PROVIDER = "deepseek"
$env:DEEPSEEK_API_KEY = "your-api-key-here"
```

**Linux/Mac:**
```bash
export GOOGLE_CLOUD_PROJECT=gen-lang-client-0202543132
export EVAL_LLM_PROVIDER=deepseek
export DEEPSEEK_API_KEY=your-api-key-here
```

## Best Practices

1. **Always use Secret Manager** for production evaluations
2. **Never commit API keys** to version control
3. **Set GOOGLE_CLOUD_PROJECT** in your shell profile for convenience
4. **Verify access** before running large eval suites

## Related Files

- `eval/config/loader.ts` - Config loader with Secret Manager support
- `eval/config/secrets-manager.ts` - Secret Manager client wrapper
- `eval/config/default.json` - Default config (API keys should be empty here)
- `eval/run-eval.ps1` - PowerShell script that manually loads secrets (alternative approach)
