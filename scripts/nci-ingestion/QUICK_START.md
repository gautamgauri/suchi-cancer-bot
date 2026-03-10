# Quick Start - Local Testing

## Fastest Way to Test Locally

### Option 1: Test with Single URL (Recommended for First Run)

1. **Setup Python environment**:
   ```powershell
   cd scripts/nci-ingestion
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

2. **Create test URL file**:
   ```powershell
   python create_test_url.py
   ```
   
   Or manually create `test_single.json`:
   ```json
   [{"url": "https://www.cancer.gov/types/breast/hp/breast-treatment-pdq"}]
   ```

3. **Extract and process**:
   ```powershell
   python extract_content.py --urls test_single.json --output test_extracted.json
   python process_content.py --input test_extracted.json
   ```

4. **Check output**:
   ```powershell
   dir ..\..\kb\en\02_nci_core\pdq\
   ```

### Option 2: Run Full Pipeline (Limited to 5 URLs)

```powershell
cd scripts/nci-ingestion
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Run with limit of 5 URLs for quick test
python update_nci.py --skip-ncit --limit 5
```

This will process only 5 URLs - perfect for initial testing!

### Option 3: Full Pipeline (All URLs)

```powershell
# After testing with limited URLs, run full pipeline:
python update_nci.py --skip-ncit
```

## Verify Results

1. **Check generated files**:
   ```powershell
   dir ..\..\kb\en\02_nci_core\ -Recurse
   ```

2. **Check manifest**:
   ```powershell
   # View last few entries
   Get-Content ..\..\kb\manifest.json | ConvertFrom-Json | Select-Object -Last 5
   ```

3. **Ingest into database**:
   ```powershell
   cd ..\..\apps\api
   npm run kb:ingest
   ```

## Troubleshooting

**If Python not found:**
- Install from https://www.python.org/downloads/
- Check "Add Python to PATH" during install
- Restart terminal

**If virtual environment activation fails:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**If imports fail:**
```powershell
pip install -r requirements.txt --upgrade
```

