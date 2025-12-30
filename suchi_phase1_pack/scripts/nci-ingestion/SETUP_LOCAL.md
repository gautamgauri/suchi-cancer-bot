# Local Setup Guide for NCI Ingestion

## Prerequisites

1. **Python 3.8+** installed and in PATH
   - Check: `python --version` or `python3 --version`
   - Download: https://www.python.org/downloads/

2. **Node.js and npm** (for KB ingestion)
   - Already set up if you've been running the API

## Step-by-Step Setup

### 1. Navigate to Scripts Directory

```powershell
# From project root
cd suchi_phase1_pack/scripts/nci-ingestion
```

Or if you're already in the workspace root:
```powershell
cd scripts/nci-ingestion
```

### 2. Create Python Virtual Environment

```powershell
# Windows PowerShell
python -m venv venv

# Or if python3 is needed:
python3 -m venv venv
```

### 3. Activate Virtual Environment

**Windows PowerShell:**
```powershell
.\venv\Scripts\Activate.ps1
```

**Windows CMD:**
```cmd
venv\Scripts\activate.bat
```

**Linux/Mac:**
```bash
source venv/bin/activate
```

If you get an execution policy error in PowerShell:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 4. Install Python Dependencies

```powershell
pip install -r requirements.txt
```

### 5. Test Sitemap Crawler (Small Test First)

Start with a small test to verify everything works:

```powershell
# Test sitemap crawling (this will discover URLs)
python crawl_sitemap.py --output test_urls.json
```

This should create `test_urls.json` with discovered URLs.

### 6. Test Content Extraction (Single URL)

Create a test file with one URL to test extraction:

**Create `test_single_url.json`:**
```json
[
  {"url": "https://www.cancer.gov/types/breast/hp/breast-treatment-pdq"}
]
```

Then extract:
```powershell
python extract_content.py --urls test_single_url.json --output test_extracted.json
```

### 7. Test Content Processing

```powershell
python process_content.py --input test_extracted.json --output test_processed.json
```

Check that Markdown files were created in `kb/en/02_nci_core/`

### 8. Run Full Pipeline (Limited)

For initial testing, the `update_nci.py` script is configured to process only the first 50 URLs:

```powershell
python update_nci.py
```

This will:
- Crawl sitemap
- Extract content from first 50 URLs
- Convert to Markdown
- Update manifest.json

### 9. Process NCIt Thesaurus (Optional, Takes Time)

**Warning**: This downloads a ~100MB file and may take 10-15 minutes:

```powershell
python process_ncit.py --force-download
```

For faster testing, you can skip this initially:
```powershell
python update_nci.py --skip-ncit
```

### 10. Ingest into KB Database

After content is extracted and processed:

```powershell
# Navigate to API directory
cd ../../apps/api

# Ensure dependencies are installed
npm install

# Set up environment variables (if not already done)
# Copy .env.example to .env and fill in:
# - DATABASE_URL
# - GEMINI_API_KEY (or EMBEDDING_API_KEY)

# Run KB ingestion
npm run kb:ingest
```

## Quick Test Workflow

1. **Minimal test** (one page):
   ```powershell
   # Create test URL file
   echo '[{"url": "https://www.cancer.gov/types/breast/hp/breast-treatment-pdq"}]' > test_url.json
   
   # Extract
   python extract_content.py --urls test_url.json --output test_extracted.json
   
   # Process
   python process_content.py --input test_extracted.json
   
   # Check output
   dir ..\..\kb\en\02_nci_core\
   ```

2. **Full pipeline test** (50 URLs):
   ```powershell
   python update_nci.py --skip-ncit
   ```

3. **Check results**:
   ```powershell
   # View generated files
   dir ..\..\kb\en\02_nci_core\pdq\
   dir ..\..\kb\en\02_nci_core\cancer-types\
   
   # Check manifest
   Get-Content ..\..\kb\manifest.json | ConvertFrom-Json | ConvertTo-Json -Depth 10
   ```

## Troubleshooting

### Python Not Found
- Install Python from https://www.python.org/downloads/
- Check "Add Python to PATH" during installation
- Restart terminal after installation

### Virtual Environment Issues
- Delete `venv` folder and recreate
- Try `python3` instead of `python`

### Import Errors
- Ensure virtual environment is activated
- Reinstall: `pip install -r requirements.txt --force-reinstall`

### Rate Limiting
- Increase `rate_limit_delay` in `config.yaml` to 2.0 or 3.0
- Process in smaller batches

### Path Issues
- Use absolute paths if relative paths don't work
- Check you're in the right directory: `pwd` (Linux/Mac) or `cd` (Windows)

### Windows PowerShell Execution Policy
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Expected Results

After successful run, you should have:

1. **Markdown files** in `kb/en/02_nci_core/`:
   - `pdq/` - PDQ summaries
   - `cancer-types/` - Cancer type pages
   - `dictionaries/` - Dictionary pages

2. **Manifest updated** at `kb/manifest.json` with new NCI entries

3. **Ready for ingestion** - Files are in correct format for KB ingestion script

## Next Steps After Local Testing

1. Review generated Markdown files for quality
2. Adjust content extraction selectors if needed
3. Run full crawl (remove 50 URL limit)
4. Process NCIt thesaurus
5. Ingest into database
6. Test queries in the chat interface






